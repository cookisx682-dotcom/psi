"""PSI core – dáta, cache a externé služby (len stdlib).

ProtonDB, CheapShark, Steam Store, odhad zľavy (estimate_deal) a denné snímky
času hrania (Snapshots).
"""
from __future__ import annotations

import datetime as dt
import fcntl
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

UA = "PSI/1.0 (personal Steam companion for Linux)"
COUNTRY = "SK"

DATA_DIR = Path(os.environ.get("PSI_DATA") or Path.home() / ".local/share/psi")
CONFIG_PATH = DATA_DIR / "config.json"
CACHE_PATH = DATA_DIR / "cache.json"
SNAPSHOTS_PATH = DATA_DIR / "snapshots.json"

DAY = 86400
CDN = "https://shared.akamai.steamstatic.com/store_item_assets/"

# Oficiálne termíny od Valve (štart a koniec 10:00 Pacific time).
DEFAULT_SALES = [
    {"name": "Zimný výpredaj", "start": "2026-12-17T18:00:00Z", "end": "2027-01-04T18:00:00Z"},
    {"name": "Jarný výpredaj", "start": "2027-03-18T17:00:00Z", "end": "2027-03-25T17:00:00Z"},
    {"name": "Letný výpredaj", "start": "2027-06-24T17:00:00Z", "end": "2027-07-08T17:00:00Z"},
]

TIERS = ["native", "platinum", "gold", "silver", "bronze", "borked", "pending"]


# --------------------------------------------------------------------------- súbory

def _ensure_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(DATA_DIR, 0o700)
    except OSError:
        pass


def read_json(path: Path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path: Path, data) -> None:
    _ensure_dir()
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


class JsonStore:
    """JSON súbor zdieľaný medzi službou a CLI: zámok + reload podľa mtime."""

    def __init__(self, path: Path, default_factory):
        self.path = path
        self.default_factory = default_factory
        self._lock = threading.RLock()
        self._data = None
        self._mtime = None

    def _lockfile(self):
        _ensure_dir()
        return open(self.path.with_suffix(".lock"), "w")

    def get(self) -> dict:
        with self._lock:
            try:
                mtime = self.path.stat().st_mtime_ns
            except OSError:
                mtime = None
            if self._data is None or mtime != self._mtime:
                data = read_json(self.path, None)
                self._data = data if isinstance(data, dict) else self.default_factory()
                self._mtime = mtime
            return self._data

    def update(self, fn):
        """Atomický read-modify-write; fn(data) mení dict na mieste a vráti hodnotu."""
        with self._lock, self._lockfile() as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            self._mtime = None
            data = self.get()
            result = fn(data)
            write_json(self.path, data)
            self._mtime = self.path.stat().st_mtime_ns
            return result


# Prepínače v Steam → Nastavenia → PSI
DEFAULT_FEATURES = {
    "rounded": True,        # zaoblené rohy v celom Steame (klient, obchod, komunita)
    "auto_update": True,    # automatické aktualizácie PSI z GitHubu
    "collections": True,    # auto-kolekcie v knižnici (PSI · Gold, Natívne, anti-cheat…)
    "notify": True,         # KDE notifikácie: zľava / historické minimum na wishliste
    "buy_warning": True,    # varovanie pred kúpou hry, ktorá na Linuxe nepôjde
    "library": True,        # ProtonDB medaila pri hre v knižnici
    "store": True,          # ProtonDB + zľavy na stránke hry v obchode
    "community": True,      # vitrína „Môj týždeň“ na profile
    "companion_lan": True,  # Companion dostupný z mobilu v domácej sieti
    "dock_icons": True,     # ikony hier v doku / paneli úloh (skryté .desktop záznamy)
}


def features() -> dict:
    return {**DEFAULT_FEATURES, **(config().get("features") or {})}


def set_feature(name: str, value: bool) -> dict:
    if name not in DEFAULT_FEATURES:
        raise ValueError(f"neznáma funkcia {name!r}")
    CONFIG.update(lambda c: c.setdefault("features", {}).__setitem__(name, bool(value)))
    return features()


# Jazyk PSI: "auto" = podľa jazyka Steamu (Steam slovenčinu nemá – čeština → slovenčina, inak angličtina)
LANGS = ("auto", "sk", "en")


def language() -> str:
    v = str(config().get("language") or "auto")
    return v if v in LANGS else "auto"


def steam_language() -> str:
    try:
        text = (Path.home() / ".steam/registry.vdf").read_text(encoding="utf-8", errors="replace")
        m = re.search(r'"language"\s+"([^"]+)"', text)
        return m.group(1).lower() if m else ""
    except OSError:
        return ""


def ui_lang() -> str:
    v = language()
    if v != "auto":
        return v
    return "sk" if steam_language() in ("czech", "slovak") else "en"


def set_language(v: str) -> str:
    if v not in LANGS:
        raise ValueError(f"unknown language {v!r}")
    CONFIG.update(lambda c: c.__setitem__("language", v))
    return ui_lang()


def tr(sk: str, en: str) -> str:
    return en if ui_lang() == "en" else sk


DEFAULT_THEME = {"accent": "#1a9fff", "panel": "#121c2c", "opacity": 0.62, "blur": 10, "radius": 12}


def theme() -> dict:
    t = {**DEFAULT_THEME, **(config().get("theme") or {})}
    return t


def set_theme(t: dict) -> dict:
    hexre = re.compile(r"^#[0-9a-fA-F]{6}$")
    clean = dict(DEFAULT_THEME)
    if isinstance(t, dict):
        for k in ("accent", "panel"):
            if hexre.match(str(t.get(k, ""))):
                clean[k] = str(t[k]).lower()
        for k, lo, hi in (("opacity", 0.0, 1.0), ("blur", 0, 30), ("radius", 0, 28)):
            try:
                clean[k] = round(min(hi, max(lo, float(t.get(k, clean[k])))), 2)
            except (TypeError, ValueError):
                pass
    CONFIG.update(lambda c: c.__setitem__("theme", clean))
    return clean


def _default_config() -> dict:
    return {
        "country": COUNTRY,
        "steam_api_key": "",  # voliteľné – achievementy cez Steam Web API
        "steamid": "",        # prázdne = zistí sa z loginusers.vdf
        "sales": DEFAULT_SALES,
        "companion": {"enabled": True, "port": 8787, "host": "", "pin": "", "tokens": {}},
        "features": dict(DEFAULT_FEATURES),
        "profile": {},
    }


CONFIG = JsonStore(CONFIG_PATH, _default_config)


def config() -> dict:
    cfg = CONFIG.get()
    if not cfg.get("companion", {}).get("pin"):
        ensure_pin()
        cfg = CONFIG.get()
    return cfg


def ensure_pin(regenerate: bool = False) -> str:
    def fn(cfg):
        base = _default_config()
        for k, v in base.items():
            cfg.setdefault(k, v)
        comp = cfg["companion"]
        for k, v in base["companion"].items():
            comp.setdefault(k, v)
        if regenerate or not re.fullmatch(r"\d{6}", str(comp.get("pin", ""))):
            comp["pin"] = f"{secrets.randbelow(10**6):06d}"
            comp["tokens"] = {}  # nový PIN = odhlásenie všetkých zariadení
        return comp["pin"]

    return CONFIG.update(fn)


# --------------------------------------------------------------------------- cache

class Cache:
    """cache.json: {sekcia: {kľúč: {"t": čas, "v": hodnota}}}, + "history"."""

    def __init__(self, path: Path = CACHE_PATH):
        self.path = path
        self.lock = threading.RLock()
        self.data = read_json(path, {})
        self._dirty = False
        self._last_save = 0.0

    def get(self, section: str, key, ttl: float):
        with self.lock:
            e = self.data.get(section, {}).get(str(key))
            if e and time.time() - e.get("t", 0) < ttl:
                return e["v"]
        return None

    def stale(self, section: str, key):
        with self.lock:
            e = self.data.get(section, {}).get(str(key))
            return e["v"] if e else None

    def put(self, section: str, key, value) -> None:
        with self.lock:
            self.data.setdefault(section, {})[str(key)] = {"t": int(time.time()), "v": value}
            self._dirty = True
        self.save()

    def add_price_point(self, appid: int, cents: int, pct: int) -> None:
        """História cien: jeden bod na deň, len keď sa niečo zmenilo."""
        today = dt.date.today().isoformat()
        with self.lock:
            hist = self.data.setdefault("history", {}).setdefault(str(appid), [])
            if hist and hist[-1][1] == cents and hist[-1][2] == pct:
                return
            if hist and hist[-1][0] == today:
                hist[-1] = [today, cents, pct]
            else:
                hist.append([today, cents, pct])
            del hist[:-400]
            self._dirty = True

    def history(self, appid: int) -> list:
        with self.lock:
            return list(self.data.get("history", {}).get(str(appid), []))

    def save(self, force: bool = False) -> None:
        with self.lock:
            if not self._dirty or (not force and time.time() - self._last_save < 5):
                return
            write_json(self.path, self.data)
            self._dirty = False
            self._last_save = time.time()


CACHE = Cache()


# --------------------------------------------------------------------------- HTTP

def http_json(url: str, params: dict | None = None, timeout: float = 12):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _pool(n: int = 8) -> ThreadPoolExecutor:
    return ThreadPoolExecutor(max_workers=n, thread_name_prefix="psi-net")


# --------------------------------------------------------------------------- ProtonDB

class ProtonDB:
    TTL = DAY

    @staticmethod
    def get(appid: int) -> dict:
        hit = CACHE.get("protondb", appid, ProtonDB.TTL)
        if hit is not None:
            return hit
        try:
            d = http_json(f"https://www.protondb.com/api/v1/reports/summaries/{int(appid)}.json")
            v = {
                "tier": d.get("tier") or "pending",
                "best": d.get("bestReportedTier"),
                "trending": d.get("trendingTier"),
                "confidence": d.get("confidence"),
                "reports": d.get("total", 0),
                "score": d.get("score"),
            }
        except urllib.error.HTTPError as e:
            if e.code != 404:
                return CACHE.stale("protondb", appid) or {"tier": "pending", "reports": 0, "error": True}
            v = {"tier": "pending", "reports": 0}
        except Exception:
            return CACHE.stale("protondb", appid) or {"tier": "pending", "reports": 0, "error": True}
        CACHE.put("protondb", appid, v)
        return v

    @staticmethod
    def many(appids) -> dict:
        appids = list(dict.fromkeys(int(a) for a in appids))
        with _pool() as p:
            return dict(zip(appids, p.map(ProtonDB.get, appids)))


# --------------------------------------------------------------------------- Anti-cheat

class AntiCheat:
    """AreWeAntiCheatYet – či anti-cheat hry funguje na Linuxe (Proton)."""
    URL = "https://raw.githubusercontent.com/AreWeAntiCheatYet/AreWeAntiCheatYet/HEAD/games.json"
    PATH = DATA_DIR / "anticheat.json"
    TTL = DAY
    _index: dict | None = None
    _loaded = 0.0
    _lock = threading.Lock()

    @classmethod
    def _load(cls) -> dict:
        with cls._lock:
            fresh = cls.PATH.exists() and time.time() - cls.PATH.stat().st_mtime < cls.TTL
            if cls._index is not None and fresh:
                return cls._index
            data = None
            if not fresh:
                try:
                    data = http_json(cls.URL, timeout=20)
                    write_json(cls.PATH, data)
                except Exception:
                    data = None
            if data is None:
                data = read_json(cls.PATH, [])
            idx = {}
            for g in data if isinstance(data, list) else []:
                sid = str((g.get("storeIds") or {}).get("steam") or "")
                if sid.isdigit():
                    upd = g.get("updates") or []
                    idx[sid] = {
                        "status": g.get("status") or "",
                        "anticheats": g.get("anticheats") or [],
                        "notes": [n[0] for n in g.get("notes") or [] if n and n[0]][:3],
                        "updated": (upd[-1].get("date") if upd else None),
                    }
            cls._index = idx
            return idx

    @classmethod
    def get(cls, appid: int) -> dict | None:
        return cls._load().get(str(int(appid)))


# --------------------------------------------------------------------------- CheapShark

class CheapShark:
    """Historické minimum ceny (v USD – používame len pomer ku plnej cene)."""
    TTL = DAY

    @staticmethod
    def lowest(appid: int) -> dict | None:
        hit = CACHE.get("cheapshark", appid, CheapShark.TTL)
        if hit is not None:
            return hit or None
        v: dict = {}
        try:
            found = http_json("https://www.cheapshark.com/api/1.0/games", {"steamAppID": int(appid)})
            if found:
                g = http_json("https://www.cheapshark.com/api/1.0/games", {"id": found[0]["gameID"]})
                low = g.get("cheapestPriceEver") or {}
                retail = max((float(d.get("retailPrice") or 0) for d in g.get("deals", [])), default=0)
                price = float(low.get("price") or 0)
                if retail > 0 and price > 0:
                    v = {
                        "price_usd": price,
                        "retail_usd": retail,
                        "pct": max(0, round((1 - price / retail) * 100)),
                        "date": int(low.get("date") or 0),
                    }
        except Exception:
            return CACHE.stale("cheapshark", appid) or None
        CACHE.put("cheapshark", appid, v)
        return v or None


# --------------------------------------------------------------------------- Steam Store

def _asset(item: dict, key: str) -> str | None:
    a = item.get("assets") or {}
    fmt, name = a.get("asset_url_format"), a.get(key)
    return CDN + fmt.replace("${FILENAME}", name) if fmt and name else None


class SteamStore:
    TTL = 3 * 3600
    VERSION = 2  # zvýš pri zmene formátu – staré záznamy v cache sa ignorujú

    @staticmethod
    def _parse(it: dict) -> dict:
        appid = int(it.get("appid") or it.get("id"))
        bpo = it.get("best_purchase_option") or {}
        ends = [d.get("discount_end_date") for d in bpo.get("active_discounts") or [] if d.get("discount_end_date")]
        final = int(bpo.get("final_price_in_cents") or 0) if bpo else None
        orig = int(bpo.get("original_price_in_cents") or final or 0) if bpo else None
        return {
            "appid": appid,
            "name": it.get("name") or f"App {appid}",
            "header": _asset(it, "header") or f"{CDN}steam/apps/{appid}/header.jpg",
            "capsule": _asset(it, "main_capsule") or _asset(it, "header"),
            "is_free": bool(it.get("is_free")),
            "price": final,
            "price_full": orig,
            "price_fmt": bpo.get("formatted_final_price"),
            "price_full_fmt": bpo.get("formatted_original_price") or bpo.get("formatted_final_price"),
            "discount": int(bpo.get("discount_pct") or 0),
            "discount_end": min(ends) if ends else None,
            "available": bool(bpo) or bool(it.get("is_free")),
            "linux": bool((it.get("platforms") or {}).get("steamos_linux")),
            # 0 neznáme, 1 nepodporované, 2 hrateľné, 3 overené (Steam Deck)
            "deck": int((it.get("platforms") or {}).get("steam_deck_compat_category") or 0),
            "desc": ((it.get("basic_info") or {}).get("short_description") or "").strip(),
            "developers": [d.get("name") for d in (it.get("basic_info") or {}).get("developers") or [] if d.get("name")],
            "publishers": [d.get("name") for d in (it.get("basic_info") or {}).get("publishers") or [] if d.get("name")],
        }

    @staticmethod
    def items(appids) -> dict:
        """Hromadne cez IStoreBrowseService/GetItems (cena, zľava + koniec zľavy, obrázky)."""
        appids = list(dict.fromkeys(int(a) for a in appids))
        out, missing = {}, []
        for a in appids:
            hit = CACHE.get("store", a, SteamStore.TTL)
            if hit is not None and "desc" in hit:
                out[a] = hit
            else:
                missing.append(a)
        cc = (config().get("country") or COUNTRY).upper()
        for i in range(0, len(missing), 40):
            chunk = missing[i:i + 40]
            req = {
                "ids": [{"appid": a} for a in chunk],
                "context": {"language": "slovak", "country_code": cc},  # bez SK textu vráti angličtinu
                "data_request": {"include_all_purchase_options": True, "include_assets": True,
                                 "include_platforms": True, "include_basic_info": True},
            }
            try:
                d = http_json("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
                              {"input_json": json.dumps(req)})
            except Exception:
                for a in chunk:
                    st = CACHE.stale("store", a)
                    if st:
                        out[a] = st
                continue
            for it in d.get("response", {}).get("store_items", []):
                if not it.get("success") == 1 and not it.get("name"):
                    continue
                v = SteamStore._parse(it)
                out[v["appid"]] = v
                CACHE.put("store", v["appid"], v)
                if v["price"] is not None:
                    CACHE.add_price_point(v["appid"], v["price"], v["discount"])
        CACHE.save(force=True)
        return out

    @staticmethod
    def item(appid: int) -> dict | None:
        return SteamStore.items([appid]).get(int(appid))

    @staticmethod
    def search(term: str, limit: int = 12) -> list:
        term = term.strip()[:80]
        if len(term) < 2:
            return []
        cc = (config().get("country") or COUNTRY).upper()
        d = http_json("https://store.steampowered.com/api/storesearch/",
                      {"term": term, "l": "english", "cc": cc})
        res = []
        for it in d.get("items", [])[:limit]:
            if it.get("type") != "app":
                continue
            p = it.get("price") or {}
            res.append({
                "appid": it["id"],
                "name": it.get("name"),
                "image": it.get("tiny_image"),
                "header": f"{CDN}steam/apps/{it['id']}/header.jpg",
                "price": p.get("final"),
                "price_full": p.get("initial"),
                "linux": bool((it.get("platforms") or {}).get("linux")),
            })
        return res

    @staticmethod
    def names(appids) -> dict:
        return {a: v["name"] for a, v in SteamStore.items(appids).items()}


# --------------------------------------------------------------------------- výpredaje

def _ts(s: str) -> int:
    return int(dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


def next_sale(now: float | None = None) -> dict | None:
    now = now or time.time()
    for s in sorted(config().get("sales") or DEFAULT_SALES, key=lambda s: s["start"]):
        start, end = _ts(s["start"]), _ts(s["end"])
        if end > now:
            name = {"Zimný výpredaj": "Winter Sale", "Jarný výpredaj": "Spring Sale", "Letný výpredaj": "Summer Sale",
                    "Jesenný výpredaj": "Autumn Sale"}.get(s["name"], s["name"]) if ui_lang() == "en" else s["name"]
            return {"name": name, "start": start, "end": end, "active": start <= now,
                    "days": max(0, round((start - now) / DAY, 1))}
    return None


# --------------------------------------------------------------------------- odhad zľavy

def _round5(x: float) -> int:
    return int(5 * round(x / 5))


def estimate_deal(appid: int, store: dict | None = None) -> dict:
    """Aktuálna/odhadovaná zľava a odporúčanie kúp/počkaj.

    Zdroje: Steam (aktuálna zľava + presný koniec), vlastná história cien
    z cache.json a historické minimum z CheapShark.
    """
    store = store or SteamStore.item(appid) or {}
    sale = next_sale()
    now = time.time()
    out = {
        "appid": int(appid),
        "on_sale": store.get("discount", 0) > 0,
        "discount": store.get("discount", 0),
        "ends": store.get("discount_end"),
        "price_fmt": store.get("price_fmt"),
        "price_full_fmt": store.get("price_full_fmt"),
        "free": store.get("is_free", False),
        "next_sale": sale,
    }
    if out["free"] or not store.get("available", True):
        out.update(estimate=None, estimated=False, verdict="info",
                   reason=tr("Hra je zadarmo.", "The game is free.") if out["free"] else tr("Hra sa momentálne nepredáva.", "The game isn't on sale right now."))
        return out

    seen = [h[2] for h in CACHE.history(appid) if h[2] > 0]
    low = CheapShark.lowest(appid)
    best_seen = max(seen, default=0)
    best_ever = max(best_seen, (low or {}).get("pct", 0))
    out["best_ever"] = best_ever or None
    out["lowest"] = low

    if out["on_sale"]:
        out["estimate"], out["estimated"] = out["discount"], False
    elif best_ever:
        # Bežná výpredajová zľava býva ~85 % historického maxima.
        out["estimate"], out["estimated"] = max(10, _round5(best_ever * 0.85)), True
    else:
        out["estimate"], out["estimated"] = None, True

    days_to_sale = (sale["start"] - now) / DAY if sale and not sale["active"] else None
    disc = out["discount"]
    if out["on_sale"]:
        if best_ever and disc >= best_ever - 5:
            v, r = "buy", tr(f"−{disc} % je na úrovni historického minima.", f"−{disc} % matches the all-time low.")
        elif sale and sale["active"]:
            v, r = "buy", tr(f"Prebieha {sale['name'].lower()}, lepšia zľava je nepravdepodobná.", f"The {sale['name']} is on – a better price is unlikely.")
        elif days_to_sale is not None and days_to_sale <= 30 and best_ever > disc + 10:
            v, r = "wait", tr(f"{sale['name']} o {int(days_to_sale)} d, rekord bol −{best_ever} %.", f"{sale['name']} in {int(days_to_sale)} days, the record was −{best_ever} %.")
        elif best_ever > disc + 15:
            v, r = "wait", tr(f"Hra už bola zľavnená až o {best_ever} %.", f"It has been up to {best_ever} % off before.")
        else:
            v, r = "buy", tr("Dobrá zľava, blízko historického minima.", "A good discount, close to the all-time low.")
    else:
        if days_to_sale is not None and days_to_sale <= 45 and best_ever:
            v, r = "wait", tr(f"{sale['name']} o {max(1, int(days_to_sale))} d – odhad ≈ −{out['estimate']} %.", f"{sale['name']} in {max(1, int(days_to_sale))} days – expect about −{out['estimate']} %.")
        elif best_ever >= 25:
            v, r = "wait", tr(f"Bežne sa zľavňuje (až −{best_ever} %).", f"It goes on sale regularly (up to −{best_ever} %).")
        elif not best_ever:
            v, r = "buy", tr("Zľavy zatiaľ nepoznáme – ak ju chceš hrať, nečakaj.", "No sale history yet – if you want to play it, don't wait.")
        else:
            v, r = "buy", tr("Zľavy bývajú malé, čakanie sa veľmi neoplatí.", "Discounts are usually small, waiting isn't worth much.")
    out["verdict"], out["reason"] = v, r
    return out


# --------------------------------------------------------------------------- Steam lokálne

def steam_root() -> Path | None:
    for p in (Path.home() / ".steam/steam", Path.home() / ".local/share/Steam",
              Path.home() / ".var/app/com.valvesoftware.Steam/.local/share/Steam"):
        if (p / "config").is_dir():
            return p.resolve()
    return None


def parse_vdf(text: str) -> dict:
    """Minimalistický parser textového VDF (KeyValues)."""
    tokens = re.findall(r'"((?:[^"\\]|\\.)*)"|([{}])', text)
    root: dict = {}
    stack = [root]
    key = None
    for s, brace in tokens:
        if brace == "{":
            new: dict = {}
            stack[-1][key] = new
            stack.append(new)
            key = None
        elif brace == "}":
            if len(stack) > 1:
                stack.pop()
            key = None
        elif key is None:
            key = s
        else:
            stack[-1][key] = s.replace('\\"', '"').replace("\\\\", "\\")
            key = None
    return root


def _ci(d: dict, *path):
    for k in path:
        if not isinstance(d, dict):
            return None
        d = next((v for kk, v in d.items() if kk.lower() == k.lower()), None)
    return d


def current_steamid() -> str | None:
    sid = str(config().get("steamid") or "").strip()
    if sid.isdigit():
        return sid
    root = steam_root()
    if not root:
        return None
    try:
        users = _ci(parse_vdf((root / "config/loginusers.vdf").read_text(errors="replace")), "users") or {}
    except OSError:
        return None
    best = None
    for sid, u in users.items():
        if _ci(u, "MostRecent") == "1":
            return sid
        best = best or sid
    return best


def account_id(steamid: str) -> int:
    return int(steamid) - 76561197960265728


def local_playtimes() -> dict:
    """{appid: minúty celkovo} z userdata/<acc>/config/localconfig.vdf."""
    root, sid = steam_root(), current_steamid()
    if not root or not sid:
        return {}
    path = root / f"userdata/{account_id(sid)}/config/localconfig.vdf"
    try:
        data = parse_vdf(path.read_text(errors="replace"))
    except OSError:
        return {}
    apps = _ci(data, "UserLocalConfigStore", "Software", "Valve", "Steam", "apps") or {}
    out = {}
    for appid, a in apps.items():
        if appid.isdigit() and isinstance(a, dict):
            pt = _ci(a, "Playtime")
            if pt and pt.isdigit() and int(pt) > 0:
                out[int(appid)] = int(pt)
    return out


# --------------------------------------------------------------------------- Snapshots

class Snapshots:
    """snapshots.json: {"YYYY-MM-DD": {"appid": minúty_celkovo}} – posledný stav dňa."""

    def __init__(self, path: Path = SNAPSHOTS_PATH):
        self.path = path
        self.lock = threading.Lock()

    def load(self) -> dict:
        d = read_json(self.path, {})
        return d if isinstance(d, dict) else {}

    def take(self) -> int:
        totals = local_playtimes()
        if not totals:
            return 0
        with self.lock:
            snaps = self.load()
            snaps[dt.date.today().isoformat()] = {str(k): v for k, v in totals.items()}
            for day in sorted(snaps)[:-120]:  # ~4 mesiace stačí
                del snaps[day]
            write_json(self.path, snaps)
        return len(totals)

    def daily(self, days: int = 7) -> list:
        """[(date, {appid: minúty v ten deň})] pre posledných `days` dní."""
        snaps = self.load()
        ordered = sorted(snaps)
        today = dt.date.today()
        out = []
        for i in range(days - 1, -1, -1):
            day = (today - dt.timedelta(days=i)).isoformat()
            per = {}
            if day in snaps:
                prev = [d for d in ordered if d < day]
                if prev:
                    base = snaps[prev[-1]]
                    for a, m in snaps[day].items():
                        # appka bez predchádzajúceho záznamu = nová/prvé spustenie
                        diff = m - base.get(a, m if not base else 0)
                        if diff > 0:
                            gap = max(1, (dt.date.fromisoformat(day) - dt.date.fromisoformat(prev[-1])).days)
                            per[int(a)] = min(diff, 1440 * gap)
            out.append((day, per))
        return out

    def coverage(self) -> int:
        snaps = self.load()
        today = dt.date.today()
        return sum(1 for i in range(8) if (today - dt.timedelta(days=i)).isoformat() in snaps)


SNAPSHOTS = Snapshots()


# --------------------------------------------------------------------------- Achievementy

def recent_achievements(days: int = 7, limit: int = 12) -> list:
    """Vyžaduje steam_api_key v config.json (Steam Web API). Inak prázdne."""
    cfg = config()
    key, sid = cfg.get("steam_api_key"), current_steamid()
    if not key or not sid:
        return []
    hit = CACHE.get("achievements", sid, 1800)
    if hit is not None:
        return hit
    since = time.time() - days * DAY
    out = []
    try:
        recent = http_json("https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/",
                           {"key": key, "steamid": sid, "count": 10})
        games = recent.get("response", {}).get("games", [])

        def per_game(g):
            appid = g["appid"]
            try:
                pa = http_json("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/",
                               {"key": key, "steamid": sid, "appid": appid, "l": "slovak"})
                got = [a for a in pa.get("playerstats", {}).get("achievements", [])
                       if a.get("achieved") and a.get("unlocktime", 0) >= since]
                if not got:
                    return []
                schema = http_json("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/",
                                   {"key": key, "appid": appid, "l": "slovak"})
                meta = {a["name"]: a for a in schema.get("game", {})
                        .get("availableGameStats", {}).get("achievements", [])}
                return [{
                    "appid": appid, "game": g.get("name"),
                    "name": meta.get(a["apiname"], {}).get("displayName", a["apiname"]),
                    "description": meta.get(a["apiname"], {}).get("description", ""),
                    "icon": meta.get(a["apiname"], {}).get("icon"),
                    "unlocked": a["unlocktime"],
                } for a in got]
            except Exception:
                return []

        with _pool(5) as p:
            for lst in p.map(per_game, games):
                out.extend(lst)
    except Exception:
        return CACHE.stale("achievements", sid) or []
    out.sort(key=lambda a: -a["unlocked"])
    out = out[:limit]
    CACHE.put("achievements", sid, out)
    return out


# --------------------------------------------------------------------------- Wishlist

def wishlist_appids(steamid: str) -> list:
    hit = CACHE.get("wishlist", steamid, 1800)
    if hit is not None:
        return hit
    try:
        d = http_json("https://api.steampowered.com/IWishlistService/GetWishlist/v1/", {"steamid": steamid})
    except Exception:
        return CACHE.stale("wishlist", steamid) or []
    items = sorted(d.get("response", {}).get("items", []), key=lambda i: (i.get("priority") or 1e9, -i.get("date_added", 0)))
    ids = [int(i["appid"]) for i in items]
    CACHE.put("wishlist", steamid, ids)
    return ids

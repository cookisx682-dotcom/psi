"""PSI služba: vkladanie skriptov do Steamu cez CEF, snímky času hrania
a PSI Companion (HTTP server pre mobil v domácej sieti)."""
from __future__ import annotations

import datetime as dt
import json
import os
import logging
import re
import shutil
import subprocess
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import cdp
from . import core
from .core import (CACHE, AntiCheat, CONFIG, SNAPSHOTS, ProtonDB, SteamStore, config, current_steamid,
                   estimate_deal, next_sale, recent_achievements, wishlist_appids)
from .qr import QR

log = logging.getLogger("psi")
HERE = Path(__file__).resolve().parent
INJECT = HERE / "inject"
DAYS_SK = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"]


class Psi:
    def __init__(self):
        self._lock = threading.Lock()
        self._memo: dict = {}
        self.companion = None  # nastaví CompanionServer
        self.theme_listeners: list = []
        self.change_listeners: list = []

    def _changed(self) -> None:
        for fn in list(self.change_listeners):
            try:
                fn()
            except Exception:
                log.exception("zmena nastavení")

    # ------------------------------------------------------------------ memo
    def _cached(self, key, ttl, fn, refresh=False):
        with self._lock:
            hit = self._memo.get(key)
            # refresh nanajvýš raz za 60 s, aby pull-to-refresh nezahltil API
            if hit and (time.time() - hit[0] < ttl) and not (refresh and time.time() - hit[0] > 60):
                return hit[1]
        val = fn()
        with self._lock:
            self._memo[key] = (time.time(), val)
        return val

    # ------------------------------------------------------------------ týždeň
    def week(self, refresh: bool = False) -> dict:
        return self._cached("week", 300, self._week, refresh)

    def _week(self) -> dict:
        if not SNAPSHOTS.load():
            SNAPSHOTS.take()
        daily = SNAPSHOTS.daily(7)
        per_game: Counter = Counter()
        days = []
        for day, per in daily:
            d = dt.date.fromisoformat(day)
            mins = sum(per.values())
            per_game.update(per)
            days.append({"date": day, "label": DAYS_SK[d.weekday()], "minutes": mins,
                         "today": d == dt.date.today()})
        total = sum(per_game.values())
        store = SteamStore.items([a for a, _ in per_game.most_common(8)]) if per_game else {}
        top = []
        for appid, mins in per_game.most_common(6):
            s = store.get(appid, {})
            top.append({"appid": appid, "name": s.get("name", f"App {appid}"), "minutes": mins,
                        "share": round(mins / total * 100) if total else 0,
                        "header": s.get("header") or f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/header.jpg",
                        "days": sum(1 for _, per in daily if per.get(appid))})
        achievements = recent_achievements()
        played_days = sum(1 for d in days if d["minutes"] > 0)
        badges = []
        if total >= 20 * 60:
            badges.append({"id": "marathon", "icon": "🏃", "name": "Maratónec", "desc": "20+ hodín za týždeň"})
        if played_days == 7:
            badges.append({"id": "daily", "icon": "📅", "name": "Každý deň", "desc": "Hral si všetkých 7 dní"})
        if len(per_game) >= 5:
            badges.append({"id": "explorer", "icon": "🧭", "name": "Objaviteľ", "desc": "5+ rôznych hier"})
        if top and top[0]["share"] >= 70 and total >= 5 * 60:
            badges.append({"id": "loyal", "icon": "💜", "name": "Verný", "desc": f"{top[0]['share']} % času v jednej hre"})
        if len(achievements) >= 10:
            badges.append({"id": "hunter", "icon": "🏆", "name": "Lovec", "desc": "10+ achievementov"})
        best = max(days, key=lambda d: d["minutes"]) if days else None
        result = {
            "total_minutes": total,
            "days": days,
            "best_day": best if best and best["minutes"] else None,
            "game_of_week": top[0] if top else None,
            "top": top,
            "achievements": achievements,
            "achievements_enabled": bool(config().get("steam_api_key")),
            "badges": badges,
            "coverage": SNAPSHOTS.coverage(),
            "generated": int(time.time()),
        }
        profile = {k: result[k] for k in ("total_minutes", "game_of_week", "badges", "generated")}
        profile["top"] = [{k: g[k] for k in ("appid", "name", "minutes")} for g in top[:3]]
        profile["achievements"] = len(achievements)
        CONFIG.update(lambda c: c.__setitem__("profile", profile))
        return result

    # ------------------------------------------------------------------ hry
    def protondb(self, appid: int) -> dict:
        return ProtonDB.get(int(appid))

    def deal(self, appid: int) -> dict:
        return estimate_deal(int(appid))

    def linux(self, appid: int) -> dict:
        """ProtonDB + natívna Linux verzia + Steam Deck – pre knižnicu."""
        appid = int(appid)
        s = SteamStore.item(appid) or {}
        return {"appid": appid, "protondb": self.protondb(appid), "native": s.get("linux", False),
                "deck": s.get("deck", 0), "name": s.get("name"), "desc": s.get("desc", ""),
                "anticheat": AntiCheat.get(appid),
                "developers": s.get("developers", []), "publishers": s.get("publishers", [])}

    def tiers(self, appids) -> dict:
        """Hromadne pre kolekcie a wishlist: {appid: {tier, native, deck, ac}}."""
        ids = [int(a) for a in list(appids)[:600]]
        store = SteamStore.items(ids)
        pdb = ProtonDB.many(ids)
        out = {}
        for a in ids:
            st, ac = store.get(a) or {}, AntiCheat.get(a) or {}
            out[str(a)] = {"tier": (pdb.get(a) or {}).get("tier", "pending"), "native": st.get("linux", False),
                           "deck": st.get("deck", 0), "ac": ac.get("status"), "anticheats": ac.get("anticheats", [])}
        CACHE.save(force=True)
        return out

    def perf(self, appid: int) -> dict:
        from . import perf
        appid = int(appid)
        native = (SteamStore.item(appid) or {}).get("linux", False)
        return perf.estimate(appid, native)

    # ------------------------------------------------------------------ písmo
    FONT_EXT = {".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"}

    def fonts(self) -> dict:
        fams = set()
        if shutil.which("fc-list"):
            try:
                out = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True, timeout=10).stdout
                for line in out.splitlines():
                    f = line.split(",")[0].strip()
                    if f and not f.startswith("."):
                        fams.add(f)
            except Exception:
                pass
        cur = config().get("font") or {}
        return {"system": sorted(fams, key=str.lower), "current": cur.get("family", ""), "custom": cur.get("file", "")}

    def font_css(self) -> dict:
        import base64
        cur = config().get("font") or {}
        fam, fname = cur.get("family", ""), cur.get("file", "")
        if not fam:
            return {"family": "", "face": ""}
        face = ""
        if fname:
            path = core.DATA_DIR / "fonts" / fname
            ext = path.suffix.lower()
            if path.is_file() and ext in self.FONT_EXT:
                data = base64.b64encode(path.read_bytes()).decode()
                face = f'@font-face{{font-family:"{fam}";src:url(data:{self.FONT_EXT[ext]};base64,{data});font-display:swap}}'
        return {"family": fam, "face": face}

    def set_font(self, family: str) -> dict:
        family = re.sub(r'["\\;{}<>]', "", str(family or ""))[:80]
        CONFIG.update(lambda c: c.__setitem__("font", {"family": family, "file": ""}))
        self._changed()
        return self.fonts()

    def upload_font(self, name: str, data_b64: str) -> dict:
        import base64
        ext = Path(str(name)).suffix.lower()
        if ext not in self.FONT_EXT:
            raise ValueError("Podporované sú .ttf, .otf, .woff, .woff2")
        raw = base64.b64decode(data_b64, validate=True)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError("Súbor je väčší ako 8 MB")
        magic = raw[:4]
        if magic not in (b"\x00\x01\x00\x00", b"true", b"OTTO", b"wOFF", b"wOF2"):
            raise ValueError("Súbor nevyzerá ako písmo")
        folder = core.DATA_DIR / "fonts"
        folder.mkdir(parents=True, exist_ok=True)
        stem = re.sub(r"[^A-Za-z0-9 _-]", "", Path(str(name)).stem)[:40] or "font"
        fname = f"{stem}{ext}"
        (folder / fname).write_bytes(raw)
        family = f"PSI {stem}"
        CONFIG.update(lambda c: c.__setitem__("font", {"family": family, "file": fname}))
        self._changed()
        return self.fonts()

    def game(self, appid: int) -> dict:
        appid = int(appid)
        s = SteamStore.item(appid)
        if not s:
            return {"appid": appid, "error": "not_found"}
        return {**s, "protondb": self.protondb(appid), "deal": estimate_deal(appid, s)}

    def search(self, q: str) -> list:
        q = (q or "").strip()[:80]
        if len(q) < 2:
            return []

        def run():
            res = SteamStore.search(q)
            tiers = ProtonDB.many([r["appid"] for r in res])
            for r in res:
                r["protondb"] = tiers.get(r["appid"])
            return res

        return self._cached(("search", q.lower()), 600, run)

    def wishlist(self, refresh: bool = False) -> dict:
        return self._cached("wishlist", 600, self._wishlist, refresh)

    def _wishlist(self) -> dict:
        sid = current_steamid()
        if not sid:
            return {"items": [], "error": "no_steam_user", "next_sale": next_sale()}
        ids = wishlist_appids(sid)
        store = SteamStore.items(ids)
        tiers = ProtonDB.many(ids)
        with ThreadPoolExecutor(8) as p:
            deals = dict(zip(ids, p.map(lambda a: estimate_deal(a, store.get(a)) if store.get(a) else None, ids)))
        CACHE.save(force=True)
        items = []
        for rank, a in enumerate(ids):
            s = store.get(a)
            if not s:
                continue
            items.append({**s, "rank": rank, "protondb": tiers.get(a), "deal": deals.get(a)})
        items.sort(key=lambda i: (not i["discount"], i["discount_end"] or 1e12 if i["discount"] else 0, i["rank"]))
        return {"items": items, "next_sale": next_sale(), "on_sale": sum(1 for i in items if i["discount"]),
                "generated": int(time.time())}

    def companion_info(self) -> dict:
        c = self.companion
        return {"url": c.url if c else None, "local_url": c.local_url if c else None,
                "pin": config()["companion"]["pin"], "running": bool(c and (c.httpd or c.local))}

    def companion_qr(self) -> dict:
        """QR matica pre mobilnú adresu (vykreslí sa ako SVG v Nastaveniach)."""
        c = self.companion
        if not c or not c.url:
            return {"url": None, "matrix": []}
        return {"url": c.url, "matrix": ["".join("1" if m else "0" for m in row) for row in QR(c.url).matrix(0)]}

    def features(self) -> dict:
        return core.features()

    def set_feature(self, name: str, value: bool) -> dict:
        f = core.set_feature(name, value)
        self._changed()
        if self.companion and name == "companion_lan":
            self.companion.wake()
        return f

    def disk(self, appid: int = 0) -> dict:
        """Voľné miesto na disku knižnice Steamu, kde je (bude) hra nainštalovaná."""
        root = core.steam_root()
        paths = []
        if root:
            try:
                data = core.parse_vdf((root / "steamapps/libraryfolders.vdf").read_text(errors="replace"))
                lf = core._ci(data, "libraryfolders") or {}
                for v in lf.values():
                    if isinstance(v, dict) and core._ci(v, "path"):
                        paths.append(Path(core._ci(v, "path")))
            except OSError:
                pass
            if not paths:
                paths = [root]
        best = None
        for pth in paths:
            if appid and (pth / f"steamapps/appmanifest_{int(appid)}.acf").exists():
                best = pth
                break
        best = best or (paths[0] if paths else Path.home())
        try:
            u = shutil.disk_usage(best)
        except OSError:
            return {"path": str(best), "free": None, "total": None}
        return {"path": str(best), "free": u.free, "total": u.total}

    # ------------------------------------------------------------------ knižnica pre launcher
    def save_library(self, apps) -> dict:
        """psi.js pošle zoznam vlastnených hier; doplníme dáta a uložíme library.json pre launcher."""
        clean = []
        for a in list(apps or [])[:5000]:
            try:
                clean.append({"appid": int(a["appid"]), "name": str(a.get("name") or "")[:200],
                              "playtime": int(a.get("playtime") or 0), "last_played": int(a.get("last_played") or 0)})
            except (KeyError, TypeError, ValueError):
                continue
        threading.Thread(target=self._write_library, args=(clean,), daemon=True, name="psi-library").start()
        return {"count": len(clean)}

    @staticmethod
    def installed_games() -> dict:
        """{appid: {dir, size, steamworks}} z appmanifest_*.acf vo všetkých knižniciach Steamu."""
        root = core.steam_root()
        out = {}
        if not root:
            return out
        paths = []
        try:
            lf = core._ci(core.parse_vdf((root / "steamapps/libraryfolders.vdf").read_text(errors="replace")), "libraryfolders") or {}
            paths = [Path(core._ci(v, "path")) for v in lf.values() if isinstance(v, dict) and core._ci(v, "path")]
        except OSError:
            pass
        for lib in paths or [root]:
            for man in (lib / "steamapps").glob("appmanifest_*.acf"):
                try:
                    st = core._ci(core.parse_vdf(man.read_text(errors="replace")), "AppState") or {}
                    appid = int(core._ci(st, "appid"))
                except (OSError, TypeError, ValueError):
                    continue
                gdir = lib / "steamapps/common" / str(core._ci(st, "installdir") or "")
                full = (int(core._ci(st, "StateFlags") or 0) & 4) == 4
                # Steamworks knižnica = hra pravdepodobne potrebuje bežiaci Steam
                steamworks, n = False, 0
                if gdir.is_dir():
                    for dp, dn, fn in os.walk(gdir):
                        n += 1
                        if n > 4000 or dp.count(os.sep) - str(gdir).count(os.sep) > 4:
                            dn[:] = []
                            continue
                        if any(f.lower() in ("libsteam_api.so", "steam_api.dll", "steam_api64.dll") for f in fn):
                            steamworks = True
                            break
                out[appid] = {"dir": str(gdir), "size": int(core._ci(st, "SizeOnDisk") or 0),
                              "installed": full, "steamworks": steamworks}
        return out

    def _write_library(self, apps: list) -> None:
        from . import perf
        try:
            ids = [a["appid"] for a in apps]
            tiers = self.tiers(ids)
            store = SteamStore.items(ids)
            inst = self.installed_games()
            rows = []
            for a in apps:
                aid = a["appid"]
                t, st, ins = tiers.get(str(aid), {}), store.get(aid, {}), inst.get(aid)
                try:
                    pe = perf.estimate(aid, st.get("linux", False))
                    fps = {"high": pe.get("fps_high"), "low": pe.get("fps_low"), "preset": pe.get("preset")}
                except Exception:
                    fps = None
                rows.append({**a, "installed": bool(ins and ins["installed"]), "size": ins["size"] if ins else 0,
                             "steamworks": ins["steamworks"] if ins else None,
                             "tier": t.get("tier", "pending"), "native": t.get("native", False), "deck": t.get("deck", 0),
                             "anticheat": t.get("ac"), "anticheats": t.get("anticheats", []),
                             "desc": st.get("desc", ""), "developers": st.get("developers", []), "fps": fps})
            core.write_json(core.DATA_DIR / "library.json", {"generated": int(time.time()), "pc": perf.hardware(), "apps": rows})
            log.info("library.json: %d hier pre launcher", len(rows))
        except Exception:
            log.exception("library.json")

    # ------------------------------------------------------------------ Millennium témy
    def millennium(self) -> dict:
        from . import millennium as mi
        mi.THEMES_DIR.mkdir(parents=True, exist_ok=True)
        return {"themes": mi.list_themes(), "current": mi.current(), "dir": str(mi.THEMES_DIR)}

    def millennium_set(self, theme_id: str) -> dict:
        from . import millennium as mi
        mi.set_theme(str(theme_id or ""))
        self._changed()
        return self.millennium()

    def millennium_patches(self) -> list:
        from . import millennium as mi
        return mi.patches("client")

    def millennium_install(self, url: str) -> dict:
        from . import millennium as mi
        t = mi.install_from_github(str(url or ""))
        return {**self.millennium(), "installed": t}

    def millennium_open(self) -> dict:
        from . import millennium as mi
        mi.THEMES_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.Popen(["xdg-open", str(mi.THEMES_DIR)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"ok": True}

    def theme(self) -> dict:
        return core.theme()

    def set_theme(self, t: dict) -> dict:
        new = core.set_theme(t)
        for fn in list(self.theme_listeners):
            try:
                fn(new)
            except Exception:
                log.exception("téma")
        return new

    def new_pin(self) -> dict:
        core.ensure_pin(regenerate=True)
        return self.companion_info()

    def me(self) -> dict:
        return {"steamid": current_steamid()}


# ---------------------------------------------------------------------- CEF injector

# Webové stránky (obchod, komunita) sú cudzí obsah – dostanú len read-only metódy
# a nikdy nie PIN.
BRIDGE_METHODS = {
    "shared": {"week", "wishlist", "deal", "protondb", "game", "linux", "tiers", "perf", "search", "companion_info", "me",
               "fonts", "font_css", "set_font", "upload_font",
               "companion_qr", "features", "set_feature", "new_pin", "theme", "set_theme", "disk", "save_library",
               "millennium", "millennium_set", "millennium_patches", "millennium_install", "millennium_open"},
    "web": {"deal", "protondb", "game", "linux", "tiers", "perf", "week", "me", "features", "font_css", "theme"},
}


class Injector(threading.Thread):
    def __init__(self, psi: Psi):
        super().__init__(daemon=True, name="psi-injector")
        self.psi = psi
        self.sessions: dict[str, cdp.Session] = {}
        self.pool = ThreadPoolExecutor(4, thread_name_prefix="psi-bridge")
        self._warned = False
        self.browser_ok = False
        psi.theme_listeners.append(self.broadcast_theme)

    def broadcast_theme(self, t: dict) -> None:
        expr = f"window.__psiApplyTheme && window.__psiApplyTheme({json.dumps(t)})"
        for s in list(self.sessions.values()):
            try:
                s.notify("Runtime.evaluate", {"expression": expr})
            except OSError:
                pass

    @staticmethod
    def kind(t: dict) -> str | None:
        if t.get("type") != "page":
            return None
        if t.get("title") == "SharedJSContext":
            return "shared"
        url = t.get("url", "")
        if url.startswith(("https://store.steampowered.com/", "https://steamcommunity.com/")):
            return "web"
        return None

    def script(self, kind: str) -> str:
        files = ["psi.js"] if kind == "shared" else ["store.js", "community.js"]
        body = "\n;\n".join((INJECT / f).read_text(encoding="utf-8") for f in files)
        if kind == "web":
            # štýly sa aplikujú synchrónne hneď na začiatku stránky – bez čakania na most
            boot = {"features": core.features(), "theme": core.theme()}
            try:
                from . import millennium as mi
                boot["millennium"] = mi.patches("web")
            except Exception:
                boot["millennium"] = []
            try:
                boot["font"] = self.psi.font_css()
            except Exception:
                boot["font"] = {"family": "", "face": ""}
            body = f"window.__PSI_BOOT = {json.dumps(boot, ensure_ascii=False)};\n" + body
        return body

    def run(self) -> None:
        while True:
            try:
                self.tick()
            except Exception:
                log.exception("injector")
            time.sleep(1)

    def tick(self) -> None:
        try:
            targets = cdp.list_targets()
            if not isinstance(targets, list):
                raise ValueError("na porte 8080 beží iný program, nie Steam CEF")
            self._warned = False
        except (OSError, ValueError) as e:
            if not self._warned:
                log.warning("Steam CEF (127.0.0.1:8080) nedostupný (%s) – čakám. "
                            "Beží Steam s .cef-enable-remote-debugging a je port 8080 voľný?", e)
                self._warned = True
            return
        live = set()
        for t in targets:
            k = self.kind(t)
            if not k or (k == "web" and self.browser_ok):
                continue
            live.add(t["id"])
            s = self.sessions.get(t["id"])
            if s and s.alive:
                continue
            try:
                self.attach(t, k)
            except Exception as e:
                log.warning("Pripojenie k %s zlyhalo: %s", t.get("title") or t.get("url"), e)
        for tid in list(self.sessions):
            if tid not in live or not self.sessions[tid].alive:
                self.sessions.pop(tid).close()

    def attach(self, t: dict, kind: str) -> None:
        s = cdp.Session(t, lambda sess, m, p: self.on_event(sess, kind, m, p))
        self.sessions[t["id"]] = s
        src = self.script(kind)
        s.call("Runtime.enable")
        s.call("Runtime.addBinding", {"name": "__psiBridge"})
        try:
            s.call("Page.enable")
            s.call("Page.addScriptToEvaluateOnNewDocument", {"source": src})
        except Exception:
            pass
        r = s.call("Runtime.evaluate", {"expression": src, "awaitPromise": False})
        if r.get("exceptionDetails"):
            log.warning("Chyba skriptu v %s: %s", kind, r["exceptionDetails"].get("text"))
        log.info("PSI vložené do %s (%s)", t.get("title"), kind)

    def on_event(self, s: cdp.Session, kind: str, method: str, params: dict) -> None:
        if method != "Runtime.bindingCalled" or params.get("name") != "__psiBridge":
            return
        self.pool.submit(self.handle, s, kind, params)

    def handle(self, s: cdp.Session, kind: str, params: dict) -> None:
        sid = params.get("__sid")
        rid = None
        try:
            req = json.loads(params.get("payload") or "{}")
            rid, method, args = req.get("id"), req.get("method"), req.get("params") or {}
            if method not in BRIDGE_METHODS[kind]:
                raise PermissionError(f"metóda {method!r} nie je povolená")
            fn = getattr(self.psi, method)
            if method in ("deal", "protondb", "game", "linux", "perf", "disk"):
                result = fn(int(args["appid"]))
            elif method == "search":
                result = fn(str(args.get("q", "")))
            elif method == "tiers":
                result = fn([int(a) for a in args.get("appids", [])])
            elif method == "set_font":
                result = fn(str(args.get("family", "")))
            elif method == "upload_font":
                result = fn(str(args.get("name", "")), str(args.get("data", "")))
            elif method == "millennium_set":
                result = fn(str(args.get("id", "")))
            elif method == "millennium_install":
                result = fn(str(args.get("url", "")))
            elif method == "save_library":
                result = fn(args.get("apps") or [])
            elif method == "set_theme":
                result = fn(args.get("theme") or {})
            elif method == "set_feature":
                result = fn(str(args.get("name")), bool(args.get("value")))
            else:
                result = fn()
            reply = {"ok": True, "result": result}
        except Exception as e:
            reply = {"ok": False, "error": str(e)}
        expr = f"window.__psiReply && window.__psiReply({json.dumps(rid)}, {json.dumps(reply, ensure_ascii=False)})"
        try:
            s.notify("Runtime.evaluate", {"expression": expr, "contextId": params.get("executionContextId")}, session_id=sid)
        except OSError:
            pass


class BrowserWatch(threading.Thread):
    """Okamžité vloženie do stránok obchodu/komunity.

    Cez kanál celého prehliadača Steamu (Target.setDiscoverTargets) sa PSI pripojí
    ku každej stránke hneď, ako vznikne, a zaregistruje skript, ktorý sa spustí na
    úplnom začiatku každého načítania (document start) – štýly sú tam skôr, než sa
    stránka vykreslí. Pri zmene témy/písma/prepínačov sa skript obnoví.
    """

    def __init__(self, injector: "Injector"):
        super().__init__(daemon=True, name="psi-browser")
        self.injector = injector
        self.session: cdp.Session | None = None
        self.pool = ThreadPoolExecutor(4, thread_name_prefix="psi-attach")
        self.lock = threading.Lock()
        self.targets: dict = {}   # targetId -> {"sid": ..., "script": id}
        self.web_sids: set = set()

    @staticmethod
    def wanted(ti: dict) -> bool:
        if ti.get("type") != "page" or ti.get("title") == "SharedJSContext":
            return False
        url = ti.get("url", "")
        if "createflags=" in url or "steamloopback.host" in url:
            return False
        return url.startswith(("https://store.steampowered.com/", "https://steamcommunity.com/")) or \
            url in ("", "about:blank") or url.startswith("data:text/html")

    def run(self) -> None:
        while True:
            try:
                ws = cdp.browser_ws()
                if ws:
                    s = cdp.Session({"webSocketDebuggerUrl": ws, "title": "browser"}, self.on_event)
                    self.session = s
                    s.call("Target.setDiscoverTargets", {"discover": True})
                    self.injector.browser_ok = True
                    log.info("PSI: okamžité vkladanie do stránok obchodu zapnuté")
                    while s.alive:
                        time.sleep(1)
            except Exception as e:
                log.debug("browser watch: %s", e)
            self.injector.browser_ok = False
            with self.lock:
                self.targets.clear()
                self.web_sids.clear()
            time.sleep(3)

    def on_event(self, s: cdp.Session, method: str, params: dict) -> None:
        if method in ("Target.targetCreated", "Target.targetInfoChanged"):
            ti = params.get("targetInfo") or {}
            tid = ti.get("targetId")
            if tid and self.wanted(ti):
                with self.lock:
                    if tid in self.targets:
                        return
                    self.targets[tid] = {"sid": None, "script": None}
                self.pool.submit(self.attach, s, ti)
        elif method == "Target.targetDestroyed":
            with self.lock:
                info = self.targets.pop(params.get("targetId"), None)
                if info:
                    self.web_sids.discard(info.get("sid"))
        elif method == "Runtime.bindingCalled" and params.get("name") == "__psiBridge" and params.get("__sid") in self.web_sids:
            self.injector.pool.submit(self.injector.handle, s, "web", params)

    def attach(self, s: cdp.Session, ti: dict) -> None:
        tid = ti["targetId"]
        try:
            sid = s.call("Target.attachToTarget", {"targetId": tid, "flatten": True})["sessionId"]
            src = self.injector.script("web")
            s.call("Page.enable", session_id=sid)
            s.call("Runtime.enable", session_id=sid)
            s.call("Runtime.addBinding", {"name": "__psiBridge"}, session_id=sid)
            ident = s.call("Page.addScriptToEvaluateOnNewDocument", {"source": src}, session_id=sid).get("identifier")
            with self.lock:
                self.targets[tid] = {"sid": sid, "script": ident}
                self.web_sids.add(sid)
            s.call("Runtime.evaluate", {"expression": src}, session_id=sid)   # aktuálne načítaná stránka
            log.info("PSI pripojené k %s", (ti.get("url") or "nová stránka")[:70])
        except Exception as e:
            log.debug("attach %s: %s", ti.get("url"), e)
            with self.lock:
                self.targets.pop(tid, None)

    def refresh(self) -> None:
        """Nová téma/písmo/prepínače → nový skript pre ďalšie načítania."""
        s = self.session
        if not s or not s.alive:
            return
        src = self.injector.script("web")
        with self.lock:
            items = list(self.targets.items())
        for tid, info in items:
            sid = info.get("sid")
            if not sid:
                continue
            try:
                if info.get("script"):
                    s.call("Page.removeScriptToEvaluateOnNewDocument", {"identifier": info["script"]}, session_id=sid)
                info["script"] = s.call("Page.addScriptToEvaluateOnNewDocument", {"source": src}, session_id=sid).get("identifier")
            except Exception:
                pass

    def broadcast(self, expr: str) -> None:
        s = self.session
        for sid in list(self.web_sids):
            try:
                s.notify("Runtime.evaluate", {"expression": expr}, session_id=sid)
            except Exception:
                pass


# ---------------------------------------------------------------------- spustenie

def snapshot_loop() -> None:
    while True:
        try:
            n = SNAPSHOTS.take()
            log.debug("snímka: %d hier", n)
        except Exception:
            log.exception("snímka zlyhala")
        CACHE.save(force=True)
        time.sleep(30 * 60)


def _notify(title: str, body: str) -> None:
    try:
        from .companion.server import icon
        from .core import DATA_DIR
        icon("icon-192.png")  # vytvorí súbor ikony, ak chýba
        ico = str(DATA_DIR / "icons" / "v1-icon-192.png")
        subprocess.run(["notify-send", "-a", "PSI", "-i", ico, title, body], timeout=10, check=False)
    except Exception:
        log.exception("notify-send")


def notify_deals(psi: Psi) -> int:
    """Notifikácia, keď hra z wishlistu zľavní (raz za každú zľavu)."""
    w = psi.wishlist(refresh=True)
    sent = CACHE.data.setdefault("notified", {})
    new = []
    for it in w.get("items", []):
        if not it.get("discount"):
            continue
        key = f"{it.get('discount_end') or ''}:{it['discount']}"
        if sent.get(str(it["appid"])) == key:
            continue
        d = it.get("deal") or {}
        low = bool(d.get("best_ever")) and it["discount"] >= d["best_ever"] - 5
        new.append((it, low))
        sent[str(it["appid"])] = key
    CACHE._dirty = True
    CACHE.save(force=True)
    if not new:
        return 0
    new.sort(key=lambda x: (not x[1], -x[0]["discount"]))
    if len(new) <= 3:
        for it, low in new:
            ends = dt.datetime.fromtimestamp(it["discount_end"]).strftime("%-d. %-m. %H:%M") if it.get("discount_end") else ""
            body = (("🏆 Historické minimum! " if low else "") + f"{it.get('price_fmt') or ''} (pôvodne {it.get('price_full_fmt') or ''})"
                    + (f" · končí {ends}" if ends else ""))
            _notify(f"−{it['discount']} % · {it['name']}", body)
    else:
        lines = [f"−{it['discount']} % {it['name']}" + (" 🏆" if low else "") for it, low in new[:6]]
        _notify(f"{len(new)} hier z wishlistu je v zľave", "\n".join(lines))
    return len(new)


REPO = HERE.parent


def _git(*args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, timeout=timeout)


def check_update(apply: bool = True) -> str:
    """Nová verzia na GitHube → git pull --ff-only → reštart služby. Vráti stav ako text."""
    if not (REPO / ".git").exists() or not shutil.which("git"):
        return "no-git"
    if _git("fetch", "--quiet", "origin").returncode != 0:
        return "offline"
    branch = _git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip() or "main"
    behind = _git("rev-list", "--count", f"HEAD..origin/{branch}").stdout.strip()
    if not behind.isdigit() or int(behind) == 0:
        return "up-to-date"
    if _git("status", "--porcelain", "--untracked-files=no").stdout.strip():
        log.warning("Aktualizácia PSI preskočená – máš lokálne zmeny v súboroch.")
        return "local-changes"
    if not apply:
        return f"available:{behind}"
    r = _git("pull", "--ff-only", "--quiet", "origin", branch)
    if r.returncode != 0:
        log.warning("Aktualizácia PSI zlyhala: %s", r.stderr.strip()[:200])
        return "failed"
    msg = _git("log", "-1", "--pretty=%s").stdout.strip()
    log.info("PSI aktualizované (%s commitov): %s", behind, msg)
    _notify("PSI aktualizované", msg or "Nová verzia je nainštalovaná.")
    CACHE.save(force=True)
    os.execv(sys.executable, [sys.executable, "-m", "psi", "run"])   # reštart do novej verzie
    return "restarting"


def update_loop() -> None:
    time.sleep(120)
    while True:
        try:
            if core.features().get("auto_update", True):
                check_update()
        except Exception:
            log.exception("kontrola aktualizácie")
        time.sleep(6 * 3600)


def deal_loop(psi: Psi) -> None:
    time.sleep(90)  # nech sa najprv rozbehne Steam a sieť
    while True:
        try:
            if core.features().get("notify", True) and shutil.which("notify-send"):
                n = notify_deals(psi)
                if n:
                    log.info("Notifikácia: %d zliav na wishliste", n)
        except Exception:
            log.exception("kontrola zliav zlyhala")
        time.sleep(3 * 3600)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    config()  # vytvorí config.json + PIN pri prvom štarte
    psi = Psi()
    threading.Thread(target=snapshot_loop, daemon=True, name="psi-snapshots").start()
    threading.Thread(target=deal_loop, args=(psi,), daemon=True, name="psi-deals").start()
    threading.Thread(target=update_loop, daemon=True, name="psi-update").start()
    inj = Injector(psi)
    inj.start()
    bw = BrowserWatch(inj)
    bw.start()
    psi.theme_listeners.append(lambda t: bw.broadcast(f"window.__psiApplyTheme && window.__psiApplyTheme({json.dumps(t)})"))
    psi.theme_listeners.append(lambda t: bw.refresh())
    psi.change_listeners.append(bw.refresh)
    if config()["companion"].get("enabled", True):
        from .companion.server import CompanionServer
        CompanionServer(psi).start()  # samostatné vlákno
    log.info("PSI beží.")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        CACHE.save(force=True)

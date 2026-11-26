"""Game icons for the taskbar / dock.

Proton games open windows with the class ``steam_app_<appid>``. Docks (Crystal Dock, the KDE task
manager…) look for a .desktop entry whose ``StartupWMClass`` matches; without one they show a blank
icon. PSI writes a hidden entry (``NoDisplay=true``, not shown in app menus) for every installed
game, with the game's real 256 px icon from Steam.
"""
from __future__ import annotations

import logging
import re
import struct
import urllib.request
from pathlib import Path

from .core import DATA_DIR, UA, steam_root

log = logging.getLogger("psi.icons")

APPS_DIR = Path.home() / ".local/share/applications"
ICON_DIR = DATA_DIR / "icons" / "games"
PREFIX = "psi-steam-"
_MISSING: set = set()
CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{appid}/{hash}.ico"


# --------------------------------------------------------------------------- appinfo.vdf

def _read_kv(buf: bytes, pos: int, keys: list | None) -> tuple[dict, int]:
    """Binary KeyValues (appinfo v28/v29). Returns (dict, new position)."""
    out: dict = {}
    n = len(buf)
    while pos < n:
        t = buf[pos]
        pos += 1
        if t in (0x08, 0x0B):
            return out, pos
        if keys is not None:
            idx = struct.unpack_from("<I", buf, pos)[0]
            pos += 4
            key = keys[idx] if idx < len(keys) else ""
        else:
            end = buf.index(b"\0", pos)
            key = buf[pos:end].decode("utf-8", "replace")
            pos = end + 1
        if t == 0x00:
            out[key], pos = _read_kv(buf, pos, keys)
        elif t == 0x01:
            end = buf.index(b"\0", pos)
            out[key] = buf[pos:end].decode("utf-8", "replace")
            pos = end + 1
        elif t in (0x02, 0x03, 0x04, 0x06):
            out[key] = struct.unpack_from("<i", buf, pos)[0]
            pos += 4
        elif t in (0x07, 0x0A):
            out[key] = struct.unpack_from("<q", buf, pos)[0]
            pos += 8
        else:
            raise ValueError(f"unknown KeyValues type {t:#x}")
    return out, pos


def app_info(appids: set) -> dict:
    """{appid: {"name", "clienticon"}} for the given apps, read from Steam's appinfo.vdf."""
    root = steam_root()
    if not root or not appids:
        return {}
    try:
        buf = (root / "appcache/appinfo.vdf").read_bytes()
    except OSError:
        return {}
    magic = struct.unpack_from("<I", buf, 0)[0]
    version = magic & 0xFF
    if magic >> 8 != 0x075644 or version < 0x27:
        log.warning("appinfo.vdf: unknown format %#x", magic)
        return {}
    pos, keys = 8, None
    if version >= 0x29:
        st = struct.unpack_from("<q", buf, 8)[0]
        pos = 16
        count = struct.unpack_from("<I", buf, st)[0]
        keys, p = [], st + 4
        for _ in range(count):
            end = buf.index(b"\0", p)
            keys.append(buf[p:end].decode("utf-8", "replace"))
            p = end + 1
    out = {}
    while pos + 8 <= len(buf):
        appid, size = struct.unpack_from("<II", buf, pos)
        if appid == 0:
            break
        start, nxt = pos + 8, pos + 8 + size
        if appid in appids:
            # info_state, last_updated, pics_token, sha1, change_number, binary sha1 = 60 bytes
            body = start + 4 + 4 + 8 + 20 + 4 + 20
            try:
                kv, _ = _read_kv(buf, body, keys)
                kv = kv.get("appinfo") or next(iter(kv.values()), {}) if kv else {}
                common = (kv.get("common") or {}) if isinstance(kv, dict) else {}
                out[appid] = {"name": str(common.get("name") or ""), "clienticon": str(common.get("clienticon") or "")}
            except (ValueError, struct.error, IndexError):
                pass
        pos = nxt
    return out


# --------------------------------------------------------------------------- icons

def _best_frame(ico: bytes) -> tuple[bytes, str]:
    """Largest PNG frame of an .ico (Steam icons carry a 256 px PNG); else the .ico itself."""
    try:
        reserved, kind, count = struct.unpack_from("<HHH", ico, 0)
        if reserved != 0 or kind != 1:
            return ico, ".ico"
        best = None
        for i in range(count):
            w, h, _, _, _, _, size, off = struct.unpack_from("<BBBBHHII", ico, 6 + 16 * i)
            px = (w or 256) * (h or 256)
            data = ico[off:off + size]
            if data[:8] == b"\x89PNG\r\n\x1a\n" and (best is None or px > best[0]):
                best = (px, data)
        if best:
            return best[1], ".png"
    except struct.error:
        pass
    return ico, ".ico"


def _icon_file(appid: int, clienticon: str) -> Path | None:
    for ext in (".png", ".ico"):
        f = ICON_DIR / f"{appid}{ext}"
        if f.is_file() and f.stat().st_size > 0:
            return f
    if not re.fullmatch(r"[0-9a-f]{40}", clienticon or ""):
        return None
    root = steam_root()
    local = root / "steam/games" / f"{clienticon}.ico" if root else None
    try:
        if local and local.is_file():
            data = local.read_bytes()
        else:
            req = urllib.request.Request(CDN.format(appid=appid, hash=clienticon), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read(4 * 1024 * 1024)
    except OSError as e:
        log.debug("icon %s: %s", appid, e)
        return None
    data, ext = _best_frame(data)
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    f = ICON_DIR / f"{appid}{ext}"
    f.write_bytes(data)
    return f


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("\n", " ").replace("\r", " ").strip()


def sync(games: dict) -> int:
    """Write/refresh hidden .desktop entries for {appid: {...}} installed games; remove stale ones.

    Returns how many entries changed."""
    tools = {228980, 1070560, 1391110, 1628350, 1493710, 2180100, 1826330, 3658110}  # runtimes, Proton
    want = {int(a) for a in games} - tools
    info = app_info(want)
    APPS_DIR.mkdir(parents=True, exist_ok=True)
    changed = 0
    _MISSING.clear()
    for appid in sorted(want):
        meta = info.get(appid) or {}
        name = meta.get("name") or ""
        if not name or re.search(r"proton|steam linux runtime|steamworks common", name, re.I):
            continue
        icon = _icon_file(appid, meta.get("clienticon", ""))
        if not icon:
            _MISSING.add(appid)          # napr. výpadok siete – skúsi sa znova o 10 minút
            continue
        text = ("[Desktop Entry]\nType=Application\n"
                f"Name={_esc(name)}\nComment=Steam (PSI)\n"
                f"Exec=steam steam://rungameid/{appid}\nIcon={icon}\nTerminal=false\n"
                f"Categories=Game;\nStartupWMClass=steam_app_{appid}\nNoDisplay=true\nX-PSI=1\n")
        f = APPS_DIR / f"{PREFIX}{appid}.desktop"
        try:
            if not f.is_file() or f.read_text(encoding="utf-8") != text:
                f.write_text(text, encoding="utf-8")
                changed += 1
        except OSError:
            log.exception("desktop entry %s", appid)
    for f in APPS_DIR.glob(f"{PREFIX}*.desktop"):
        m = re.fullmatch(PREFIX + r"(\d+)\.desktop", f.name)
        if m and int(m[1]) not in want:
            try:
                if "X-PSI=1" in f.read_text(encoding="utf-8", errors="replace"):
                    f.unlink()
                    changed += 1
            except OSError:
                pass
    if changed:
        log.info("dock icons: %d entries updated", changed)
    return changed


def installed_appids() -> set:
    """App IDs from appmanifest_*.acf in every Steam library (cheap – no game folder walking)."""
    from .core import _ci, parse_vdf
    root = steam_root()
    if not root:
        return set()
    libs = [root]
    try:
        lf = _ci(parse_vdf((root / "steamapps/libraryfolders.vdf").read_text(errors="replace")), "libraryfolders") or {}
        libs = [Path(_ci(v, "path")) for v in lf.values() if isinstance(v, dict) and _ci(v, "path")] or [root]
    except OSError:
        pass
    out = set()
    for lib in libs:
        for man in (lib / "steamapps").glob("appmanifest_*.acf"):
            m = re.fullmatch(r"appmanifest_(\d+)\.acf", man.name)
            if m:
                out.add(int(m[1]))
    return out


def loop(enabled) -> None:
    """At PSI start, then every 10 minutes (new installs / uninstalls)."""
    import time
    last = None
    while True:
        try:
            if enabled():
                ids = installed_appids()
                if ids != last or _MISSING:
                    sync({a: {} for a in ids})
                    last = ids
            elif last is not None:
                remove_all()
                last = None
        except Exception:
            log.exception("dock icons")
        time.sleep(600)


def remove_all() -> None:
    for f in APPS_DIR.glob(f"{PREFIX}*.desktop"):
        try:
            if "X-PSI=1" in f.read_text(encoding="utf-8", errors="replace"):
                f.unlink()
        except OSError:
            pass

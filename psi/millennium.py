"""Millennium themes (steambrew.app) for PSI – CSS only.

A Millennium theme is a folder with ``skin.json`` and CSS files. PSI reads the patch list
(window-title / URL regex → CSS file), inlines referenced assets (images, fonts) as data URLs
and returns ready-to-inject CSS. JavaScript from themes is never executed.
"""
from __future__ import annotations

import base64
import io
import json
import mimetypes
import re
import shutil
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from urllib.parse import quote

from .core import CONFIG, DATA_DIR, UA, config, tr

THEMES_DIR = DATA_DIR / "millennium"

# Millennium's default patches (used when a theme has no "Patches" or sets UseDefaultPatches)
DEFAULT_PATCHES = [
    {"MatchRegexString": r".*http.*steam.*", "TargetCss": "webkit.css"},
    {"MatchRegexString": r"^Steam$", "TargetCss": "libraryroot.custom.css"},
    {"MatchRegexString": r"^Steam Settings$", "TargetCss": "libraryroot.custom.css"},
    {"MatchRegexString": r"Menu$", "TargetCss": "libraryroot.custom.css"},
    {"MatchRegexString": r"Supernav$", "TargetCss": "libraryroot.custom.css"},
    {"MatchRegexString": r"^notificationtoasts_", "TargetCss": "notifications.custom.css"},
    {"MatchRegexString": r"^Friends List$|^Chat$|friendsui", "TargetCss": "friends.custom.css"},
]

ASSET_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".woff", ".woff2", ".ttf", ".otf"}
MAX_ASSET = 3 * 1024 * 1024
MAX_TOTAL = 15 * 1024 * 1024
MAX_ZIP = 40 * 1024 * 1024
# väčšie súbory (hlavne písma s ikonami) sa nevkladajú do CSS – okná Steamu si ich stiahnu
# z lokálneho servera PSI (127.0.0.1), takže každé okno nedostane megabajty textu
LINK_OVER = 24 * 1024


def _skin(folder: Path) -> dict:
    try:
        return json.loads((folder / "skin.json").read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return {}


def _root(folder: Path) -> Path:
    """Some repos keep the theme in a sub-folder – find the one with skin.json."""
    if (folder / "skin.json").is_file():
        return folder
    for p in sorted(folder.glob("*/skin.json")) + sorted(folder.glob("*/*/skin.json")):
        return p.parent
    return folder


def list_themes() -> list:
    out = []
    if THEMES_DIR.is_dir():
        for d in sorted(THEMES_DIR.iterdir()):
            if not d.is_dir():
                continue
            root = _root(d)
            sk = _skin(root)
            if not sk and not any((root / f).is_file() for f in ("libraryroot.custom.css", "webkit.css")):
                continue
            out.append({"id": d.name, "name": str(sk.get("name") or d.name)[:80],
                        "author": str(sk.get("author") or "")[:60],
                        "description": str(sk.get("description") or "")[:200]})
    return out


def current() -> str:
    return str((config().get("millennium") or {}).get("theme") or "")


def set_theme(theme_id: str) -> str:
    tid = theme_id if theme_id in {t["id"] for t in list_themes()} else ""
    CONFIG.update(lambda c: c.setdefault("millennium", {}).__setitem__("theme", tid))
    return tid


def asset_path(rel: str) -> Path | None:
    """Súbor témy pre lokálny server: '<id témy>/<cesta>' → Path (len písma a obrázky v zložke tém)."""
    base = THEMES_DIR.resolve()
    try:
        f = (base / rel).resolve()
    except (OSError, ValueError):
        return None
    if base not in f.parents or f.suffix.lower() not in ASSET_EXT or not f.is_file():
        return None
    return f


def asset_type(f: Path) -> str:
    ext = f.suffix.lower()
    return {".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
            ".svg": "image/svg+xml", ".webp": "image/webp"}.get(ext) or mimetypes.guess_type(f.name)[0] or "application/octet-stream"


def _asset_url(path: Path) -> str:
    port = int((config().get("companion") or {}).get("port") or 8787)
    rel = path.relative_to(THEMES_DIR.resolve()).as_posix()
    return f"http://127.0.0.1:{port}/mt/{quote(rel)}"


def _inline_assets(css: str, base: Path, root: Path, budget: list, link: bool = False) -> str:
    def repl(m: re.Match) -> str:
        raw = m.group(2).strip()
        if re.match(r"^(data:|https?:|//|#)", raw):
            return m.group(0)
        path = (base / raw.split("?")[0].split("#")[0]).resolve()
        if root.resolve() not in path.parents or path.suffix.lower() not in ASSET_EXT or not path.is_file():
            return m.group(0)
        size = path.stat().st_size
        if link and size > LINK_OVER and THEMES_DIR.resolve() in path.parents:
            return f'url("{_asset_url(path)}")'
        if size > MAX_ASSET or budget[0] + size > MAX_TOTAL:
            return m.group(0)
        budget[0] += size
        mime = mimetypes.guess_type(path.name)[0] or ("font/" + path.suffix[1:])
        return f'url("data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}")'
    return re.sub(r"url\((['\"]?)([^'\")]+)\1\)", repl, css)


def _read_css(file: Path, root: Path, budget: list, depth: int = 0, link: bool = False) -> str:
    try:
        css = file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    if depth < 4:  # resolve local @import "x.css"
        def imp(m: re.Match) -> str:
            target = (file.parent / m.group(2)).resolve()
            if root.resolve() in target.parents and target.suffix == ".css":
                return _read_css(target, root, budget, depth + 1, link)
            return m.group(0)
        css = re.sub(r"@import\s+(?:url\()?(['\"])([^'\"]+\.css)\1\)?\s*;", imp, css)
    return _inline_assets(css, file.parent, root, budget, link)


def options(theme_id: str | None = None) -> dict:
    """Voľby témy (skin.json → Conditions): {názov: {"values": [...], "value": zvolená, "description"}}."""
    tid = theme_id or current()
    if not tid:
        return {}
    sk = _skin(_root(THEMES_DIR / tid))
    chosen = ((config().get("millennium") or {}).get("options") or {}).get(tid) or {}
    out = {}
    for name, c in (sk.get("Conditions") or {}).items():
        if not isinstance(c, dict) or not isinstance(c.get("values"), dict) or not c["values"]:
            continue
        vals = list(c["values"])
        default = c.get("default") if c.get("default") in c["values"] else vals[0]
        out[str(name)] = {"values": vals, "default": default, "value": chosen.get(name) if chosen.get(name) in c["values"] else default,
                          "description": str(c.get("description") or "")[:200]}
    return out


def set_option(name: str, value: str) -> dict:
    tid = current()
    opts = options(tid)
    if name not in opts or value not in opts[name]["values"]:
        raise ValueError(tr("Neznáma voľba témy.", "Unknown theme option."))
    def upd(c):
        m = c.setdefault("millennium", {})
        m.setdefault("options", {}).setdefault(tid, {})[name] = value
    CONFIG.update(upd)
    return options(tid)


def _condition_patches(tid: str, sk: dict) -> list:
    """CSS z vybraných volieb témy (bez TargetJs – JavaScript z tém PSI nespúšťa)."""
    out = []
    conds = sk.get("Conditions") or {}
    for name, o in options(tid).items():
        val = (conds.get(name) or {}).get("values", {}).get(o["value"]) or {}
        tc = val.get("TargetCss") if isinstance(val, dict) else None
        for t in tc if isinstance(tc, list) else [tc] if tc else []:
            if not isinstance(t, dict) or not t.get("src"):
                continue
            for rx in t.get("affects") or []:
                out.append({"MatchRegexString": str(rx), "TargetCss": str(t["src"])})
    return out


def patches(target: str) -> list:
    """[{re, css}] for the active theme. target 'web' → URL patches, 'client' → window-title patches."""
    tid = current()
    if not tid:
        return []
    root = _root(THEMES_DIR / tid)
    sk = _skin(root)
    pl = list(sk.get("Patches") or [])
    if sk.get("UseDefaultPatches", True) or not pl:
        pl += DEFAULT_PATCHES
    pl += _condition_patches(tid, sk)
    budget, out, seen = [0], [], set()
    for p in pl:
        rx, css_files = str(p.get("MatchRegexString") or ""), p.get("TargetCss")
        if not rx or not css_files:
            continue
        is_web = "http" in rx
        if (target == "web") != is_web:
            continue
        for f in css_files if isinstance(css_files, list) else [css_files]:
            file = (root / str(f)).resolve()
            if root.resolve() not in file.parents or not file.is_file() or (rx, str(file)) in seen:
                continue
            seen.add((rx, str(file)))
            css = _read_css(file, root, budget, link=(target == "client"))
            if css.strip():
                out.append({"re": rx, "css": css})
    return out


def install_from_github(url: str) -> dict:
    """Download a theme repo from GitHub (zip of the default branch) into the themes folder."""
    m = re.match(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$", url.strip())
    if not m:
        raise ValueError(tr("Zadaj adresu GitHub repozitára, napr. https://github.com/autor/tema",
                            "Enter a GitHub repository address, e.g. https://github.com/author/theme"))
    owner, repo = m.group(1), m.group(2)
    req = urllib.request.Request(f"https://codeload.github.com/{owner}/{repo}/zip/HEAD", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read(MAX_ZIP + 1)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise ValueError(tr("Repozitár som na GitHube nenašiel (alebo je súkromný).",
                                "Repository not found on GitHub (or it's private).")) from None
        raise
    if len(data) > MAX_ZIP:
        raise ValueError(tr("Téma je príliš veľká (> 40 MB)", "The theme is too big (> 40 MB)"))
    # autor_repozitár – veľa tém má repozitár pomenovaný len „Steam“
    dest = THEMES_DIR / re.sub(r"[^A-Za-z0-9_.-]", "_", f"{owner}_{repo}")
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            parts = Path(info.filename).parts[1:]  # strip "<repo>-<branch>/"
            if not parts or info.is_dir() or ".." in parts:
                continue
            target = (tmp / Path(*parts)).resolve()
            if tmp.resolve() not in target.parents:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(info))
    if not (_root(tmp) / "skin.json").is_file() and not list(tmp.rglob("*.css")):
        shutil.rmtree(tmp, ignore_errors=True)
        raise ValueError(tr("V repozitári som nenašiel Millennium tému (skin.json).",
                            "No Millennium theme (skin.json) found in that repository."))
    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)
    sk = _skin(_root(dest))
    return {"id": dest.name, "name": sk.get("name") or dest.name}

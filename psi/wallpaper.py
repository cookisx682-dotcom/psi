"""KDE Plasma wallpaper for the see-through Steam window.

Steam (CEF under XWayland) can't be truly transparent, so PSI draws the desktop wallpaper behind
the Steam window at the exact spot it covers on the monitor. This module finds each monitor's
geometry (kscreen-doctor) and its wallpaper (image or video, incl. the Smart Video Wallpaper
plugin) from plasma-org.kde.plasma.desktop-appletsrc.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import unquote

APPLETSRC = Path.home() / ".config/plasma-org.kde.plasma.desktop-appletsrc"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".jxl", ".bmp", ".gif", ".svg"}
VIDEO_EXT = {".mp4", ".webm", ".mkv", ".mov", ".m4v"}
_cache: dict = {"t": 0.0, "v": []}


def _sections(text: str) -> dict:
    out, cur = {}, None
    for line in text.splitlines():
        if line.startswith("["):
            cur = line.strip()
            out.setdefault(cur, {})
        elif cur and "=" in line:
            k, v = line.split("=", 1)
            out[cur][k.strip()] = v
    return out


def _path(v: str) -> Path | None:
    v = (v or "").strip()
    if v.startswith("file://"):
        v = unquote(v[7:])
    return Path(v) if v.startswith("/") else None


def _from_package(p: Path) -> Path | None:
    """Wallpaper package folder (…/contents/images/1920x1080.png) → the largest image."""
    imgs = [f for f in (p / "contents/images").glob("*") if f.suffix.lower() in IMAGE_EXT]
    def px(f: Path) -> int:
        m = re.match(r"(\d+)x(\d+)", f.stem)
        return int(m[1]) * int(m[2]) if m else 0
    return max(imgs, key=px) if imgs else None


def _containment_wallpaper(secs: dict, cid: str) -> dict | None:
    base = f"[Containments][{cid}]"
    plugin = secs.get(base, {}).get("wallpaperplugin", "org.kde.image")
    gen = secs.get(f"{base}[Wallpaper][{plugin}][General]", {})
    # video wallpaper plugins (Smart Video Wallpaper Reborn: VideoUrls JSON; older: VideoUrls / VideoWallpaperBackgroundVideo)
    if "VideoUrls" in gen:
        try:
            for it in json.loads(gen["VideoUrls"]):
                if it.get("enabled", True):
                    f = _path(it.get("filename", ""))
                    if f and f.is_file():
                        return {"kind": "video", "path": f}
        except ValueError:
            for part in gen["VideoUrls"].split(","):
                f = _path(part)
                if f and f.is_file():
                    return {"kind": "video", "path": f}
    for key in ("Image", "VideoWallpaperBackgroundVideo"):
        f = _path(gen.get(key, ""))
        if not f:
            continue
        if f.is_dir():
            f = _from_package(f)
        if f and f.is_file():
            return {"kind": "video" if f.suffix.lower() in VIDEO_EXT else "image", "path": f}
    # fallback: org.kde.image settings kept even when another plugin is active
    f = _path(secs.get(f"{base}[Wallpaper][org.kde.image][General]", {}).get("Image", ""))
    if f and f.is_dir():
        f = _from_package(f)
    if f and f.is_file():
        return {"kind": "image", "path": f}
    return None


def _outputs() -> list:
    """Enabled monitors sorted by priority: [{x, y, w, h}] (logical pixels)."""
    if not shutil.which("kscreen-doctor"):
        return []
    try:
        r = subprocess.run(["kscreen-doctor", "-j"], capture_output=True, text=True, timeout=5)
        data = json.loads(r.stdout or "{}")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return []
    outs = []
    for o in data.get("outputs", []):
        if not o.get("enabled") or not o.get("connected", True):
            continue
        pos, size = o.get("pos") or {}, o.get("size") or {}
        scale = float(o.get("scale") or 1) or 1
        mode = next((m for m in o.get("modes", []) if m.get("id") == o.get("currentModeId")), None)
        if mode and mode.get("size"):
            size = mode["size"]
        w, h = int(size.get("width", 0) / scale), int(size.get("height", 0) / scale)
        if (o.get("rotation") or 1) in (2, 8):
            w, h = h, w
        outs.append({"x": int(pos.get("x", 0)), "y": int(pos.get("y", 0)), "w": w, "h": h,
                     "priority": int(o.get("priority") or 99), "name": o.get("name", "")})
    outs.sort(key=lambda o: o["priority"])
    return outs


def screens() -> list:
    """[{x, y, w, h, kind, path, mtime}] – each monitor with its wallpaper (cached for 30 s)."""
    if time.time() - _cache["t"] < 30:
        return _cache["v"]
    try:
        secs = _sections(APPLETSRC.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        secs = {}
    by_screen = {}
    for name, kv in secs.items():
        m = re.fullmatch(r"\[Containments\]\[(\d+)\]", name)
        if not m or kv.get("plugin") not in ("org.kde.plasma.folder", "org.kde.desktopcontainment"):
            continue
        try:
            screen = int(kv.get("lastScreen", "-1"))
        except ValueError:
            continue
        wp = _containment_wallpaper(secs, m[1])
        if wp and screen >= 0 and screen not in by_screen:
            by_screen[screen] = wp
    out = []
    for i, o in enumerate(_outputs()):
        wp = by_screen.get(i) or next(iter(by_screen.values()), None)
        if wp:
            out.append({**{k: o[k] for k in ("x", "y", "w", "h")}, "kind": wp["kind"], "path": wp["path"],
                        "mtime": int(wp["path"].stat().st_mtime)})
    _cache.update(t=time.time(), v=out)
    return out


def file_for(index: int) -> Path | None:
    s = screens()
    return s[index]["path"] if 0 <= index < len(s) else None

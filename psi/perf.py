"""Odhad výkonu (FPS) hry na tomto PC – len stdlib.

Porovná hardvér PC (vulkaninfo / lspci / /proc) s minimálnymi a odporúčanými
požiadavkami zo Steamu. Výsledok je ODHAD: relatívne skóre grafík a procesorov
je približné (1080p, RTX 3060 = 100) a hry sa správajú rôzne.
"""
from __future__ import annotations

import html
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

from .core import CACHE, DAY, http_json, tr

# --------------------------------------------------------------------------- grafiky
# približný relatívny výkon v hrách pri 1080p (RTX 3060 = 100)
GPU = {
    # NVIDIA
    "gt 710": 4, "gt 730": 6, "gt 1030": 14, "gtx 650": 10, "gtx 660": 18, "gtx 670": 24, "gtx 680": 26,
    "gtx 750": 17, "gtx 750 ti": 20, "gtx 760": 25, "gtx 770": 30, "gtx 780": 34, "gtx 780 ti": 40,
    "gtx 950": 28, "gtx 960": 33, "gtx 970": 45, "gtx 980": 52, "gtx 980 ti": 62,
    "gtx 1050": 28, "gtx 1050 ti": 34, "gtx 1060": 54, "gtx 1070": 68, "gtx 1070 ti": 76, "gtx 1080": 82,
    "gtx 1080 ti": 105, "gtx 1630": 30, "gtx 1650": 44, "gtx 1650 super": 56, "gtx 1660": 62,
    "gtx 1660 super": 70, "gtx 1660 ti": 72, "rtx 2060": 82, "rtx 2060 super": 92, "rtx 2070": 96,
    "rtx 2070 super": 108, "rtx 2080": 115, "rtx 2080 super": 122, "rtx 2080 ti": 145,
    "rtx 3050": 68, "rtx 3060": 100, "rtx 3060 ti": 125, "rtx 3070": 140, "rtx 3070 ti": 148,
    "rtx 3080": 175, "rtx 3080 ti": 190, "rtx 3090": 195, "rtx 3090 ti": 210,
    "rtx 4060": 118, "rtx 4060 ti": 140, "rtx 4070": 175, "rtx 4070 super": 200, "rtx 4070 ti": 210,
    "rtx 4070 ti super": 225, "rtx 4080": 255, "rtx 4080 super": 260, "rtx 4090": 320,
    "rtx 5060": 140, "rtx 5060 ti": 165, "rtx 5070": 210, "rtx 5070 ti": 255, "rtx 5080": 285, "rtx 5090": 380,
    # AMD
    "hd 7750": 14, "hd 7770": 18, "hd 7850": 26, "hd 7870": 30, "hd 7950": 36, "hd 7970": 42,
    "r7 260": 18, "r7 360": 19, "r7 370": 28, "r9 270": 30, "r9 280": 40, "r9 290": 54, "r9 380": 40, "r9 390": 56,
    "rx 460": 22, "rx 470": 46, "rx 480": 52, "rx 550": 14, "rx 560": 24, "rx 570": 48, "rx 580": 54, "rx 590": 58,
    "rx vega 56": 78, "rx vega 64": 86, "radeon vii": 105, "rx 5500 xt": 56, "rx 5600 xt": 80, "rx 5700": 92,
    "rx 5700 xt": 104, "rx 6400": 38, "rx 6500 xt": 45, "rx 6600": 98, "rx 6600 xt": 110, "rx 6650 xt": 115,
    "rx 6700": 125, "rx 6700 xt": 140, "rx 6750 xt": 148, "rx 6800": 175, "rx 6800 xt": 200, "rx 6900 xt": 215,
    "rx 6950 xt": 225, "rx 7600": 118, "rx 7600 xt": 122, "rx 7700 xt": 165, "rx 7800 xt": 200,
    "rx 7900 gre": 215, "rx 7900 xt": 245, "rx 7900 xtx": 280, "rx 9060 xt": 160, "rx 9070": 245, "rx 9070 xt": 275,
    "radeon 610m": 6, "vega 8": 15, "radeon 680m": 35, "radeon 760m": 35, "radeon 780m": 42, "radeon 890m": 50,
    # Intel
    "hd 4000": 4, "hd 520": 6, "hd 620": 7, "uhd 620": 7, "uhd 630": 8, "uhd 770": 10, "iris plus": 12,
    "iris xe": 18, "arc a310": 30, "arc a380": 38, "arc a580": 85, "arc a750": 100, "arc a770": 110,
    "arc b570": 110, "arc b580": 125,
}

_GPU_PATTERNS = [
    (r"\b(gtx|rtx|gt)\s*-?\s*(\d{3,4})\s*(ti\s*super|super|ti)?", lambda m: f"{m[1]} {m[2]}" + (f" {re.sub(r'\s+', ' ', m[3])}" if m[3] else "")),
    (r"\brx\s*-?\s*vega\s*(\d{2})", lambda m: f"rx vega {m[1]}"),
    (r"\bvega\s*(56|64)\b", lambda m: f"rx vega {m[1]}"),
    (r"\brx\s*-?\s*(\d{3,4})\s*(xtx|xt|gre)?", lambda m: f"rx {m[1]}" + (f" {m[2]}" if m[2] else "")),
    (r"\b(r[79])\s*(\d{3})x?\b", lambda m: f"{m[1]} {m[2]}"),
    (r"\bhd\s*(\d{4})\b", lambda m: f"hd {m[1]}"),
    (r"\barc\s*([ab]\d{3})", lambda m: f"arc {m[1]}"),
    (r"\buhd\s*(?:graphics\s*)?(\d{3})", lambda m: f"uhd {m[1]}"),
    (r"\bhd\s*graphics\s*(\d{3,4})", lambda m: f"hd {m[1]}"),
    (r"\biris\s*xe", lambda m: "iris xe"),
    (r"\biris\s*plus", lambda m: "iris plus"),
    (r"\bradeon\s*(\d{3})m\b", lambda m: f"radeon {m[1]}m"),
    (r"\bradeon\s*vii\b", lambda m: "radeon vii"),
]


def gpu_models(text: str) -> list:
    """Všetky známe grafiky v texte → [(model, skóre)]."""
    t = text.lower().replace("®", " ").replace("™", " ")
    t = re.sub(r"(\d)(xtx|xt|ti|gre)\b", r"\1 \2", t)
    t = re.sub(r"\b(geforce|nvidia|amd|radeon(?!\s*(vii|\d{3}m))|intel)\b", " ", t)
    found = []
    for pat, key in _GPU_PATTERNS:
        for m in re.finditer(pat, t):
            k = key(m).strip()
            if k in GPU and k not in [f[0] for f in found]:
                found.append((k, GPU[k]))
            elif k.rsplit(" ", 1)[0] in GPU and k.endswith((" super",)):
                base = k.rsplit(" ", 1)[0]
                found.append((base, GPU[base]))
    return found


# --------------------------------------------------------------------------- procesory
def cpu_score(text: str) -> float | None:
    """Hrubé skóre jednovláknového/herného výkonu (i5-8400 ≈ 1.0)."""
    t = text.lower()
    best = None
    for m in re.finditer(r"ryzen\s*(\d)\s*(?:pro\s*)?(\d)(\d{3})(x3d|x|g|h|hs|u)?", t):
        tier, gen = int(m[1]), int(m[2])
        g = {1: 0.85, 2: 0.92, 3: 1.1, 4: 1.15, 5: 1.35, 7: 1.6, 8: 1.55, 9: 1.85}.get(gen, 1.0)
        tm = {3: 0.8, 5: 1.0, 7: 1.12, 9: 1.22}.get(tier, 1.0)
        s = g * tm * (1.15 if m[4] == "x3d" else 1.0)
        best = max(best or 0, s)
    for m in re.finditer(r"\bi([3579])\s*-?\s*(\d{4,5})([a-z]*)", t):
        tier, num = int(m[1]), m[2]
        gen = int(num[:2]) if len(num) == 5 else int(num[0])
        g = {2: 0.5, 3: 0.55, 4: 0.62, 5: 0.66, 6: 0.8, 7: 0.85, 8: 1.0, 9: 1.08, 10: 1.12,
             11: 1.25, 12: 1.45, 13: 1.6, 14: 1.65}.get(gen, 1.0)
        tm = {3: 0.82, 5: 1.0, 7: 1.12, 9: 1.22}[tier]
        s = g * tm * (1.05 if "k" in m[3] else 1.0)
        best = max(best or 0, s)
    if re.search(r"core\s*ultra\s*[579]", t):
        best = max(best or 0, 1.55)
    for m in re.finditer(r"\bfx\s*-?\s*(\d{4})", t):
        best = max(best or 0, 0.5)
    return best


def ram_gb(text: str) -> int | None:
    m = re.search(r"(\d+)\s*gb\s*(?:of\s*)?ram", text.lower())
    return int(m[1]) if m else None


# --------------------------------------------------------------------------- hardvér PC
_HW = None
_HW_LOCK = threading.Lock()


def hardware() -> dict:
    global _HW
    with _HW_LOCK:
        if _HW is not None:
            return _HW
        cpu = ""
        try:
            for line in Path("/proc/cpuinfo").read_text().splitlines():
                if line.startswith("model name"):
                    cpu = line.split(":", 1)[1].strip()
                    break
        except OSError:
            pass
        ram = 0
        try:
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemTotal"):
                    ram = round(int(line.split()[1]) / 1e6)
        except OSError:
            pass
        gpus = []
        if shutil.which("vulkaninfo"):
            try:
                out = subprocess.run(["vulkaninfo", "--summary"], capture_output=True, text=True, timeout=10).stdout
                gpus = [re.sub(r"\s*\(.*\)$", "", n.strip()) for n in re.findall(r"deviceName\s*=\s*(.+)", out)]
            except Exception:
                pass
        if not gpus and shutil.which("lspci"):
            try:
                out = subprocess.run(["lspci", "-mm"], capture_output=True, text=True, timeout=5).stdout
                gpus = [l.split('"')[5] for l in out.splitlines() if re.search(r"VGA|3D|Display", l)]
            except Exception:
                pass
        vram = 0
        for dev in Path("/sys/class/drm").glob("card[0-9]/device/mem_info_vram_total"):
            try:
                vram = max(vram, round(int(dev.read_text()) / (1024 ** 3)))
            except (OSError, ValueError):
                pass
        # najvýkonnejšia rozpoznaná grafika (dedikovaná pred integrovanou)
        best_name, best_score = (gpus[0] if gpus else "neznáma"), None
        for g in gpus:
            mm = gpu_models(g)
            if mm and (best_score is None or mm[0][1] > best_score):
                best_name, best_score = g, mm[0][1]
        _HW = {"cpu": cpu or "neznámy", "cpu_score": cpu_score(cpu), "cores": os.cpu_count() or 0, "ram": ram,
               "gpu": best_name, "gpu_score": best_score, "vram": vram}
        return _HW


# --------------------------------------------------------------------------- požiadavky hry
def _clean(h: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "\n", h or "")))


def _field(text: str, name: str) -> str:
    m = re.search(name + r"\s*:\s*(.+?)(?=\s+(?:OS|Processor|Memory|Graphics|DirectX|Network|Storage|Sound Card|"
                  r"Additional Notes|VR Support)\s*:|$)", text, re.I)
    return m[1].strip() if m else ""


def requirements(appid: int) -> dict:
    hit = CACHE.get("reqs2", appid, DAY * 3)
    if hit is not None:
        return hit
    try:
        d = http_json("https://store.steampowered.com/api/appdetails", {"appids": int(appid), "l": "english"})
        data = (d.get(str(appid)) or {}).get("data") or {}
    except Exception:
        return CACHE.stale("reqs2", appid) or {}
    pc = data.get("pc_requirements") if isinstance(data.get("pc_requirements"), dict) else {}
    out = {}
    for level in ("minimum", "recommended"):
        t = _clean(pc.get(level, ""))
        if not t:
            continue
        g, c = _field(t, "Graphics"), _field(t, "Processor")
        # niektoré hry majú v poli „Processor“ omylom grafiku („Intel HD Graphics 5000…“) – to nie je procesor
        if re.search(r"graphics|geforce|radeon|\bgtx\b|\brtx\b|opengl|vram|directx", c, re.I) and \
                not re.search(r"\bcore\b|ryzen|\bi[3579]\b|\bi[3579]-|pentium|celeron|athlon|phenom|\bfx\b|xeon|ghz|cpu|processor|quad|dual", c, re.I):
            c = ""
        gm = gpu_models(g)
        score = round(sum(s for _, s in gm) / len(gm)) if gm else None
        if score is None:
            # bez konkrétneho modelu: odhad podľa VRAM („1 GB grafika“) alebo integrovanej grafiky
            vm = re.search(r"(\d+(?:\.\d+)?)\s*(gb|mb)", g.lower())
            if vm:
                gb = float(vm[1]) / (1024 if vm[2] == "mb" else 1)
                score = max(6, min(60, round(gb * 12)))
            elif re.search(r"intel\s*(hd|uhd|integrated)|integrated", g.lower()):
                score = 7
        out[level] = {"gpu": g[:140], "gpu_models": [m[0] for m in gm], "gpu_score": score,
                      "cpu": c[:140], "cpu_score": cpu_score(c), "ram": ram_gb(_field(t, "Memory") + " ram"),
                      "dx": (re.search(r"(\d+)", _field(t, "DirectX")) or [None, None])[1]}
    CACHE.put("reqs2", appid, out)
    return out


# --------------------------------------------------------------------------- odhad
def _r5(x: float) -> int:
    return max(5, int(5 * round(x / 5)))


def estimate(appid: int, native: bool = False) -> dict:
    hw, req = hardware(), requirements(appid)
    mn, rc = req.get("minimum") or {}, req.get("recommended") or {}
    g = hw.get("gpu_score")
    res = {"pc": hw, "req": req, "fps_high": None, "fps_low": None, "preset": None, "level": "unknown", "notes": []}
    if not g or not (mn.get("gpu_score") or rc.get("gpu_score")):
        res["notes"].append(tr("Požiadavky na grafiku sa nepodarilo porovnať.", "Couldn't compare the graphics requirements.") if g
                            else tr("Tvoju grafiku nepoznám.", "Your graphics card isn't in the list yet."))
        return res
    # Proton/DXVK réžia (DX12 cez VKD3D je o niečo náročnejší)
    pf = 1.0 if native else (0.88 if (rc.get("dx") or mn.get("dx")) == "12" else 0.93)
    if rc.get("gpu_score"):
        res["fps_high"] = min(300, _r5(60 * (g / rc["gpu_score"]) ** 0.85 * pf))
    if mn.get("gpu_score"):
        res["fps_low"] = min(300, _r5(45 * (g / mn["gpu_score"]) ** 0.85 * pf))
    elif res["fps_high"]:
        res["fps_low"] = min(300, _r5(res["fps_high"] * 1.6))
    if not res["fps_high"] and res["fps_low"]:
        res["fps_high"] = _r5(res["fps_low"] / 1.7)
    if res["fps_high"] and res["fps_low"]:
        res["fps_low"] = max(res["fps_low"], min(300, _r5(res["fps_high"] * 1.3)))
    # procesor môže strop zrezať
    cs, creq = hw.get("cpu_score"), rc.get("cpu_score") or mn.get("cpu_score")
    if cs and creq and cs / creq < 0.85:
        cap = _r5(60 * (cs / creq) ** 0.9)
        res["fps_high"] = min(res["fps_high"], cap)
        res["notes"].append(tr("Procesor môže brzdiť – je slabší ako odporúčaný.", "Your CPU may hold it back – it's below the recommended one."))
    if hw.get("ram") and mn.get("ram") and hw["ram"] < mn["ram"]:
        res["notes"].append(tr(f"Máš menej RAM ({hw['ram']} GB) ako minimum ({mn['ram']} GB).", f"You have less RAM ({hw['ram']} GB) than the minimum ({mn['ram']} GB)."))
    fh = res["fps_high"] or 0
    if fh >= 90:
        res["preset"], res["level"] = "Ultra / vysoké", "great"
    elif fh >= 55:
        res["preset"], res["level"] = "Vysoké", "good"
    elif (res["fps_low"] or 0) >= 45:
        res["preset"], res["level"] = "Stredné", "ok"
    elif (res["fps_low"] or 0) >= 28:
        res["preset"], res["level"] = "Nízke", "low"
    else:
        res["preset"], res["level"] = "Pod minimom", "bad"
    if not native:
        res["notes"].append(tr("Odhad počíta s malou réžiou Protonu.", "Includes a small Proton overhead."))
    return res

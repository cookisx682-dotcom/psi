"""psi – príkazový riadok.

  psi                 spustí službu (to isté ako `psi run`)
  psi --companion     vypíše adresu, PIN a QR kód pre mobil
  psi --companion --new-pin   vygeneruje nový PIN a odhlási všetky zariadenia
  psi install         nainštaluje systemd user službu a zapne CEF debug port v Steame
  psi status          stav služby a dát
"""
from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

C = "\033[38;2;34;211;238m"   # cyan
V = "\033[38;2;139;92;246m"   # fialová
B = "\033[1m"
D = "\033[2m"
R = "\033[0m"


def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.6):
            return True
    except OSError:
        return False


def cmd_companion(new_pin: bool) -> int:
    from .core import config, ensure_pin
    from .companion.server import lan_ip
    from .qr import QR

    pin = ensure_pin(regenerate=new_pin)
    port = int(config()["companion"].get("port") or 8787)
    ip = lan_ip()
    print(f"\n  {C}{B}Ψ PSI Companion{R}\n")
    if not ip:
        print("  Nenašiel som LAN adresu tohto PC (si pripojený k Wi-Fi/sieti?).")
        print(f"  PIN: {V}{B}{pin[:3]} {pin[3:]}{R}\n")
        return 1
    url = f"http://{ip}:{port}"
    print(QR(url).terminal(border=2).replace("\n", "\n  ").join(["  ", ""]))
    print(f"\n  Na tomto PC: {C}{B}http://127.0.0.1:{port}{R}")
    print(f"  Mobil:       {C}{B}{url}{R}")
    print(f"  PIN:         {V}{B}{pin[:3]} {pin[3:]}{R}" + ("   (nový – staré prihlásenia zrušené)" if new_pin else ""))
    if _port_open("127.0.0.1", port):
        print(f"  {D}Server beží. Na PC otvor prvú adresu, na telefóne (rovnaká Wi-Fi) druhú alebo QR.{R}")
    else:
        print(f"  {D}Server zatiaľ nebeží – spusti službu: systemctl --user start psi{R}")
    print(f"  {D}V Safari/Chrome daj „Pridať na plochu“ a máš appku.{R}\n")
    return 0


def cmd_install() -> int:
    from .core import config, steam_root

    unit_dir = Path.home() / ".config/systemd/user"
    unit_dir.mkdir(parents=True, exist_ok=True)
    unit = unit_dir / "psi.service"
    unit.write_text(f"""[Unit]
Description=PSI – Steam loader & companion
After=network-online.target graphical-session.target

[Service]
Type=simple
WorkingDirectory={ROOT}
ExecStart={sys.executable} -m psi run
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
""")
    print(f"✓ {unit}")
    root = steam_root()
    if root:
        flag = root / ".cef-enable-remote-debugging"
        flag.touch()
        print(f"✓ {flag}  (reštartuj Steam, aby sa zapol port 8080)")
    else:
        print("! Steam priečinok som nenašiel – vytvor .cef-enable-remote-debugging ručne.")
    bin_dir = Path.home() / ".local/bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    link = bin_dir / "psi"
    if not link.exists():
        link.symlink_to(ROOT / "bin/psi")
        print(f"✓ {link} → príkaz `psi`")
    config()
    if shutil.which("systemctl"):
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=False)
        subprocess.run(["systemctl", "--user", "enable", "--now", "psi.service"], check=False)
        print("✓ systemctl --user enable --now psi.service")
    return 0


def cmd_status() -> int:
    from .core import CONFIG_PATH, SNAPSHOTS, config, current_steamid, steam_root
    from .companion.server import lan_ip

    cfg = config()
    port = int(cfg["companion"].get("port") or 8787)
    ip = lan_ip()
    print(f"Steam:        {steam_root() or '—'}   (steamid {current_steamid() or '—'})")
    from .cdp import list_targets
    try:
        list_targets()
        cef = "áno (Steam)"
    except ValueError:
        cef = "NIE – port 8080 drží iný program"
    except OSError:
        cef = "nie (reštartuj Steam)"
    print(f"CEF 8080:     {cef}")
    print(f"Companion PC: {'beží' if _port_open('127.0.0.1', port) else 'nebeží'}  http://127.0.0.1:{port}")
    print(f"Companion LAN:{'beží' if ip and _port_open(ip, port) else 'nebeží'}  http://{ip}:{port}")
    print(f"Prihlásenia:  {len(cfg['companion'].get('tokens') or {})} zariadení")
    print(f"Snímky:       {len(SNAPSHOTS.load())} dní   ({CONFIG_PATH.parent})")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="psi", description="PSI – Steam loader pre Linux")
    p.add_argument("command", nargs="?", default="run", choices=["run", "install", "status", "snapshot"])
    p.add_argument("--companion", action="store_true", help="adresa, PIN a QR kód pre mobil")
    p.add_argument("--new-pin", action="store_true", help="s --companion: nový PIN, zruší prihlásenia")
    a = p.parse_args(argv)
    if a.companion:
        return cmd_companion(a.new_pin)
    if a.command == "install":
        return cmd_install()
    if a.command == "status":
        return cmd_status()
    if a.command == "snapshot":
        from .core import SNAPSHOTS
        print(f"{SNAPSHOTS.take()} hier zapísaných")
        return 0
    from .service import main as run
    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())

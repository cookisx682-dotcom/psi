# Ψ PSI – Steam loader pre Linux

Python služba (len stdlib), ktorá sa cez CEF debug port pripája do Steamu, vkladá vlastné skripty
a na mobile ponúka **PSI Companion** v domácej Wi-Fi.

## Inštalácia

```bash
./bin/psi install          # systemd user služba + .cef-enable-remote-debugging + ~/.local/bin/psi
```

Potom reštartuj Steam. Steam CEF používa port 8080 (IPv4 `127.0.0.1` alebo IPv6 `[::1]`, PSI skúša oba).
Iné programy na 8080 nepúšťaj – `bestdeal` je preto presunutý na port 3000
(`~/.config/systemd/user/bestdeal.service.d/port.conf`).

```bash
psi --companion            # adresa, PIN a QR kód pre telefón
psi --companion --new-pin  # nový PIN + odhlásenie všetkých telefónov
psi status
journalctl --user -u psi -f
```

## Čo robí

**V Steame** (všetko sa zapína/vypína v Steam → Nastavenia → PSI):
- **Knižnica:** ProtonDB medaila pri hre, rozbaľovacie „O hre“ (popis, Linux/anti-cheat/Steam Deck, odhad FPS), auto-kolekcie „PSI · Gold / Natívne / Online nepôjde…“.
- **Obchod:** „Hrať na Linuxe“ (prečo Gold, anti-cheat z AreWeAntiCheatYet), „Výkon na tvojom PC“ (odhad FPS), „Cena a zľava“ (kúp/počkaj), varovanie pred kúpou, odznaky na wishliste.
- **Moderný vzhľad:** zaoblené rohy všade, sklenené panely, miznúci obrázok hry; vlastné písmo (systémové alebo nahrané).
- **Notifikácie v KDE** pri zľave hry z wishlistu.
- **Profil:** vitrína „Môj týždeň“.

| Časť | Súbor |
|---|---|
| ProtonDB, CheapShark, Steam Store, `estimate_deal`, `Snapshots` | `psi/core.py` |
| Trieda `Psi` (`week`, `wishlist`, `deal`, `protondb`, `game`, `search`), CEF injector, most `__psiBridge` | `psi/service.py`, `psi/cdp.py` |
| Steam → Nastavenia → **PSI**: týždeň, Companion (adresy, PIN, QR, nový PIN), prepínače funkcií | `psi/inject/psi.js` |
| Obchod: medaila, odpočet konca zľavy, odhad, kúp/počkaj | `psi/inject/store.js` |
| Profil: vitrína „Môj týždeň“ + odznaky (len vlastný profil) | `psi/inject/community.js` |
| Companion server (port 8787) | `psi/companion/server.py` |
| Companion PWA | `psi/companion/index.html` |
| QR kód v termináli | `psi/qr.py` |
| Odhad FPS (hardvér PC vs. požiadavky hry) | `psi/perf.py` |

Dáta: `~/.local/share/psi/` – `config.json`, `cache.json`, `snapshots.json`.

## PSI Companion – bezpečnosť

* Na PC beží na **http://127.0.0.1:8787**, pre telefón na **LAN IP** PC (privátny rozsah).
  Nikdy nie na `0.0.0.0` ani na internete. Pri zmene IP sa LAN adresa sama presunie.
* 6-miestny PIN sa vygeneruje pri prvom štarte. Po prihlásení dostane telefón HttpOnly cookie na 30 dní
  (v `config.json` je uložený len SHA-256 hash tokenu).
* PIN: max **5 pokusov za minútu** z jednej IP a 20 celkovo.
* Kontrola `Host` hlavičky (proti DNS rebindingu), `Origin` pri POST, CSP a `X-Frame-Options`.
* API je len na čítanie: `/api/week`, `/api/wishlist`, `/api/game/<appid>`, `/api/search?q=`.
  Jediné POST sú `/api/login` a `/api/logout`.
* Weby obchodu a komunity dostanú cez most len read-only metódy a nikdy nie PIN.

Ak máš zapnutý firewall (ufw/firewalld), povoľ port 8787 pre lokálnu sieť:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 8787 proto tcp
```

## Voliteľné

* **Achievementy**: do `config.json` doplň `"steam_api_key"` (https://steamcommunity.com/dev/apikey).
* **Výpredaje**: `"sales"` v `config.json` (predvolené sú oficiálne termíny Valve: zima 2026, jar a leto 2027).
* **Graf týždňa** sa plní z denných snímok `localconfig.vdf`, takže plný týždeň uvidíš po 7 dňoch behu.

## Vývoj

```bash
PSI_DATA=/tmp/psi-dev python3 -m psi run   # samostatné testovacie dáta
```

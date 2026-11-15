# Ψ PSI – Steam enhancer for Linux

PSI is a small Python service (standard library only) that hooks into the Steam client through its
CEF remote-debugging port, injects its own scripts and styles, and serves **PSI Companion**, a mobile
web app for your home Wi-Fi.

> The in-Steam interface is in Slovak; this README and the code base are documented in English.

## Features

**Inside Steam** (every feature can be toggled in *Steam → Settings → PSI*):

- **Library** – ProtonDB medal next to each game, a collapsible *About* panel (description,
  Linux / anti-cheat / Steam Deck status, FPS estimate), auto-collections such as
  *PSI · Gold*, *PSI · Native Linux*, *PSI · Online won't work (anti-cheat)*.
- **Store** – *Play on Linux* (why a game is Gold, anti-cheat status from AreWeAntiCheatYet),
  *Performance on your PC* (FPS estimate), *Price & discount* (buy now / wait),
  a warning before buying a game that won't run on Linux, badges on the wishlist page.
- **Downloads** – rainbow progress bars, downloaded / total size, time remaining and free disk space.
- **Modern look** – rounded corners everywhere, frosted-glass panels, fading game artwork,
  custom fonts (system or uploaded).
- **Theme editor** – accent colour, panel colour and opacity, blur, corner radius,
  presets and a live window preview.
- **Millennium themes** – pick a theme from [steambrew.app](https://steambrew.app/themes), install it from a
  GitHub URL or drop it into `~/.local/share/psi/millennium/`. Only the theme's CSS is used (assets are
  inlined); theme JavaScript is never executed.
- **Instant styling** – PSI attaches to every new store page the moment it is created,
  so styles are in place before the first paint.
- **KDE notifications** when a wishlisted game goes on sale.
- **Profile** – a *My week* showcase with playtime and badges.
- **Automatic updates** – every 6 hours PSI checks this repository and updates itself.

**PSI Companion** – a PWA for your phone: weekly playtime, wishlist with deal estimates and
countdowns, game search with ProtonDB data. Read-only, PIN-protected, LAN only.

## Installation

```bash
git clone https://github.com/cookisx682-dotcom/psi.git ~/psi
~/psi/bin/psi install      # systemd user service + .cef-enable-remote-debugging + ~/.local/bin/psi
```

Then restart Steam. Steam's CEF debugger uses port **8080** (IPv4 `127.0.0.1` or IPv6 `[::1]`;
PSI tries both), so nothing else may listen on that port.

```bash
psi --companion            # address, PIN and QR code for your phone
psi --companion --new-pin  # new PIN, signs out all phones
psi status
psi update                 # check GitHub for a new version right now
journalctl --user -u psi -f
```

## Project layout

| Part | File |
|---|---|
| ProtonDB, CheapShark, Steam Store, anti-cheat, deal estimate, playtime snapshots | `psi/core.py` |
| `Psi` service, CEF injector, instant page attach, bridge `__psiBridge`, auto-update | `psi/service.py`, `psi/cdp.py` |
| FPS estimate (PC hardware vs. game requirements) | `psi/perf.py` |
| Steam client: Settings → PSI, library, downloads, theme, fonts, collections | `psi/inject/psi.js` |
| Store: Linux info, performance, price, buy warning, wishlist badges, styling | `psi/inject/store.js` |
| Profile: *My week* showcase | `psi/inject/community.js` |
| Companion server (port 8787) and PWA | `psi/companion/server.py`, `psi/companion/index.html` |
| QR code in the terminal | `psi/qr.py` |
| Millennium theme loader (skin.json patches, CSS only) | `psi/millennium.py` |

Data lives in `~/.local/share/psi/` (`config.json`, `cache.json`, `snapshots.json`, `library.json`).

## PSI Companion security

- Listens on **http://127.0.0.1:8787** for the PC and on the PC's **LAN IP** (private ranges only)
  for your phone – never on `0.0.0.0` or the internet.
- A random 6-digit PIN is generated on first start; after signing in the phone gets an HttpOnly
  cookie valid for 30 days (only a SHA-256 hash of the token is stored).
- PIN rate limit: 5 attempts per minute per IP, 20 in total.
- `Host` header check (DNS rebinding), `Origin` check on POST, CSP and `X-Frame-Options`.
- Read-only API: `/api/week`, `/api/wishlist`, `/api/game/<appid>`, `/api/search?q=`.
- Store and community pages only get read-only bridge methods and never the PIN.

If a firewall is enabled, allow the port for your LAN:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 8787 proto tcp
```

## Optional

- **Achievements** – add `"steam_api_key"` to `config.json` (https://steamcommunity.com/dev/apikey).
- **Sales calendar** – `"sales"` in `config.json` (defaults are Valve's official dates).
- The weekly chart is built from daily snapshots of `localconfig.vdf`, so a full week appears after 7 days.

## Development

```bash
PSI_DATA=/tmp/psi-dev python3 -m psi run   # separate test data
```

## License

MIT

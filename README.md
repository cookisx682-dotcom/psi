# PSI

I play on Linux and kept opening ProtonDB, AreWeAntiCheatYet and price trackers in a browser
before every purchase. PSI puts that information straight into the Steam client, and gives Steam a
cleaner look while it's at it.

It is a small Python service (standard library only). It talks to Steam through its CEF
remote-debugging port and adds its own scripts and styles. There is no patching of Steam files.

## What it does

In the library, every game gets its ProtonDB rating. A collapsible *About* panel explains what the
rating means, whether the anti-cheat works on Linux, the Steam Deck status, and a rough FPS range for
your hardware. PSI can also keep collections like *Gold*, *Native Linux* or *Online blocked
(anti-cheat)* up to date for you.

In the store, a game page shows the same Linux information, the price history, and a buy-now /
wait hint. If a game won't run on Linux, you get a warning before you add it to the cart.
Wishlist items get small rating badges, and KDE notifies you when one of them goes on sale.

For the look, there are rounded corners, a theme editor (accent colour, panel colour, blur, corner
radius), custom fonts, your own CSS, and Millennium themes (CSS only, their JavaScript never runs).
The downloads page shows how much is left, the time remaining and the free disk space.
With *See-through window* on, your desktop wallpaper (KDE image or video wallpaper) shows through the
Steam window like glass – PSI draws it behind Steam at the exact spot the window covers.
Running games also get their real icon in the dock and taskbar instead of a blank one (PSI writes
hidden `.desktop` entries with `StartupWMClass=steam_app_<appid>` for every installed game).

PSI follows Steam's language (English or Slovak) and you can switch it under
*Steam → Settings → PSI*, where every feature has its own toggle. It updates itself from this
repository every 6 hours.

**PSI Companion** is an optional phone page on your home Wi-Fi with your week of playtime and your
wishlist. It is read-only and protected by a PIN.

The FPS numbers are an estimate built from the game's listed requirements and a table of GPU/CPU
scores, not a benchmark. Treat them as "will this run", not as a promise.

## Install

```bash
git clone https://github.com/cookisx682-dotcom/psi.git ~/psi
~/psi/bin/psi install
```

`psi install` sets up a systemd user service, enables Steam's debug port
(`.cef-enable-remote-debugging`) and links the `psi` command into `~/.local/bin`. Restart Steam
afterwards. Steam's debugger listens on port 8080, so nothing else can use that port.

```bash
psi status                 # is everything connected?
psi update                 # check for a new version now
psi --companion            # phone address, PIN and QR code
psi --companion --new-pin  # new PIN, signs out all phones
journalctl --user -u psi -f
```

Optional settings in `~/.local/share/psi/config.json`: `"steam_api_key"` for achievements, and
`"sales"` to override the sale calendar (Valve's dates are the default).

## Where things are

| | |
|---|---|
| Service, Steam connection, auto-update | `psi/service.py`, `psi/cdp.py` |
| ProtonDB, store data, prices, anti-cheat, config | `psi/core.py` |
| FPS estimate | `psi/perf.py` |
| Steam client: settings page, library, downloads, look | `psi/inject/psi.js` |
| Store and profile pages | `psi/inject/store.js`, `psi/inject/community.js` |
| Millennium themes | `psi/millennium.py` |
| Companion | `psi/companion/` |

Your data stays in `~/.local/share/psi/`.

## Companion security

The Companion listens on `127.0.0.1:8787` and on your LAN address only (never `0.0.0.0`). Phones sign
in with a 6-digit PIN that is rate-limited. After that they get a 30-day HttpOnly cookie, and only
its hash is stored. It checks the `Host` and `Origin` headers and the API can't change anything.
Store and profile pages only get read-only methods and never see the PIN.

If you use a firewall:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 8787 proto tcp
```

## License

MIT

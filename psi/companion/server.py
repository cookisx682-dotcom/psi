"""PSI Companion – read-only HTTP server pre mobil v domácej Wi-Fi.

Bezpečnosť:
  * počúva len na LAN adrese PC (privátny rozsah), nikdy na 0.0.0.0,
  * všetko okrem prázdneho HTML shellu vyžaduje session cookie získanú PIN-om,
  * PIN: max 5 pokusov za minútu z jednej IP (a 20/min celkovo),
  * kontrola Host hlavičky (proti DNS rebindingu) a Origin pri POST,
  * API je len na čítanie – jediné POST sú prihlásenie a odhlásenie.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import math
import re
import secrets
import socket
import struct
import threading
import time
import zlib
from collections import deque
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from ..core import CONFIG, DATA_DIR, config, features

log = logging.getLogger("psi.companion")
HERE = Path(__file__).resolve().parent
COOKIE = "psi_session"
SESSION_TTL = 30 * 86400
ATTEMPTS_PER_IP = 5
ATTEMPTS_GLOBAL = 20


# ---------------------------------------------------------------------- sieť

def lan_ip() -> str | None:
    """IP adresa PC v lokálnej sieti (z predvolenej trasy; žiadny paket sa neodosiela)."""
    override = (config().get("companion") or {}).get("host")
    if override:
        return override
    for probe in ("192.168.0.1", "10.255.255.255", "172.16.0.1"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect((probe, 9))
                ip = s.getsockname()[0]
        except OSError:
            continue
        if is_lan(ip):
            return ip
    return None


def is_lan(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.is_private and not a.is_loopback and not a.is_link_local


# ---------------------------------------------------------------------- ikona Ψ

def _png(w: int, h: int, rgba: bytearray) -> bytes:
    raw = b"".join(b"\0" + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    ch = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return (b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + ch(b"IDAT", zlib.compress(raw, 9)) + ch(b"IEND", b""))


def _seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def render_icon(size: int, maskable: bool = False) -> bytes:
    """Ψ s cyan→fialovým gradientom a jemným glow na tmavom navy pozadí."""
    out = bytearray(size * size * 4)
    sw = 0.036  # polovica hrúbky ťahu
    cx, cy, r = 0.5, 0.43, 0.19
    corner = 0.0 if maskable else 0.22
    for y in range(size):
        v = (y + 0.5) / size
        for x in range(size):
            u = (x + 0.5) / size
            # zaoblený štvorec
            qx, qy = max(abs(u - 0.5) - (0.5 - corner), 0), max(abs(v - 0.5) - (0.5 - corner), 0)
            dbox = math.hypot(qx, qy) - corner
            alpha = max(0.0, min(1.0, 0.5 - dbox * size)) if corner else 1.0
            if alpha <= 0:
                continue
            # pozadie: navy gradient + jemná žiara v strede
            g = math.exp(-((u - 0.5) ** 2 + (v - 0.45) ** 2) * 6)
            br, bg, bb = 11 + 14 * g, 16 + 18 * g, 38 + 40 * g
            # vzdialenosť ku glyfu Ψ
            d = min(
                _seg(u, v, 0.5, 0.17, 0.5, 0.82),            # driek
                _seg(u, v, cx - r, 0.24, cx - r, cy),        # ľavé rameno
                _seg(u, v, cx + r, 0.24, cx + r, cy),        # pravé rameno
                _seg(u, v, 0.37, 0.82, 0.63, 0.82),          # pätka
                abs(math.hypot(u - cx, v - cy) - r) if v >= cy else 9,  # miska
            ) - sw
            t = max(0.0, min(1.0, (u * 0.6 + v * 0.4 - 0.2) / 0.6))
            gr, gg, gb = 34 + (139 - 34) * t, 211 + (92 - 211) * t, 238 + (246 - 238) * t
            glow = math.exp(-max(d, 0) * 38) * 0.55
            cov = max(0.0, min(1.0, 0.5 - d * size))
            k = min(1.0, cov + glow * (1 - cov))
            rr, gg2, bb2 = br + (gr - br) * k, bg + (gg - bg) * k, bb + (gb - bb) * k
            i = (y * size + x) * 4
            out[i:i + 4] = bytes((int(rr), int(gg2), int(bb2), int(alpha * 255)))
    return _png(size, size, out)


_ICONS: dict = {}
_ICON_LOCK = threading.Lock()


def icon(name: str) -> bytes:
    spec = {"icon-192.png": (192, False), "icon-512.png": (512, False),
            "icon-maskable-512.png": (512, True), "apple-touch-icon.png": (180, True)}[name]
    with _ICON_LOCK:
        if name not in _ICONS:
            path = DATA_DIR / "icons" / f"v1-{name}"
            if path.exists():
                _ICONS[name] = path.read_bytes()
            else:
                _ICONS[name] = render_icon(*spec)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(_ICONS[name])
        return _ICONS[name]


ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#0b1226"/><g fill="none" stroke="url(#g)" stroke-width="4.6" stroke-linecap="round"><path d="M32 11v41M20 15v12.5a12 12 0 0 0 24 0V15M24 52h16"/></g></svg>"""

MANIFEST = {
    "name": "PSI Companion",
    "short_name": "PSI",
    "description": "Tvoj Steam týždeň a wishlist na telefóne",
    "start_url": "/",
    "scope": "/",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#070b1a",
    "theme_color": "#070b1a",
    "lang": "sk",
    "icons": [
        {"src": "/icon.svg", "sizes": "any", "type": "image/svg+xml"},
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}

CSP = ("default-src 'self'; img-src 'self' data: https://*.steamstatic.com https://steamcdn-a.akamaihd.net "
       "https://cdn.cloudflare.steamstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


# ---------------------------------------------------------------------- auth

class Auth:
    def __init__(self):
        self.lock = threading.Lock()
        self.per_ip: dict[str, deque] = {}
        self.all: deque = deque()

    @staticmethod
    def _h(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def rate_limited(self, ip: str) -> int:
        """Vráti počet sekúnd do ďalšieho pokusu (0 = možno skúsiť) a zapíše pokus."""
        now = time.monotonic()
        with self.lock:
            q = self.per_ip.setdefault(ip, deque())
            for d in (q, self.all):
                while d and now - d[0] > 60:
                    d.popleft()
            if len(q) >= ATTEMPTS_PER_IP:
                return int(60 - (now - q[0])) + 1
            if len(self.all) >= ATTEMPTS_GLOBAL:
                return int(60 - (now - self.all[0])) + 1
            q.append(now)
            self.all.append(now)
            return 0

    def attempts_left(self, ip: str) -> int:
        with self.lock:
            return max(0, ATTEMPTS_PER_IP - len(self.per_ip.get(ip, ())))

    def login(self, pin: str, ua: str) -> str | None:
        real = str(config()["companion"].get("pin", ""))
        if not (re.fullmatch(r"\d{6}", pin or "") and len(real) == 6
                and hmac.compare_digest(pin.encode(), real.encode())):
            return None
        token = secrets.token_urlsafe(32)
        now = int(time.time())

        def fn(cfg):
            toks = cfg["companion"].setdefault("tokens", {})
            for k in [k for k, v in toks.items() if v.get("exp", 0) < now]:
                del toks[k]
            toks[self._h(token)] = {"exp": now + SESSION_TTL, "created": now, "ua": ua[:120]}

        CONFIG.update(fn)
        return token

    def valid(self, token: str | None) -> bool:
        if not token or len(token) > 100:
            return False
        rec = (config()["companion"].get("tokens") or {}).get(self._h(token))
        return bool(rec and rec.get("exp", 0) > time.time())

    def logout(self, token: str) -> None:
        h = self._h(token)
        CONFIG.update(lambda cfg: (cfg["companion"].get("tokens") or {}).pop(h, None))


# ---------------------------------------------------------------------- handler

class Handler(BaseHTTPRequestHandler):
    server_version = "PSI"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    companion: "CompanionServer"

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.client_address[0], fmt % args)

    # -------------------------------------------------------------- odpovede
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None, cache: str = "no-store"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", CSP)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj, extra: dict | None = None):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", extra)

    def _token(self) -> str | None:
        c = cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            return None
        return c[COOKIE].value if COOKIE in c else None

    def _host_ok(self) -> bool:
        return self.headers.get("Host", "") in self.companion.allowed_hosts

    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{h}" for h in self.companion.allowed_hosts}

    def _theme_asset(self, path: str):
        """Písma a obrázky Millennium tém pre okná Steamu – len pre toto PC, len zo zložky tém."""
        from .. import millennium as mi
        if self.client_address[0] not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return self._send(404, b"Not found", "text/plain")
        f = mi.asset_path(unquote(path[len("/mt/"):]))
        if not f:
            return self._send(404, b"Not found", "text/plain")
        ctype = mi.asset_type(f)
        return self._send(200, f.read_bytes(), ctype, cache="max-age=86400",
                          extra={"Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin"})

    # -------------------------------------------------------------- GET
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._host_ok():
            return self._send(421, b"Misdirected Request", "text/plain")
        url = urlparse(self.path)
        path = url.path
        static = {
            "/": lambda: (self.companion.html(), "text/html; charset=utf-8", "no-cache"),
            "/index.html": lambda: (self.companion.html(), "text/html; charset=utf-8", "no-cache"),
            "/manifest.webmanifest": lambda: (json.dumps(MANIFEST).encode(), "application/manifest+json", "max-age=86400"),
            "/icon.svg": lambda: (ICON_SVG.encode(), "image/svg+xml", "max-age=604800"),
            "/favicon.ico": lambda: (icon("icon-192.png"), "image/png", "max-age=604800"),
        }
        if path in static:
            body, ctype, cache = static[path]()
            return self._send(200, body, ctype, cache=cache)
        if re.fullmatch(r"/(icon-192|icon-512|icon-maskable-512|apple-touch-icon)\.png", path):
            return self._send(200, icon(path[1:]), "image/png", cache="max-age=604800")
        if path.startswith("/mt/"):
            return self._theme_asset(path)
        if not path.startswith("/api/"):
            return self._send(404, b"Not found", "text/plain")

        authed = self.companion.auth.valid(self._token())
        if path == "/api/session":
            return self._json(200, {"authed": authed,
                                    "attempts_left": self.companion.auth.attempts_left(self.client_address[0])})
        if not authed:
            return self._json(401, {"error": "auth"})

        qs = parse_qs(url.query)
        refresh = qs.get("refresh", ["0"])[0] == "1"
        psi = self.companion.psi
        try:
            if path == "/api/week":
                return self._json(200, psi.week(refresh))
            if path == "/api/wishlist":
                return self._json(200, psi.wishlist(refresh))
            m = re.fullmatch(r"/api/game/(\d{1,10})", path)
            if m:
                return self._json(200, psi.game(int(m.group(1))))
            if path == "/api/search":
                return self._json(200, {"items": psi.search(qs.get("q", [""])[0])})
        except Exception as e:
            log.exception("API %s", path)
            return self._json(502, {"error": "upstream", "detail": type(e).__name__})
        return self._json(404, {"error": "not_found"})

    # -------------------------------------------------------------- POST (len login/logout)
    def do_POST(self):
        if not self._host_ok():
            return self._send(421, b"Misdirected Request", "text/plain")
        if not self._origin_ok():
            return self._json(403, {"error": "origin"})
        path = urlparse(self.path).path
        if path == "/api/logout":
            tok = self._token()
            if tok and self.companion.auth.valid(tok):
                self.companion.auth.logout(tok)
            return self._json(200, {"ok": True}, {"Set-Cookie": f"{COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"})
        if path != "/api/login":
            return self._json(404, {"error": "not_found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            n = 0
        if n <= 0 or n > 256:
            return self._json(400, {"error": "bad_request"})
        try:
            pin = str(json.loads(self.rfile.read(n)).get("pin", ""))
        except (ValueError, AttributeError):
            return self._json(400, {"error": "bad_request"})
        ip = self.client_address[0]
        wait = self.companion.auth.rate_limited(ip)
        if wait:
            return self._json(429, {"error": "rate_limited", "retry_after": wait}, {"Retry-After": str(wait)})
        token = self.companion.auth.login(pin, self.headers.get("User-Agent", ""))
        if not token:
            log.warning("Nesprávny PIN z %s", ip)
            return self._json(403, {"error": "wrong_pin", "attempts_left": self.companion.auth.attempts_left(ip)})
        log.info("Nové prihlásenie z %s", ip)
        return self._json(200, {"ok": True}, {
            "Set-Cookie": f"{COOKIE}={token}; Max-Age={SESSION_TTL}; Path=/; HttpOnly; SameSite=Strict"})

    def do_PUT(self):
        self._json(405, {"error": "read_only"})

    do_DELETE = do_PATCH = do_PUT


# ---------------------------------------------------------------------- server

class CompanionServer:
    """Dva poslucháči: 127.0.0.1 (prehliadač na tomto PC) a LAN IP (telefón v domácej Wi-Fi).
    Na internet nepočúva nikdy. Na oboch adresách platí rovnaký PIN."""

    LOCAL = "127.0.0.1"

    def __init__(self, psi):
        self.psi = psi
        psi.companion = self
        self.auth = Auth()
        self.httpd: ThreadingHTTPServer | None = None   # LAN
        self.local: ThreadingHTTPServer | None = None   # localhost
        self.host: str | None = None
        self.port = int(config()["companion"].get("port") or 8787)
        self._wake = threading.Event()

    def wake(self) -> None:
        """Okamžite prehodnotí LAN poslucháča (napr. po prepnutí v Nastaveniach)."""
        self._wake.set()

    @property
    def allowed_hosts(self) -> set:
        hosts = {f"{self.LOCAL}:{self.port}", f"localhost:{self.port}"}
        if self.host:
            hosts.add(f"{self.host}:{self.port}")
        return hosts

    @property
    def url(self) -> str | None:
        return f"http://{self.host}:{self.port}" if self.host else None

    @property
    def local_url(self) -> str:
        return f"http://{self.LOCAL}:{self.port}"

    def html(self) -> bytes:
        return (HERE / "index.html").read_bytes()

    def start(self) -> None:
        try:
            self.local = self._serve(self.LOCAL)
            log.info("PSI Companion na tomto PC: %s", self.local_url)
        except OSError as e:
            log.error("Nemôžem počúvať na %s:%s – %s", self.LOCAL, self.port, e)
        threading.Thread(target=self._supervise, daemon=True, name="psi-companion").start()

    def _serve(self, ip: str) -> ThreadingHTTPServer:
        handler = type("H", (Handler,), {"companion": self})
        httpd = ThreadingHTTPServer((ip, self.port), handler)
        httpd.daemon_threads = True
        threading.Thread(target=httpd.serve_forever, daemon=True, name=f"psi-http-{ip}").start()
        return httpd

    def _supervise(self) -> None:
        """LAN poslucháč; pri zmene IP (DHCP, iná Wi-Fi) sa presunie."""
        warned = False
        while True:
            ip = lan_ip() if features().get("companion_lan", True) else None
            if ip and not is_lan(ip):
                if ip != self.LOCAL:
                    log.error("companion.host %s nie je privátna LAN adresa – pre mobil server nespustím.", ip)
                ip = None
            if ip != self.host:
                if self.httpd:
                    self.httpd.shutdown()
                    self.httpd.server_close()
                    self.httpd, self.host = None, None
                if ip:
                    try:
                        self.httpd, self.host = self._serve(ip), ip
                        log.info("PSI Companion pre mobil: %s", self.url)
                        warned = False
                    except OSError as e:
                        log.error("Nemôžem počúvať na %s:%s – %s", ip, self.port, e)
                elif not warned:
                    log.warning("PSI Companion: mobil vypnutý alebo bez siete – beží len na %s.", self.local_url)
                    warned = True
            self._wake.wait(30)
            self._wake.clear()

"""Chrome DevTools Protocol klient pre Steam CEF (127.0.0.1:8080) – len stdlib."""
from __future__ import annotations

import base64
import hashlib
import itertools
import json
import logging
import os
import socket
import struct
import threading
import urllib.parse
import urllib.request

log = logging.getLogger("psi.cdp")
# Steam CEF počúva na 127.0.0.1 alebo (keď je IPv4 port obsadený) na [::1].
CEF_HOSTS = ["http://127.0.0.1:8080", "http://[::1]:8080"]
CEF = CEF_HOSTS[0]


class WebSocket:
    def __init__(self, url: str, timeout: float = 10):
        u = urllib.parse.urlparse(url)
        if u.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError("CDP len na localhoste")
        self.sock = socket.create_connection((u.hostname, u.port or 80), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        path = u.path + ("?" + u.query if u.query else "")
        self.sock.sendall((
            f"GET {path} HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WebSocket handshake zlyhal")
            resp += chunk
        head, self._buf = resp.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError(head.split(b"\r\n")[0].decode(errors="replace"))
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        if accept not in head:
            raise ConnectionError("Neplatný Sec-WebSocket-Accept")
        self.sock.settimeout(None)
        self._wlock = threading.Lock()

    def _frame(self, opcode: int, payload: bytes) -> None:
        n = len(payload)
        hdr = bytes([0x80 | opcode])
        if n < 126:
            hdr += bytes([0x80 | n])
        elif n < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            hdr += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        with self._wlock:
            self.sock.sendall(hdr + mask + masked)

    def send(self, text: str) -> None:
        self._frame(0x1, text.encode("utf-8"))

    def _read(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self._buf)))
            if not chunk:
                raise ConnectionError("WebSocket zatvorený")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def recv(self) -> str:
        parts = []
        while True:
            b1, b2 = self._read(2)
            fin, op = b1 & 0x80, b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
            if op == 0x8:
                raise ConnectionError("WebSocket close")
            if op == 0x9:
                self._frame(0xA, data)
                continue
            if op == 0xA:
                continue
            parts.append(data)
            if fin:
                return b"".join(parts).decode("utf-8", errors="replace")

    def close(self) -> None:
        try:
            self._frame(0x8, b"")
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


def list_targets(timeout: float = 3) -> list:
    """Zoznam CEF targetov; skúsi IPv4 aj IPv6 localhost."""
    global CEF
    err: Exception = OSError("CEF nedostupný")
    for base in [CEF] + [h for h in CEF_HOSTS if h != CEF]:
        try:
            with urllib.request.urlopen(base + "/json", timeout=timeout) as r:
                data = json.loads(r.read().decode())
            if isinstance(data, list):
                CEF = base
                return data
            err = ValueError("na porte 8080 beží iný program, nie Steam CEF")
        except ValueError:
            err = ValueError("na porte 8080 beží iný program, nie Steam CEF")
        except OSError as e:
            if not isinstance(err, ValueError):
                err = e
    raise err


class Session:
    """Jedno pripojenie k CEF targetu: volania + udalosti v samostatnom vlákne."""

    def __init__(self, target: dict, on_event):
        self.target = target
        self.ws = WebSocket(target["webSocketDebuggerUrl"])
        self.on_event = on_event
        self._ids = itertools.count(1)
        self._pending: dict[int, list] = {}
        self._plock = threading.Lock()
        self.alive = True
        self.thread = threading.Thread(target=self._reader, daemon=True,
                                       name=f"cdp-{target.get('title', '')[:20]}")
        self.thread.start()

    def _reader(self) -> None:
        try:
            while True:
                msg = json.loads(self.ws.recv())
                if "id" in msg:
                    with self._plock:
                        slot = self._pending.pop(msg["id"], None)
                    if slot:
                        slot[1] = msg
                        slot[0].set()
                elif "method" in msg:
                    try:
                        self.on_event(self, msg["method"], msg.get("params", {}))
                    except Exception:
                        log.exception("CDP event handler")
        except (OSError, ConnectionError, ValueError) as e:
            log.info("CDP session %s ukončená: %s", self.target.get("title"), e)
        finally:
            self.alive = False
            with self._plock:
                for slot in self._pending.values():
                    slot[0].set()
                self._pending.clear()

    def call(self, method: str, params: dict | None = None, timeout: float = 10) -> dict:
        mid = next(self._ids)
        slot = [threading.Event(), None]
        with self._plock:
            self._pending[mid] = slot
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        if not slot[0].wait(timeout) or slot[1] is None:
            raise TimeoutError(method)
        if "error" in slot[1]:
            raise RuntimeError(f"{method}: {slot[1]['error'].get('message')}")
        return slot[1].get("result", {})

    def notify(self, method: str, params: dict | None = None) -> None:
        """Bez čakania na odpoveď (napr. odoslanie výsledku do stránky)."""
        mid = next(self._ids)
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))

    def close(self) -> None:
        self.alive = False
        self.ws.close()

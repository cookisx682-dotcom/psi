"""Music waves: levels of the music that is playing, for the wave animation in Steam.

When a media player reports "Playing" (MPRIS via playerctl) and Steam is listening, PSI reads the
sound going to the speakers from the default sink's monitor (parec, PipeWire/PulseAudio), splits
it into frequency bands (Goertzel filters – no numpy needed) and publishes ~30 frames a second.
Nothing is recorded or stored; capture runs only while music plays and Steam shows the waves.
"""
from __future__ import annotations

import logging
import math
import shutil
import struct
import subprocess
import threading
import time

log = logging.getLogger("psi.audio")

RATE = 22050
N = 512                       # samples per frame (~23 ms)
BANDS = 24
LOW, HIGH = 45.0, 7000.0


class Waves:
    def __init__(self) -> None:
        self.cond = threading.Condition()
        self.frame: list | None = None          # None = no music
        self.seq = 0
        self.listeners = 0
        self.playing = False
        self._proc: subprocess.Popen | None = None
        freqs = [LOW * (HIGH / LOW) ** (i / (BANDS - 1)) for i in range(BANDS)]
        self._coef = [2 * math.cos(2 * math.pi * f / RATE) for f in freqs]
        self._win = [0.5 - 0.5 * math.cos(2 * math.pi * i / (N - 1)) for i in range(N)]
        self._smooth = [0.0] * BANDS
        self._peak = 1e-3
        threading.Thread(target=self._watch_player, daemon=True, name="psi-audio-player").start()
        threading.Thread(target=self._capture_loop, daemon=True, name="psi-audio").start()

    # ------------------------------------------------------------------ listeners (SSE clients)
    def attach(self) -> None:
        with self.cond:
            self.listeners += 1
            self.cond.notify_all()

    def detach(self) -> None:
        with self.cond:
            self.listeners = max(0, self.listeners - 1)

    def wait(self, seq: int, timeout: float = 15.0) -> tuple[int, list | None]:
        with self.cond:
            self.cond.wait_for(lambda: self.seq != seq, timeout=timeout)
            return self.seq, self.frame

    def _publish(self, frame: list | None) -> None:
        with self.cond:
            self.frame = frame
            self.seq += 1
            self.cond.notify_all()

    # ------------------------------------------------------------------ is music playing?
    def _watch_player(self) -> None:
        tool = shutil.which("playerctl")
        while True:
            playing = False
            if tool and self.listeners:
                try:
                    r = subprocess.run([tool, "-a", "status"], capture_output=True, text=True, timeout=3)
                    playing = "Playing" in r.stdout
                except (OSError, subprocess.TimeoutExpired):
                    pass
            if playing != self.playing:
                self.playing = playing
                with self.cond:
                    self.cond.notify_all()
            time.sleep(1.5)

    # ------------------------------------------------------------------ capture
    def _bands(self, raw: bytes) -> list:
        samples = struct.unpack(f"<{N}h", raw)
        win = self._win
        x = [samples[i] * win[i] / 32768.0 for i in range(N)]
        out = []
        for k, c in enumerate(self._coef):
            s1 = s2 = 0.0
            for v in x:
                s0 = v + c * s1 - s2
                s2 = s1
                s1 = s0
            power = s1 * s1 + s2 * s2 - c * s1 * s2
            out.append(math.sqrt(max(power, 0.0)) * (1 + k / BANDS))   # tilt: highs are naturally quieter
        # automatic gain – the waves look alive at any volume
        top = max(out) if out else 0.0
        self._peak = max(top, self._peak * 0.995, 1e-3)
        res = []
        for i, v in enumerate(out):
            v = min(1.0, v / self._peak)
            sm = self._smooth[i]
            sm = v if v > sm else sm * 0.82 + v * 0.18                      # fast rise, slow fall
            self._smooth[i] = sm
            res.append(round(sm, 3))
        return res

    def _capture_loop(self) -> None:
        tool = shutil.which("parec")
        if not tool:
            log.info("parec not found – music waves disabled")
            return
        while True:
            with self.cond:
                self.cond.wait_for(lambda: self.listeners > 0 and self.playing, timeout=5)
                active = self.listeners > 0 and self.playing
            if not active:
                continue
            try:
                self._proc = subprocess.Popen([tool, "-d", "@DEFAULT_MONITOR@", "--format=s16le", f"--rate={RATE}",
                                               "--channels=1", "--latency-msec=20", "--raw"],
                                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                last = 0.0
                while self.listeners > 0 and self.playing:
                    raw = self._proc.stdout.read(N * 2)
                    if not raw or len(raw) < N * 2:
                        break
                    now = time.monotonic()
                    if now - last < 1 / 30:
                        continue
                    last = now
                    self._publish(self._bands(raw))
            except OSError:
                log.exception("audio capture")
                time.sleep(5)
            finally:
                if self._proc:
                    self._proc.terminate()
                    try:
                        self._proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        self._proc.kill()
                    self._proc = None
                self._smooth = [0.0] * BANDS
                self._publish(None)


_waves: Waves | None = None
_lock = threading.Lock()


def waves() -> Waves:
    global _waves
    with _lock:
        if _waves is None:
            _waves = Waves()
        return _waves

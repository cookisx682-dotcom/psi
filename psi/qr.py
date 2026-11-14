"""Minimálny QR kód generátor (byte mode, ECC M, verzie 1–10) – len stdlib."""
from __future__ import annotations

# verzia: (EC kódové slová na blok, [(počet blokov, dátové slová na blok), ...])
_ECC_M = {
    1: (10, [(1, 16)]), 2: (16, [(1, 28)]), 3: (26, [(1, 44)]), 4: (18, [(2, 32)]),
    5: (24, [(2, 43)]), 6: (16, [(4, 27)]), 7: (18, [(4, 31)]), 8: (22, [(2, 38), (2, 39)]),
    9: (22, [(3, 36), (2, 37)]), 10: (26, [(4, 43), (1, 44)]),
}
_ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
          7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]}

# GF(256) s polynómom 0x11D
_EXP = [0] * 512
_LOG = [0] * 256
_x = 1
for _i in range(255):
    _EXP[_i] = _x
    _LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _EXP[_i] = _EXP[_i - 255]


def _gmul(a: int, b: int) -> int:
    return 0 if a == 0 or b == 0 else _EXP[_LOG[a] + _LOG[b]]


def _rs_generator(n: int) -> list:
    g = [1]
    for i in range(n):
        ng = [0] * (len(g) + 1)
        for j, c in enumerate(g):
            ng[j] ^= c
            ng[j + 1] ^= _gmul(c, _EXP[i])
        g = ng
    return g


def _rs_remainder(data: list, n: int) -> list:
    gen = _rs_generator(n)
    rem = list(data) + [0] * n
    for i in range(len(data)):
        coef = rem[i]
        if coef:
            for j in range(1, len(gen)):
                rem[i + j] ^= _gmul(gen[j], coef)
    return rem[len(data):]


def _bch(value: int, poly: int, bits: int) -> int:
    v = value << bits
    plen = poly.bit_length()
    while v.bit_length() >= plen:
        v ^= poly << (v.bit_length() - plen)
    return (value << bits) | v


class QR:
    def __init__(self, text: str):
        data = text.encode("utf-8")
        for ver in range(1, 11):
            ec, groups = _ECC_M[ver]
            cap = sum(n * k for n, k in groups)
            cc_bits = 8 if ver < 10 else 16
            if 4 + cc_bits + 8 * len(data) <= cap * 8:
                break
        else:
            raise ValueError("Text je príliš dlhý pre QR verziu 10.")
        self.version, self.size = ver, 17 + 4 * ver

        bits = []

        def put(val, n):
            bits.extend((val >> i) & 1 for i in range(n - 1, -1, -1))

        put(0b0100, 4)
        put(len(data), cc_bits)
        for b in data:
            put(b, 8)
        put(0, min(4, cap * 8 - len(bits)))
        while len(bits) % 8:
            bits.append(0)
        codewords = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
        pad = 0xEC
        while len(codewords) < cap:
            codewords.append(pad)
            pad ^= 0xEC ^ 0x11

        blocks, ecblocks, pos = [], [], 0
        for n, k in groups:
            for _ in range(n):
                blk = codewords[pos:pos + k]
                pos += k
                blocks.append(blk)
                ecblocks.append(_rs_remainder(blk, ec))
        final = []
        for i in range(max(len(b) for b in blocks)):
            final.extend(b[i] for b in blocks if i < len(b))
        for i in range(ec):
            final.extend(b[i] for b in ecblocks)

        n = self.size
        self.m = [[False] * n for _ in range(n)]
        self.fn = [[False] * n for _ in range(n)]
        self._function_patterns()
        self._place(final)

        best, best_pen = None, None
        for mask in range(8):
            self._apply_mask(mask)
            self._format(mask)
            pen = self._penalty()
            if best_pen is None or pen < best_pen:
                best, best_pen = mask, pen
            self._apply_mask(mask)  # XOR späť
        self._apply_mask(best)
        self._format(best)

    # ------------------------------------------------------------------ vzory
    def _set(self, x, y, dark):
        self.m[y][x] = dark
        self.fn[y][x] = True

    def _function_patterns(self):
        n = self.size
        for i in range(n):
            self._set(6, i, i % 2 == 0)
            self._set(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (n - 4, 3), (3, n - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < n and 0 <= y < n:
                        d = max(abs(dx), abs(dy))
                        self._set(x, y, d not in (2, 4))
        al = _ALIGN[self.version]
        for i, ax in enumerate(al):
            for j, ay in enumerate(al):
                if (i == 0 and j == 0) or (i == 0 and j == len(al) - 1) or (i == len(al) - 1 and j == 0):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self._set(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)
        self._format(0)  # rezervácia
        if self.version >= 7:
            v = _bch(self.version, 0x1F25, 12)
            for i in range(18):
                bit = (v >> i) & 1 == 1
                a, b = n - 11 + i % 3, i // 3
                self._set(a, b, bit)
                self._set(b, a, bit)

    def _format(self, mask):
        n = self.size
        v = _bch((0b00 << 3) | mask, 0x537, 10) ^ 0x5412  # ECC M = 00
        bit = lambda i: (v >> i) & 1 == 1
        for i in range(6):
            self._set(8, i, bit(i))
        self._set(8, 7, bit(6))
        self._set(8, 8, bit(7))
        self._set(7, 8, bit(8))
        for i in range(9, 15):
            self._set(14 - i, 8, bit(i))
        for i in range(8):
            self._set(n - 1 - i, 8, bit(i))
        for i in range(8, 15):
            self._set(8, n - 15 + i, bit(i))
        self._set(8, n - 8, True)  # tmavý modul

    def _place(self, data):
        n, i = self.size, 0
        total = len(data) * 8
        right = n - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(n):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = n - 1 - vert if upward else vert
                    if not self.fn[y][x] and i < total:
                        self.m[y][x] = (data[i >> 3] >> (7 - (i & 7))) & 1 == 1
                        i += 1
            right -= 2

    def _apply_mask(self, mask):
        f = [
            lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0,
            lambda x, y: (x + y) % 3 == 0, lambda x, y: (x // 3 + y // 2) % 2 == 0,
            lambda x, y: x * y % 2 + x * y % 3 == 0, lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
            lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
        ][mask]
        for y in range(self.size):
            for x in range(self.size):
                if not self.fn[y][x] and f(x, y):
                    self.m[y][x] = not self.m[y][x]

    def _penalty(self):
        n, m, pen = self.size, self.m, 0
        lines = [m[y] for y in range(n)] + [[m[y][x] for y in range(n)] for x in range(n)]
        pat1 = [True, False, True, True, True, False, True, False, False, False, False]
        pat2 = pat1[::-1]
        for line in lines:
            run, prev = 0, None
            for c in line:
                if c == prev:
                    run += 1
                else:
                    if run >= 5:
                        pen += run - 2
                    run, prev = 1, c
            if run >= 5:
                pen += run - 2
            for i in range(n - 10):
                seg = line[i:i + 11]
                if seg == pat1 or seg == pat2:
                    pen += 40
        for y in range(n - 1):
            for x in range(n - 1):
                c = m[y][x]
                if c == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                    pen += 3
        dark = sum(sum(r) for r in m)
        pen += (abs(dark * 20 - n * n * 10) // (n * n)) * 10
        return pen

    # ------------------------------------------------------------------ výstup
    def matrix(self, border: int = 2) -> list:
        n = self.size
        return [[0 <= x < n and 0 <= y < n and self.m[y][x]
                 for x in range(-border, n + border)] for y in range(-border, n + border)]

    def terminal(self, border: int = 2) -> str:
        """Polovičné bloky: 2 riadky modulov na 1 riadok terminálu (tmavé = medzera
        na svetlom pozadí, aby to fungovalo aj v tmavom termináli)."""
        mx = self.matrix(border)
        if len(mx) % 2:
            mx.append([False] * len(mx[0]))
        out = []
        for y in range(0, len(mx), 2):
            row = []
            for top, bot in zip(mx[y], mx[y + 1]):
                row.append({(False, False): "█", (True, False): "▄", (False, True): "▀", (True, True): " "}[(top, bot)])
            out.append("".join(row))
        return "\n".join(out)

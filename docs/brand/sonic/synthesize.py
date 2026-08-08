#!/usr/bin/env python3
"""
Cadence sonic logo — synthesizer.

Renders the 2–4s audio mnemonic described in docs/brand/sonic/brief.md into a
16-bit PCM WAV using only the Python standard library (no third-party deps), so
it is cheap and fully reproducible:

    python docs/brand/sonic/synthesize.py

Concept: a bright D-major arpeggio (the idea "building") that resolves into a
warm D-major tonic bloom (the cadence landing "home"), capped by a soft cyan
"resolution" ping — the sonic twin of the logomark.
"""
import math
import struct
import wave
from pathlib import Path

SR = 44100          # sample rate
BITS = 16
CH = 1

# ---- Note frequencies (equal temperament, A4 = 440) ----
D3, D4, Fs4, A4 = 146.83, 293.66, 369.99, 440.00
D5, Fs5, A5, A6 = 587.33, 739.99, 880.00, 1760.00


def adsr(n, a, d, s, r, sus):
    """Sample-wise ADSR envelope of length n (seconds a/d/r; sus level 0..1)."""
    env = [0.0] * n
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    for i in range(n):
        if i < ai:
            env[i] = i / max(1, ai)
        elif i < ai + di:
            env[i] = 1.0 - (1.0 - sus) * ((i - ai) / max(1, di))
        elif i < n - ri:
            env[i] = sus
        else:
            env[i] = sus * (1.0 - (i - (n - ri)) / max(1, ri))
    return env


def mallet(freq, dur, gain=0.5):
    """Bright FM bell/mallet: sine carrier + fast-decaying modulator."""
    n = int(dur * SR)
    env = adsr(n, 0.004, dur * 0.9, 0.0, 0.02, 0.0)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        mod_env = math.exp(-7.0 * t)                 # metallic attack that decays
        mod = 3.0 * mod_env * math.sin(2 * math.pi * freq * 2.0 * t)
        out[i] = gain * env[i] * math.sin(2 * math.pi * freq * t + mod)
    return out


def pad(freq, dur, gain=0.22, detune=0.004):
    """Warm sustained voice: two lightly detuned oscillators (sine + soft 2nd harmonic)."""
    n = int(dur * SR)
    env = adsr(n, 0.25, 0.15, 0.85, 0.7, 0.85)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        a = math.sin(2 * math.pi * freq * (1 - detune) * t)
        b = math.sin(2 * math.pi * freq * (1 + detune) * t)
        h2 = 0.18 * math.sin(2 * math.pi * freq * 2 * t)
        out[i] = gain * env[i] * (0.5 * (a + b) + h2)
    return out


def add(buf, sound, start):
    """Mix `sound` into `buf` starting at time `start` seconds (buf auto-grows)."""
    s = int(start * SR)
    end = s + len(sound)
    if end > len(buf):
        buf.extend([0.0] * (end - len(buf)))
    for i, v in enumerate(sound):
        buf[s + i] += v


def reverb(buf, taps=((0.060, 0.35), (0.130, 0.24), (0.230, 0.16), (0.370, 0.09))):
    """Cheap fixed-tap reverb tail for a small, warm space."""
    out = list(buf)
    for delay, gain in taps:
        d = int(delay * SR)
        if d >= len(out):
            continue
        for i in range(len(buf)):
            out[i + d if i + d < len(out) else len(out) - 1] += buf[i] * gain
    return out


def main():
    buf = []

    # 1) Rising D-major arpeggio — the idea building (staccato mallets).
    add(buf, mallet(D5, 0.17, 0.42), 0.00)
    add(buf, mallet(Fs5, 0.17, 0.45), 0.18)
    add(buf, mallet(A5, 0.19, 0.50), 0.36)

    # 2) The resolution — a warm D-major tonic bloom (V->I lands home).
    res = 0.60
    add(buf, pad(D3, 2.0, 0.16), res)
    add(buf, pad(D4, 2.0, 0.20), res)
    add(buf, pad(Fs4, 2.0, 0.18), res)
    add(buf, pad(A4, 2.0, 0.18), res)
    add(buf, pad(D5, 2.0, 0.12), res)

    # 3) Cyan "resolution ping" — the logomark's dot, in sound.
    add(buf, mallet(A6, 0.5, 0.12), res)

    # Space + master.
    buf = reverb(buf)
    buf.extend([0.0] * int(0.2 * SR))               # let the tail breathe

    peak = max(1e-9, max(abs(v) for v in buf))
    norm = 0.89 / peak                              # normalize with headroom
    frames = bytearray()
    for v in buf:
        x = math.tanh(v * norm * 1.05)              # gentle soft-clip
        frames += struct.pack('<h', int(max(-1.0, min(1.0, x)) * 32767))

    out_path = Path(__file__).with_name('cadence-sonic-logo.wav')
    with wave.open(str(out_path), 'wb') as w:
        w.setnchannels(CH)
        w.setsampwidth(BITS // 8)
        w.setframerate(SR)
        w.writeframes(bytes(frames))

    print(f'Wrote {out_path.name}  ({len(buf) / SR:.2f}s, {len(frames)} bytes)')


if __name__ == '__main__':
    main()

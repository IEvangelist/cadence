# Sonic identity — the Cadence audio logo

> **Files:** [`cadence-sonic-logo.wav`](./cadence-sonic-logo.wav) (2.8s render) ·
> [`synthesize.py`](./synthesize.py) (reproducible, stdlib-only source)

## The idea
A brand called **Cadence** should *sound* like a cadence: a musical phrase that
builds and then **resolves home**. The audio logo is the sonic twin of the
logomark — the violet bars rise, the cyan tonic lands.

## Precise spec (for a composer/sound designer to re-record)

| Property | Value |
|---|---|
| Duration | **2.6–2.8s** (2.8s in the reference render, incl. reverb tail) |
| Key | **D major** (bright, optimistic) |
| Tempo | **~100 BPM**, rubato — the resolve is unhurried |
| Gesture | **V→I authentic cadence** feel: rising arpeggio → sustained tonic chord |
| Loudness | Normalized to −1 dBFS peak with ~0.89 headroom + gentle soft-clip |

### Layer 1 — the rise (the idea building)
Three **staccato mallet/FM-bell** notes, bright and percussive, ascending a
D-major triad:

| Note | Freq | Onset | Length |
|---|---|---|---|
| D5  | 587.33 Hz | 0.00s | 0.17s |
| F♯5 | 739.99 Hz | 0.18s | 0.17s |
| A5  | 880.00 Hz | 0.36s | 0.19s |

*Timbre:* sine carrier with a modulator one octave up and a fast-decaying
modulation index (`e^-7t`) → a metallic, xylophone-like attack. Envelope:
~4 ms attack, exponential decay, no sustain.

### Layer 2 — the resolution (landing home)
A warm **D-major tonic bloom** enters at **0.60s** and sustains ~2.0s with a slow
250 ms attack and long 700 ms release:

- Root **D3** (146.83 Hz), and chord **D4 · F♯4 · A4** (293.66 / 369.99 / 440.00 Hz),
  plus a soft **D5** shimmer.
- *Timbre:* two lightly detuned oscillators (±0.4%) per voice for width, with a
  gentle 2nd-harmonic to keep it warm rather than glassy.

### Layer 3 — the "resolution ping"
A single soft, high **A6** (1760 Hz) bell at 0.60s — the audible twin of the
logomark's floating cyan dot. Very low gain, quick decay.

### Space
A cheap fixed-tap reverb (taps at 60 / 130 / 230 / 370 ms, decaying gain)
creates a small, warm room. A 0.2s silent tail lets it breathe.

## Usage
- **App launch / splash:** full 2.8s logo.
- **Success / export complete:** Layer 2 bloom only (~1.2s), lower gain.
- **Micro-confirmations:** a single mallet note (D5), ≤ 200 ms.
- Always respect the OS "reduce/mute UI sounds" setting; never loop the logo.
- Keep it **≤ −1 dBFS**; duck under speech and never play twice within 3s.

## Reproduce / re-render
```bash
python docs/brand/sonic/synthesize.py   # writes cadence-sonic-logo.wav
```
No third-party dependencies — pure Python standard library (`wave`, `struct`,
`math`). To ship an MP3/AAC for the web, encode the WAV with your platform's
encoder (e.g. `ffmpeg -i cadence-sonic-logo.wav cadence-sonic-logo.mp3`); the WAV
stays the archival master.

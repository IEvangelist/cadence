---
layout: ../../layouts/DocsLayout.astro
title: Features
description: What Cadence can do today — composing, AI assistance, stems, collaboration, import/export — and how capabilities map to tiers.
---

# Features

Cadence aims to be stupid-easy for newcomers and endlessly extensible for pros.
Here's what the app does today and how capabilities map to editions.

## Compose

A low-latency Web Audio composer with a piano-roll editor, transport, metronome,
and a rich instrument set — keyboard-first and built to stay smooth on a canvas
timeline. Notation round-trips through MusicXML (OpenSheetMusicDisplay + VexFlow).

<figure>
  <img
    src="/cadence/screenshots/piano-roll.webp"
    width="1200"
    height="710"
    alt="Cadence piano-roll editor: violet note blocks arranged across a horizontal timeline beside a vertical piano keyboard, with a transport bar above."
    loading="lazy"
    decoding="async"
  />
  <figcaption>The piano-roll editor — transport, timeline, and note blocks.</figcaption>
</figure>

## AI composition assistant

Suggest chords, harmonize a melody, or continue a phrase. The **free** tier runs
an in-browser assistant (Magenta.js + TensorFlow.js) that works offline; paid
tiers add **server-side generation** through the premium AI service for larger
models and longer context. The assistant sits behind a typed provider seam, so
the runtime can evolve without changing the UI.

<figure>
  <img
    src="/cadence/screenshots/ai-assistant.webp"
    width="704"
    height="834"
    alt="The Cadence AI assistant panel with actions to suggest chords, harmonize a melody, and continue a phrase, plus temperature and length controls."
    loading="lazy"
    decoding="async"
  />
  <figcaption>The AI assistant — suggest, harmonize, and continue, on-device or server-side.</figcaption>
</figure>

## Stems

Split a track into its constituent sources — bass, drums, vocals, guitar, keys,
and synth — using an ONNX/Demucs separation worker. Each stem returns as an
editable track with its own solo, mute, and gain.

## Collaborate

Edit a project together in real time. The client uses Yjs (a CRDT) with awareness
and presence over a WebSocket relay, so concurrent edits merge without conflicts.
Projects are owner-scoped and can be shared with owner, editor, or viewer roles.

## Import, export & share

- **MIDI** and **MusicXML** import/export for interop with other tools.
- **WAV** and **MP3** audio export.
- Portable `.cadence.json` projects.
- Offline-first local storage that syncs to the cloud on sign-in.

<figure>
  <img
    src="/cadence/screenshots/import-export-share.webp"
    width="1600"
    height="68"
    alt="The Cadence composer toolbar showing import, export, and share actions for MIDI, MusicXML, WAV, and MP3."
    loading="lazy"
    decoding="async"
  />
  <figcaption>Import, export, and share — right in the composer toolbar.</figcaption>
</figure>

## Editions

The **free tier is a real studio** — full composer, in-browser AI, and MIDI /
MusicXML import-export — with an **audible watermark** on exports and a few
limits. Paid tiers remove the watermark and unlock server-side AI, hi-fi export,
cloud sync, collaboration, and stem separation.

| Capability | Free | Pro | Studio |
|---|:--:|:--:|:--:|
| Composer, piano roll, mixer | ✅ | ✅ | ✅ |
| In-browser (offline) AI assistant | ✅ | ✅ | ✅ |
| MIDI & MusicXML import / export | ✅ | ✅ | ✅ |
| Watermark-free export | — | ✅ | ✅ |
| Hi-fi WAV / MP3 export | — | ✅ | ✅ |
| Server-side AI generation | — | ✅ | ✅ |
| Cloud sync + revision history | — | ✅ | ✅ |
| Live collaboration | — | ✅ | ✅ |
| Stem separation | — | — | ✅ |
| Team roles & priority support | — | — | ✅ |

> Editions and pricing are indicative for the preview and not final. The free
> tier is always free. The subscription **tier** already exists in the data model
> as a claim (default `Free`); billing and feature-gating plug into the
> entitlement seam described in [Authentication](../auth/).

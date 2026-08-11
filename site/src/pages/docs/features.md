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

Cadence ships **64 built-in instruments** — synthesis and physical-modeling
voices spanning keys, guitars & plucked, bass, strings, brass & winds, leads,
pads, mallets, and percussion — plus **5 drum kits**. Every one is registered
through the composer's [Plugin SDK](../plugin-sdk/), the same typed seam a
third-party plugin uses to add its own instruments, formats, and commands.

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

Suggest chords, harmonize a melody, or continue a phrase. The assistant runs
**entirely on-device** in your browser (Magenta.js + TensorFlow.js), so it works
offline and your music never leaves your machine. The free tier includes **50
generations per day**; paid tiers lift that cap. The assistant sits behind a
typed provider seam (part of the [Plugin SDK](../plugin-sdk/)), so the runtime can
evolve without changing the UI.

> **On-device only, today.** Larger **server-side** models are marketed as a paid
> enhancement but are **not yet shipped** — there is no server-side AI generation
> service in the backend. All AI generation currently happens in the browser.

<figure>
  <img
    src="/cadence/screenshots/ai-assistant.webp"
    width="704"
    height="834"
    alt="The Cadence AI assistant panel with actions to suggest chords, harmonize a melody, and continue a phrase, plus temperature and length controls."
    loading="lazy"
    decoding="async"
  />
  <figcaption>The AI assistant — suggest, harmonize, and continue, on-device.</figcaption>
</figure>

## Stems

Split a mix into its constituent sources — **bass, drums, vocals, guitar, keys,
synth, and other** — through an authenticated, owner-scoped **asynchronous job
pipeline** backed by an ONNX/Demucs separation worker (with a deterministic
band-split fallback in CI/dev). Upload a mix, the job runs server-side, and each
labeled stem returns as a WAV you can preview and download. Stem separation is a
**paid** entitlement (free users see an upgrade prompt).

> Phase 1 ships the standalone separation surface (upload → preview → download).
> Bringing a separated stem back into the composer as an editable mixer track with
> its own solo, mute, and gain is a planned Phase 2 follow-up.

## Collaborate

Edit a project together in real time. The client uses Yjs (a CRDT) with awareness
and presence over a WebSocket relay — a first-party endpoint inside the API, not a
separate service — so concurrent edits merge without conflicts. Projects are
owner-scoped and shared through links that carry an **owner, editor, or viewer**
role, resolved and enforced server-side (viewer writes are dropped before
fan-out). Collaboration is a paid, seat-limited feature and stays inert until a
session is explicitly activated.

## Import, export & share

- **MIDI** and **MusicXML** import/export for interop with other tools.
- **WAV** audio export (lossless PCM). *MP3 export is marketed but not yet
  shipped — WAV is currently the only rendered-audio export.*
- Portable `.cadence.json` projects.
- Shareable **listen links** — a client-side snapshot, no account required.
- Offline-first local storage that syncs to your account's cloud projects on
  sign-in.

<figure>
  <img
    src="/cadence/screenshots/import-export-share.webp"
    width="1600"
    height="68"
    alt="The Cadence composer toolbar with import, export, and share actions, including MIDI import/export."
    loading="lazy"
    decoding="async"
  />
  <figcaption>Import, export, and share — right in the composer toolbar.</figcaption>
</figure>

## Extend it

The composer is built on a typed, in-process **Plugin SDK**. A plugin can
contribute instruments, audio effects, import/export formats, AI providers,
commands (with their own keyboard shortcuts), and sidebar panels — through the
same host the built-ins use. See the [Plugin SDK](../plugin-sdk/) guide.

## Editions

The **free tier is a real studio** — full composer, on-device AI, and MIDI /
MusicXML import-export — with an **audible watermark** on exports and a few
limits. Paid tiers remove the watermark and lift the caps. The table reflects
what the backend **enforces today**, mapped onto the editions shown on the
[pricing page](/cadence/#pricing).

| Capability | Free | Pro | Studio |
|---|:--:|:--:|:--:|
| Composer, piano roll, mixer | ✅ | ✅ | ✅ |
| On-device (offline) AI assistant | ✅ | ✅ | ✅ |
| AI generations per day | 50 | Unlimited | Unlimited |
| MIDI & MusicXML import / export | ✅ | ✅ | ✅ |
| WAV export | ✅ (watermarked) | ✅ | ✅ |
| Watermark-free export | — | ✅ | ✅ |
| Cloud projects | Up to 10 | Unlimited | Unlimited |
| Live collaboration (seats) | 1 | 5 | 5 |
| Stem separation | — | ✅ | ✅ |

> **What's enforced today.** Cadence's entitlement engine implements two enforced
> levels — **Free** and **paid**. The **Pro** and **Studio** editions on the
> pricing page currently resolve to the *same* unlocked entitlement set
> (watermark-free export, unlimited projects and AI, stem separation, and 5
> collaboration seats); the finer Studio-vs-Pro packaging (e.g. team perks) isn't
> separately gated yet. **Server-side AI generation** and **MP3 export** are shown
> on the pricing page but are **not yet shipped** — today AI runs on-device and
> WAV is the only rendered-audio export. Pricing is indicative for the preview and
> not final; the free tier is always free. The subscription **tier** is a claim
> (default `Free`) resolved through the entitlement seam described in
> [Authentication](../auth/).

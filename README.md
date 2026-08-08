# Cadence (working codename)

> **AI-powered, cross-platform music creation studio.** Stupid-easy for newcomers,
> endlessly extensible for pros. Built test-first, delivered by a Squad team of teams.

> ⚠️ **Codename.** "Cadence" is a placeholder — the Brand & Design squad finalizes the
> real name, logo, palette, and sonic identity in Phase 1.

## What it is

A Tauri desktop app (cross-platform from day one) wrapping a TypeScript SPA, backed by
a .NET Aspire service graph. The signature feature is a **symbolic composition
assistant** (suggest chords/melodies/harmonies, continue a piece). It also isolates a
single audio source into individual **stems** (bass, drums, vocals, guitar, keys,
synth), supports live collaboration, import/export/share, and a rich instrument set.

## Stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri (Rust) |
| Web UI | TypeScript SPA (React + Vite) |
| Audio/MIDI | Tone.js / Web Audio, Web MIDI, soundfonts |
| Notation | OpenSheetMusicDisplay + VexFlow |
| AI (core) | Symbolic assistant — in-browser Magenta.js/TF.js (free) + server-side (premium) |
| Stem separation | Demucs/ONNX inference service |
| Backend | .NET Aspire, ASP.NET Core (REST + OpenAPI) |
| Data | Postgres + Azure Blob Storage + Redis |
| Auth | ASP.NET Core Identity + OAuth (GitHub/Google/Microsoft) + email magic-link |
| Collab | Yjs CRDT + presence relay |
| Billing | Stripe (freemium; free tier = watermarked audio + limits) |
| Deploy | Azure Container Apps via `azd` + GitHub Actions; landing on GitHub Pages |

## Repository layout

```
apps/web       TypeScript SPA (Vite + React)
apps/desktop   Tauri desktop shell (Rust) — requires the Rust toolchain
src            .NET services (Aspire AppHost, ServiceDefaults, API, workers)
tests          Test projects (unit, integration, e2e, a11y, security)
infra          azd / IaC and deployment assets
docs           Architecture, brand kit, plan/roadmap
.squad         Squad team-of-teams state (created by `squad init`)
```

## Delivery model — Squad

Development is driven by [**Squad**](https://github.com/bradygaster/squad), a human-led
AI agent-team tool for GitHub Copilot. We run a *team of teams*: an orchestrator/lead
squad plus one specialist squad per effort (Brand, Audio/Composer, AI/ML,
Identity & Billing, Realtime/Collab, DSP/Stems, Interop/Formats, Platform/Extensibility,
DevOps/Release, QA/Test, Docs).

```bash
npm install -g @bradygaster/squad-cli
squad init --preset default
gh auth login
copilot --agent squad --yolo
```

Humans stay accountable for priorities, approvals, and final merges.

## Status

🚧 **Phase 0 — Foundations.** See [`docs/plan.md`](docs/plan.md) for the full roadmap.

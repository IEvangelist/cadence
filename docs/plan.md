# AI-Powered Music App — Implementation Plan

> Working title: **"Composer"** (placeholder — rename before public launch).

## Problem & Vision

Build a cross-platform, AI-powered music creation app that is *stupid-easy* for
newcomers yet completely extensible for pros. Core experience is a web UI shipped
as a **Tauri** desktop app (cross-platform from day one). The signature AI feature
is a **symbolic composition assistant** (chords/melody/harmony suggestion,
continue/complete a piece — Magenta-style). It supports import/export/share, live
collaboration, multiple instruments, and interoperates with industry formats. It
can also **isolate a single audio source into individual stems** (bass, drums,
vocals, guitar, keyboards, synth). The whole codebase is built **test-first (TDD)**
with unit, integration, smoke, e2e, accessibility, and security tests gating CI/CD.
Backend runs on **.NET Aspire**, persists to **Postgres**, stores audio/assets in
**Blob Storage**, authenticates via **ASP.NET Core Identity + OAuth**, and monetizes
via a **freemium** model (free tier = watermarked audio + limits; paid unlocks more).
Self-deploying to **Azure Container Apps** via `azd` + GitHub Actions, with a
**GitHub Pages** landing page and first-class docs.

## Confirmed Decisions

| Area | Decision |
|---|---|
| Platform | Tauri cross-platform desktop wrapping the web UI (day one) |
| Web UI | TypeScript SPA (**React + Vite** recommended; SolidJS alt — see Notes) |
| AI (core) | Symbolic composition assistant, **hybrid**: in-browser Magenta.js/TF.js (free/basic, offline) + server-side models (premium) |
| Auth | ASP.NET Core Identity + OAuth (GitHub, Google, Microsoft) + email magic-link; claims drive tier entitlements |
| Backend | .NET Aspire orchestration; REST + OpenAPI |
| Data | Postgres (relational) + Azure Blob Storage (audio/assets) + Redis (presence/cache/rate-limit) |
| Collab | Yjs CRDT + presence over a WebSocket relay (Aspire-orchestrated) |
| Deploy | Azure Container Apps via `azd`; GitHub Actions CI/CD |
| Monetization | Stripe billing; free tier watermark + limits; premium unlocks server AI, hi-fi export, no watermark |
| Landing | GitHub Pages, static, links to downloads + docs |
| Testing | **TDD throughout**: unit, integration, smoke, e2e, accessibility, security validation — enforced as CI gates |
| Track isolation | Server-side **stem separation** (Demucs/ONNX): split one source into bass/drums/vocals/guitar/keys/synth tracks |
| Brand | Modern, expressive brand kit: logo/wordmark, palette, type, iconography, motion + **sonic identity**, guidelines & tokens |
| Delivery | **Squad** (`@bradygaster/squad-cli`) — a human-led *team of teams*; one specialist squad per effort, Ralph watch-mode triage, human approval gates |

## Delivery model — Squad (team of teams)

We build this with **Squad** (`bradygaster/squad`, alpha), a human-led AI agent-team
tool for GitHub Copilot. Squad specialists live in-repo as files under `.squad/`,
persist across sessions, learn the codebase, and record decisions so work stays
inspectable. **Humans stay accountable** for priorities, approvals, and final merges.

**Setup (first action, right after `git init`):**
```bash
npm install -g @bradygaster/squad-cli
squad init --preset default   # scaffolds .squad/team.md + squad.agent.md
gh auth login                 # for Issues, PRs, and Ralph
copilot --agent squad --yolo  # drive the squad
squad doctor                  # validate setup
```

**Team of teams.** Rather than one flat team, we stand up an **orchestrator/lead
squad** plus a **dedicated specialist squad per planned effort**, linked into a team
of teams with `squad link`. Each squad carries its own charter, routing rules, and
specialists (frontend / backend / tester / lead):

| Squad | Owns |
|---|---|
| Orchestrator / Lead | Cross-squad routing, decisions archive, approval gates |
| Brand & Design | Phase 1 (brand kit, logo, sonic identity, tokens) |
| Audio / Composer | Phase 2 (engine, piano roll, instruments, MIDI) |
| AI / ML | Phase 3 in-browser AI, Phase 5 premium AI, Phase 7 stems models |
| Identity & Billing | Phase 4 identity/persistence, Phase 5 freemium/Stripe |
| Realtime / Collaboration | Phase 6 (Yjs CRDT, presence, sharing) |
| DSP / Stems | Phase 7 (Demucs separation, multitrack isolation) |
| Interop / Formats | Phase 8 (MusicXML, notation, audio/stem export) |
| Platform / Extensibility | Phase 9 (plugin SDK, theming, config) |
| DevOps / Release | Phase 0 CI + Phase 10 (`azd`, installers, landing) |
| QA / Test (TDD) | Cross-cutting test suites + CI gates |
| Docs | Cross-cutting documentation |

**Execution loop.** Work is expressed as GitHub Issues. **Ralph watch mode**
(`squad watch --execute`) polls for actionable issues, triages them to the right
squad under the team's rules, dispatches Copilot agents, and **escalates to a human
when judgment or approval is needed**. Off-hours pausing, notify levels, and a
`git-notes`/`orphan-branch` state backend keep it controllable and auditable.

> **Operational guide:** see [`docs/squad-ops.md`](./squad-ops.md) for the label taxonomy,
> the exact routing rules, the mandatory human approval gates, and the precise command a human
> runs to (optionally) enable execute mode. In this repo, autonomous execution and auto-merge
> are **off by default** — Ralph only triages, labels, and assigns.

**Aspire-friendly.** `squad aspire` opens an Aspire dashboard for squad observability
(complements the app's own OTEL). The preview **`Squad.Agents.AI`** NuGet can later
expose a Squad-backed `AIAgent` (Microsoft Agent Framework) inside the product itself
if we want in-app agentic help — evaluated, not committed.

> Squad is **alpha**; pin the CLI version, use `squad upgrade` deliberately, and keep
> human review gates on every merge. `squad nap` for context hygiene between phases.

## Target Architecture (high level)

```
+------------------- Tauri Desktop Shell (Rust) -------------------+
|  TypeScript SPA (React + Vite)                                   |
|   - Composer canvas: piano roll, transport, mixer               |
|   - Audio engine: Tone.js / Web Audio; Web MIDI (webmidi.js)    |
|   - Notation: OpenSheetMusicDisplay (MusicXML) + VexFlow        |
|   - Multitrack mixer + isolated stem tracks                     |
|   - In-browser AI: Magenta.js + TensorFlow.js                   |
|   - Collab client: Yjs (CRDT) + awareness/presence             |
+------------------------------ HTTPS / WSS ----------------------+
                    |                         |
      +-------------v-----------+   +---------v-----------+
      |  .NET Aspire AppHost    |   | Yjs collab relay    |
      |  - API (ASP.NET Core)   |   | (Node y-websocket)  |
      |    REST + OpenAPI       |   +---------------------+
      |    Identity + OAuth     |
      |    Entitlements/billing |   +---------------------+
      |  - Premium AI service   |   | Postgres | Redis |  |
      |    (Python/ONNX)        |   | Blob (Azurite dev) |
      |  - Stem-separation svc  |   +---------------------+
      |    (Demucs/ONNX)        |
      +-------------------------+
```

## Testing & TDD strategy (first-class)

Development is **test-driven**: every feature starts with a failing test
(red → green → refactor). No phase is "done" until its tests were written first
and pass, and the CI gates below are green.

- **Unit** — audio/music logic, state reducers, API handlers (Vitest for web, xUnit for .NET).
- **Integration** — API + Postgres + Blob + Redis via the Aspire test host; REST/OpenAPI contract tests.
- **Smoke** — post-deploy health checks (API up, SPA loads, auth reachable, separation svc responds).
- **End-to-end** — Playwright journeys: compose → AI suggest → save → export → share → collaborate → separate stems.
- **Accessibility** — axe-core in e2e + keyboard-only journeys; WCAG AA targets.
- **Security validation** — dependency/secret scanning, SAST, authZ/entitlement tests, OAuth flow tests, Stripe webhook verification, watermark-bypass tests.
- **Determinism** — audio-engine render snapshots and CRDT collaboration convergence tests.
- **CI/CD & automation** — GitHub Actions runs all suites on every PR; merges blocked on failures + coverage thresholds; deploy pipeline runs smoke + a11y before promotion.

## Phased Roadmap (todos tracked in SQL)

> Every phase is executed test-first; each "Verify" implies the tests were authored before the implementation.

### Phase 0 — Foundations & scaffolding
- Bootstrap monorepo + `.editorconfig`, licenses, README, CODEOWNERS.
- **Install & init Squad** (`@bradygaster/squad-cli`, `squad init --preset default`); stand up the team of teams (`squad link`), routing rules, human approval gates, and Ralph watch config.
- Aspire AppHost + ServiceDefaults; wire Postgres, Redis, Blob (Azurite), API.
- Scaffold TS SPA (Vite + React + TypeScript) and Tauri shell; SPA loads in Tauri.
- **Stand up the TDD harness**: Vitest, xUnit, Playwright, axe-core, Aspire test host, security scanners.
- CI baseline: build/lint/test (all suites) for .NET + web + Rust on GitHub Actions with coverage gates.
- Verify: `aspire run` boots API + deps; Tauri renders the SPA; empty test suites run green in CI.

### Phase 1 — Brand kit, logo & visual identity
- Discovery: finalize name, positioning, tone, moodboards; define the **hook**.
- Logo + wordmark (responsive/adaptive marks), color palette, typography scale, iconography.
- **Sonic identity / audio logo** — a short signature sound (fitting for a music brand).
- Motion guidelines, illustration style, imagery direction.
- Export **design tokens** consumed by the app theme + landing page; publish brand guidelines doc.
- Verify: versioned brand kit delivered; tokens render in the app theme and a landing preview.

### Phase 2 — Composer MVP (no AI, no auth)
- Audio engine wrapper (Tone.js), transport (play/pause/tempo/metronome).
- Piano-roll editor + basic instruments (synths + one sampled instrument via soundfont).
- Project model (in-memory + local file); MIDI import/export (`@tonejs/midi`).
- Verify: create a few bars, play back, export MIDI, re-import round-trips.

### Phase 3 — In-browser AI assistant (free/basic)
- Integrate Magenta.js + TF.js; load MelodyRNN/MusicVAE/Coconet models.
- "Continue melody", "harmonize", "suggest chords" actions on selection.
- Offline-capable; runs entirely client-side; graceful model loading UX.
- Verify: generate suggestions offline, insert into project, undo/redo works.

### Phase 4 — Identity, profiles & persistence
- ASP.NET Core Identity + OAuth (GitHub/Google/Microsoft) + email magic-link.
- User profile; project CRUD persisted to Postgres; assets to Blob.
- Autosave + revision history; "my projects" library.
- Verify: sign in via each provider, save/load a project across sessions.

### Phase 5 — Freemium, billing & entitlements
- Entitlement claims model (free/pro/studio) surfaced to SPA + enforced in API.
- Stripe integration (checkout, webhooks, customer portal).
- Free-tier limits (project count, export length/quality) + **audible audio watermark** on free exports.
- Premium **server-side AI** inference service (Python/ONNX) gated by entitlement.
- Verify: free export is watermarked + limited; upgrade unlocks clean export + server AI.

### Phase 6 — Live collaboration
- Yjs CRDT document model for projects; Aspire-orchestrated y-websocket relay.
- Presence/awareness (cursors, selection, who's editing); conflict-free multi-edit.
- Share links with role-based access (owner/editor/viewer).
- Verify: two clients edit the same project concurrently, converge, show presence.

### Phase 7 — Track isolation / stem separation
- Server-side separation service (Demucs/ONNX), Aspire-orchestrated, GPU-optional.
- Upload/import an audio file → isolate into stems: **bass, drums, vocals, guitar, keyboards, synth** (+ "other").
- Each stem lands as an individual editable track in the mixer; per-stem solo/mute/gain/effects.
- Async job pipeline (queue + progress), results cached in Blob; entitlement-gated (premium; free tier limited/watermarked).
- Verify: import a mixed track, receive labeled stems, edit/mute each independently.

### Phase 8 — Import/export/share & format interop
- MusicXML import/export + notation view (OpenSheetMusicDisplay + VexFlow).
- Audio export: WAV (offline render) + MP3; stems export (pro).
- Shareable public "view/listen" links; embeddable player.
- Verify: MusicXML round-trips; audio + stems export; share link plays for anon user.

### Phase 9 — Extensibility & customization
- Plugin SDK: custom instruments, effects, and AI providers (typed contracts).
- Theming (brand tokens) + layout customization; keyboard-shortcut + workspace config.
- Settings sync (per-user) + import/export of configuration.
- Verify: sample third-party instrument plugin loads and plays end-to-end.

### Phase 10 — Deploy, landing page & docs
- `azd` infra for Azure Container Apps; GitHub Actions deploy pipeline (self-deploying).
- Tauri release pipeline: signed cross-platform installers as GitHub Releases.
- GitHub Pages landing page (brand-driven; downloads, features, pricing) + docs site.
- Verify: push to main deploys backend; tagged release publishes installers; landing live.

## Cross-cutting concerns
- **Performance/UX:** lightweight bundles, code-splitting, low-latency audio scheduling, 60fps canvas, accessibility (keyboard + ARIA).
- **Testing (TDD):** test-first everywhere — unit (Vitest/xUnit), integration (Aspire test host), smoke (post-deploy), e2e (Playwright), accessibility (axe-core + keyboard), security validation (SAST/deps/secrets, authZ, watermark-bypass), plus audio determinism + CRDT convergence. All gated in CI/CD.
- **Observability:** OpenTelemetry via Aspire; structured logs, traces, metrics.
- **Security:** OAuth best practices, secret management, Stripe webhook verification, watermark that can't be trivially stripped client-side.
- **Docs:** architecture, brand guidelines, plugin SDK, self-host guide, API reference from OpenAPI.

## Notes / open micro-decisions
- **React vs SolidJS:** plan assumes **React + Vite** for the deepest audio/notation/CRDT ecosystem and hiring/DX. SolidJS is a valid lighter alternative if bundle size/perf trumps ecosystem — decide at Phase 0.
- **Premium AI models:** exact model set (e.g., larger Coconet/Transformer, or a hosted API) chosen at Phase 4; interface abstracted so provider is swappable.
- **Repo:** this is a chat session with no repo yet. Implementation begins by creating a new project/repository (monorepo) — first Phase 0 action.
- **Watermark strategy:** audible + metadata watermark on free-tier audio; enforce clean render server-side for entitled users to prevent client bypass.
- **Brand deliverables:** logo/wordmark (SVG), color + type tokens, iconography, motion + a short **sonic logo**, and a guidelines doc — versioned in-repo and consumed by both app theme and landing page. The "hook" (memorable core idea) is defined in Phase 1 discovery and drives visual + sonic direction.
- **Stem separation model:** Demucs (htdemucs) or equivalent via ONNX; GPU speeds it up but CPU fallback supported. Async job pipeline keeps the UI responsive; provider abstracted for future models.

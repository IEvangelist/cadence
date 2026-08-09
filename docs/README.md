# Cadence documentation

Project documentation for **Cadence**, the AI-powered, cross-platform music creation
studio. Start with the [root README](../README.md) for the elevator pitch, the
run-locally steps, and the feature matrix; use the map below to go deeper.

## Roadmap & delivery

- [`plan.md`](plan.md) — the implementation plan, phased roadmap, and the
  **delivery-status** table (what's shipped, in progress, and planned).
- [`squad-ops.md`](squad-ops.md) — how Cadence is built as a Squad *team of teams*:
  routing rules, the label taxonomy, and the mandatory human approval gates.

## Architecture & subsystems

- [`architecture.md`](architecture.md) — the service graph, project layout, and how
  the pieces fit together.
- [`plugins.md`](plugins.md) — the composer **Plugin SDK**: extension points, the host
  API, and a worked reference plugin.
- [`share.md`](share.md) — import / export / share and format interop (MIDI, MusicXML,
  WAV, portable `.cadence.json`, client-side share links).

## Setup guides

- [`auth-setup.md`](auth-setup.md) — identity, profiles, OAuth providers, and
  passwordless magic-link sign-in.
- [`billing-setup.md`](billing-setup.md) — freemium tiers, entitlements, Stripe wiring,
  and the free-tier audio watermark.

## Engineering practices

- [`testing.md`](testing.md) — the test-first harness: every suite, how to run it
  locally, and the CI + security/supply-chain gates.
- [`versioning-policy.md`](versioning-policy.md) — deterministic pinning across npm,
  .NET, GitHub Actions, and containers.

## Brand

- [`brand/`](brand/README.md) — the brand kit: naming, logo, color, typography,
  iconography, motion, sonic identity, and design tokens.

## Deployment

- [`../infra/README.md`](../infra/README.md) — self-deploy to Azure Container Apps with
  `azd` via the Aspire integration, plus the gated CI deploy workflow.

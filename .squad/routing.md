# Work Routing

How to decide who handles what.

## Routing Table

Each `squad`-labelled issue is triaged to the specialist squad whose domain is the primary
concern. Ralph applies these rules mechanically (see `## Work Type → Agent` and
`## Module Ownership` below); the Lead is the human-facing owner of triage.

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Brand & design | brand | Logo, wordmark, palette, typography, iconography, sonic identity, design tokens |
| Frontend / Web UI | frontend | SPA, piano roll, Tauri shell, components, layout, notation view |
| Backend / API | backend | REST/OpenAPI, endpoints, Postgres/Redis/Blob, identity, billing, entitlements |
| AI / ML | ai | Composition models, Magenta, inference, stem separation (Demucs/ONNX) |
| Realtime / Collab | realtime | Yjs CRDT, presence, share links, y-websocket relay |
| DevOps / Release | devops | CI, deploy (azd/ACA), workflows, installers, infra, Aspire dashboard |
| QA / Test (TDD) | tester | Vitest, xUnit, Playwright, axe-core, coverage/a11y/security gates |
| Documentation | docs | READMEs, guides, API reference, docs site |
| Security | security | AuthZ, secrets/SAST, watermark, credential detection |
| Code review | reviewer | Review PRs, check quality, suggest improvements |
| Developer experience | devrel | Samples, tutorials, onboarding, DX |
| Architecture & scope | lead | System design, roadmap, cross-cutting decisions, blocker resolution |
| Session logging | Scribe | Automatic — never needs routing |
| RAI review | Rai | Content safety, bias checks, credential detection, ethical review |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.

## Work Type → Agent

> **Machine-readable.** Ralph (`.squad/templates/ralph-triage.js`) parses this table. The
> **Agent** column must be a roster name from `team.md`; the **Examples** column is a
> comma-separated keyword list matched (case-insensitive substring) against issue title + body.
> More/longer keyword matches win. `## Module Ownership` (below) is checked first and wins ties.

| Work Type | Agent | Examples |
|-----------|-------|----------|
| Brand & Design | brand | brand, logo, wordmark, palette, typography, iconography, sonic identity, design token, moodboard |
| Frontend / Web UI | frontend | frontend, web ui, piano roll, react component, tauri, notation view, css, spa scaffold, mixer |
| Backend / API | backend | backend, rest api, openapi, endpoint, postgres, redis, blob storage, entitlement, oauth, billing, stripe, asp.net |
| AI / ML | ai | composition assistant, magenta, inference, melody, harmonize, chord suggestion, stem separation, demucs, onnx, musicvae, coconet, machine learning |
| Realtime / Collaboration | realtime | realtime, collaboration, presence, crdt, yjs, y-websocket, awareness, share link |
| DevOps / Release | devops | ci pipeline, deploy, azd, container apps, github actions, workflow, installer, release pipeline, infrastructure, aspire dashboard |
| QA / Test | tester | tdd, coverage, playwright, vitest, xunit, axe-core, accessibility, e2e, smoke test, regression |
| Documentation | docs | documentation, readme, guide, api reference, docs site |
| Security | security | security, vulnerability, secret scan, sast, watermark, authz, credential |
| Code Review | reviewer | code review, review pr, pull request review |
| Developer Relations | devrel | developer experience, sample app, tutorial, onboarding |
| Orchestrator / Lead | lead | architecture, system design, roadmap, cross-cutting, technical decision |

## Module Ownership

> **Machine-readable.** Ralph maps repo paths mentioned in an issue to an owning squad. The
> longest matching path wins; `Primary` is tried first, then `Secondary`.

| Module | Primary | Secondary |
|--------|---------|-----------|
| apps/web | frontend | brand |
| apps/desktop | frontend | devops |
| src/Cadence.Api | backend | security |
| src/Cadence.ServiceDefaults | backend | devops |
| src/Cadence.AppHost | devops | backend |
| tests | tester | — |
| infra | devops | — |
| .github | devops | — |
| .squad | devops | lead |
| docs/brand | brand | docs |
| tools/brand | brand | — |
| docs | docs | — |

## Status lifecycle

Status labels track where an issue sits. Ralph/triage set the early states automatically; the
later states are set by the owning squad or a human as work progresses.

| Label | Meaning | Set by |
|-------|---------|--------|
| `status:triage` | In the `squad` inbox, awaiting routing | Automatic when `squad` is applied |
| `status:ready` | Triaged + assigned to a squad, ready to start | Ralph / `squad-triage.yml` on assignment |
| `status:in-progress` | A squad member (or PR) is actively working it | Owning squad / on PR open |
| `status:needs-review` | Work is up for review (human gate) | Owning squad when a PR is ready |
| `status:blocked` | Cannot proceed (dependency/decision) | Anyone; document why in a comment |

## Human approval gates (mandatory)

Ralph **triages, labels, and assigns** — it does **not** write code or merge on its own.

1. **Execution is opt-in.** `squad watch` defaults to triage/categorize only. Spawning agents
   requires a human to run `squad watch --execute` locally (see `docs/squad-ops.md`).
2. **@copilot autonomy is off.** `@copilot` is not on the roster and the
   `<!-- copilot-auto-assign: true -->` gate is absent, so no issue is auto-worked.
3. **Merges are human.** No workflow merges PRs; every PR passes CI and human review first.

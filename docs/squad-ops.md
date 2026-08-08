# Squad Ops — how Cadence runs as a team of teams

Cadence is delivered with **Squad** (`@bradygaster/squad-cli`), a human-led "team of teams"
for GitHub Copilot. This document explains how the team is organized, how **Ralph**
(the watch-mode triage agent) labels and assigns issues, the **human approval gates** that
keep autonomous execution and auto-merge off, and the exact command a human runs to opt into
execute mode locally.

> **TL;DR — safety posture.** Ralph **triages, labels, and assigns** only. It does **not**
> write code, open PRs, or merge anything on its own. Autonomous code execution
> (`squad watch --execute`) and `@copilot` autonomy are **off** and can only be enabled by a
> human, locally, on purpose. No workflow in `.github/workflows/` merges a PR.

Related reading: [`docs/plan.md` → "Delivery model — Squad"](./plan.md#delivery-model--squad-team-of-teams),
[`.squad/team.md`](../.squad/team.md), [`.squad/routing.md`](../.squad/routing.md).

---

## 1. Team of teams

The roster (`.squad/team.md` → `## Members`) has two bands:

**Cross-cutting coordinator roles**

| Squad | Owns |
|-------|------|
| `lead` | Orchestration, cross-squad routing, architecture, decisions archive, approval gates |
| `reviewer` | Code review, quality gates |
| `security` | AuthZ, secrets/SAST, watermarking, credential detection |
| `docs` | READMEs, guides, API reference, docs site |
| `devrel` | Samples, tutorials, onboarding, developer experience |

**Per-effort specialist squads**

| Squad | Owns |
|-------|------|
| `brand` | Logo, wordmark, palette, typography, iconography, sonic identity, design tokens |
| `frontend` | TypeScript SPA, piano roll, Tauri shell, components, notation view |
| `backend` | REST/OpenAPI, endpoints, Postgres/Redis/Blob, identity, billing, entitlements |
| `ai` | Symbolic composition models, Magenta, inference, stem separation (Demucs/ONNX) |
| `realtime` | Yjs CRDT, presence, share links, y-websocket relay |
| `devops` | CI, deploy (azd/ACA), workflows, installers, infra, Aspire dashboard |
| `tester` | Vitest, xUnit, Playwright, axe-core; coverage/a11y/security gates |

Two always-on built-ins — **Scribe** (session logging) and **Rai** (responsible-AI review) —
never need routing.

Each member has a charter under `.squad/agents/<name>/charter.md` and a casting entry in
`.squad/casting/registry.json`. Every roster name automatically gets a `squad:<name>` label
(see §3).

---

## 2. How Ralph triages, labels, and assigns

Ralph is the **watch-mode triage** agent. It runs two ways, and **both do the same safe
thing** — categorize an issue and apply labels:

1. **In CI (event-driven, always on).** `.github/workflows/squad-heartbeat.yml` runs the
   canonical parser `.squad/templates/ralph-triage.js` whenever an issue is closed/labeled or a
   PR closes. It labels untriaged issues and comments with the routing decision. Its cron is
   **disabled** — it only reacts to events, never polls autonomously.
2. **Locally (opt-in).** A human can run `squad watch` (see §5). With **no flags** it triages
   and categorizes only — identical safe behavior.

### Routing precedence

For each `squad`-labelled issue, Ralph picks the owning squad using `.squad/routing.md`, in
this order (first match wins; ties broken by the next rule):

1. **Module ownership** (`## Module Ownership`) — if the issue mentions a repo path
   (e.g. `apps/web`, `src/Cadence.Api`, `tests/`), the longest matching path decides the owner.
2. **Work-type keywords** (`## Work Type → Agent`) — case-insensitive substring match of the
   issue title + body against each squad's keyword list. More/longer matches win.
3. **Role-keyword fallback** — a light match against roster role names.
4. **Lead fallback** — anything unmatched routes to `lead` for human analysis.

### What gets applied

On a triage decision, Ralph / the triage workflows apply:

- `squad:<owner>` — the routed specialist squad.
- `go:needs-research` — default verdict until a human sizes the work.
- `status:ready` — the issue is triaged + assigned and ready for the squad to start.

Then a comment is posted explaining **who** it routed to and **why**. Reassign by swapping the
`squad:*` label — no code runs as a result of any label.

### Active workflows

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `squad-triage.yml` | issue labeled `squad` | Routes → `squad:<owner>`, `go:needs-research`, `status:ready`, comments |
| `squad-issue-assign.yml` | issue labeled `squad:<member>` | Posts an assignment ack comment for that squad |
| `squad-heartbeat.yml` | issue closed/labeled, PR closed, manual | Ralph batch-triages any untriaged issues (cron disabled) |
| `sync-squad-labels.yml` | push to `.squad/team.md`, manual | Regenerates the label set from the roster |

Every `uses:` in these workflows is pinned to a full 40-character commit SHA.

---

## 3. Label taxonomy

Labels are generated from the roster and a fixed taxonomy by `sync-squad-labels.yml`. They are
also created idempotently in the repo (see that workflow for the source of truth).

| Group | Labels | Meaning |
|-------|--------|---------|
| **Squad** | `squad`, `squad:<member>` | `squad` = triage inbox; `squad:<member>` = routed owner |
| **Status** | `status:triage`, `status:ready`, `status:in-progress`, `status:needs-review`, `status:blocked` | Where the issue sits in its lifecycle |
| **Go** | `go:yes`, `go:no`, `go:needs-research` | Sizing verdict |
| **Type** | `type:feature`, `type:bug`, `type:spike`, `type:docs`, `type:chore`, `type:epic` | Kind of work |
| **Priority** | `priority:p0`, `priority:p1`, `priority:p2` | Urgency |
| **Release** | `release:v0.4.0` … `release:backlog` | Target milestone |
| **Signal** | `bug`, `feedback` | High-signal flags |

### Status lifecycle

| Label | Meaning | Set by |
|-------|---------|--------|
| `status:triage` | In the `squad` inbox, awaiting routing | Automatic when `squad` is applied |
| `status:ready` | Triaged + assigned, ready to start | Ralph / `squad-triage.yml` on assignment |
| `status:in-progress` | A squad member (or PR) is actively working it | Owning squad / on PR open |
| `status:needs-review` | Work is up for review — **human gate** | Owning squad when a PR is ready |
| `status:blocked` | Cannot proceed (dependency/decision) | Anyone; document why in a comment |

To re-sync labels after a roster change: push `.squad/team.md`, or run the
**Sync Squad Labels** workflow via `workflow_dispatch`.

---

## 4. Human approval gates (mandatory)

These gates are **on by default** and must stay that way. Nothing below can be flipped by a
workflow or by Ralph — each requires a deliberate human action.

1. **Execution is opt-in.** `squad watch` defaults to triage/categorize only. Spawning agents
   to write code requires a human to pass `--execute` locally (§5). The repo's
   `.squad/config.json` pins `watch.execute: false` and disables every watch capability
   (`self-pull`, `board`, `fleet-dispatch`, `monitor-teams`, `monitor-email`, `two-pass`,
   `wave-dispatch`, `retro`, `decision-hygiene`, `cleanup`, `notes-promote`).
2. **`@copilot` autonomy is off.** `@copilot` is intentionally **not** on the roster and the
   `<!-- copilot-auto-assign: true -->` gate is **absent** from `.squad/team.md`. The coding-agent
   assignment steps also require the `COPILOT_ASSIGN_TOKEN` secret, which is not configured. All
   three conditions must be true for autonomous assignment — so it cannot happen accidentally.
3. **`decision-hygiene` (auto-merge inbox) is off.** It is disabled in config and never passed
   on the command line.
4. **Merges are human.** No workflow in `.github/workflows/` merges a PR. Every PR passes CI and
   human review first; the `status:needs-review` label marks that gate.

---

## 5. Opting into execute mode (humans only)

> ⚠️ **This turns on autonomous code execution.** Run it only locally, deliberately, and while
> watching it. Do **not** add these flags to any workflow, cron job, or CI step.

`squad watch` is a **local** command — it is not wired into any GitHub Action. Prerequisites:
`gh auth login` (Issues/PRs) and `copilot --version` reachable. Validate with `squad doctor`.

**Triage only (safe — the default):**

```bash
squad watch
```

**Enable execute mode for a single local session:**

```bash
# Human-gated: spawns Copilot agents to work issues. Interactive, local, supervised.
squad watch --execute --interval 10 --max-concurrent 1
```

Useful modifiers (all opt-in, all off by default):

- `--no-decision-hygiene` — belt-and-suspenders: keep the auto-merge inbox off (it already is).
- `--dispatch-mode task` — 1:1 issue→agent (default). `fleet`/`hybrid` batch modes stay off unless asked.
- `--notify-level important` — matches the repo default in `.squad/config.json`.
- `--log-file .squad/watch.log` — tee output for auditability.

Even in execute mode, **Ralph does not merge**. It opens work for human review; you merge.

### Enabling `@copilot` autonomy (separate, also human-gated)

Only if you explicitly want the GitHub coding agent to auto-pick up `squad:copilot` issues, a
human must do **all** of the following — otherwise the paths stay inert:

1. Add `@copilot` to the `## Members` table in `.squad/team.md` (role includes `🤖 Coding Agent`).
2. Add the literal marker `<!-- copilot-auto-assign: true -->` to `.squad/team.md`.
3. Configure the `COPILOT_ASSIGN_TOKEN` repository secret with a PAT that can assign the coding agent.

Leaving any one of these out keeps `@copilot` off. This repo ships with all three **absent**.

---

## 6. Configuration & diagnostics

`.squad/config.json` holds the watch posture (read by `squad-cli`'s `watch/config.js`):

```jsonc
{
  "version": 1,
  "watch": {
    "execute": false,        // no code execution
    "interval": 10,
    "maxConcurrent": 1,
    "timeout": 30,
    "notifyLevel": "important",
    "stateBackend": "local", // local | orphan | two-layer | external
    "self-pull": false, "board": false, "fleet-dispatch": false,
    "monitor-teams": false, "monitor-email": false, "two-pass": false,
    "wave-dispatch": false, "retro": false, "decision-hygiene": false,
    "cleanup": false, "notes-promote": false
  }
}
```

Priority is **CLI flag > `.squad/config.json` "watch" > built-in defaults**, so a human on the
command line is always in control, and the checked-in config can only make things *safer*.

Run the health check any time:

```bash
squad doctor
```

It validates `.squad/`, `config.json`, the roster header, routing, the casting registry, Node,
and Copilot CLI availability.

# Composer AI — expanded feature set

Cadence's composer ships two layers of in-browser AI:

- **AI Assistant** (existing) — the conversational helper in `composer/hooks/useAssistant.ts`
  and `composer/components/AssistantPanel.tsx`. Untouched by this feature set.
- **AI Studio** (this document) — four expanded generation/assist tools that plug into
  the composer through its **public controller API** only.

Everything here runs **client-side, synchronously, and deterministically**. There is
no model download, no network call, and no new runtime dependency. The in-browser AI
stack stays exactly where it is: `@tensorflow/tfjs` and `@tensorflow/tfjs-backend-webgl`
remain pinned at **2.8.6** — AI Studio does not use, upgrade, or conflict with them, and
no model binaries are committed to the repo. If a future feature needs a model asset it
should be fetched at runtime and documented here rather than vendored.

## Features

| Feature | Id | Contract action | Budget | What it does |
| --- | --- | --- | --- | --- |
| Text to motif | `text-to-motif` | `text-to-motif` | Any | Turns a short text prompt into a monophonic motif and inserts it after the selected track's existing notes. |
| Groove / humanize | `groove` | `groove-humanize` | Any | Applies swing plus seeded timing/velocity jitter so a stiff, grid-aligned phrase feels played. |
| Style transfer | `style-transfer` | `style-transfer` | Unlimited | Re-times and re-articulates the selected track to match a named style (lo-fi, jazz swing, cinematic, EDM). Note count and pitches are preserved. |
| Auto-master | `auto-master` | `auto-master` | Unlimited | Analyzes the whole project's mix balance and returns a contract-typed `MasteringSuggestion` (master/limiter/per-track gain directive for the mixer overlay) plus prioritized, human-readable advisories. |

The **Budget** column is enforced through the composer's published AI contract seam
(`composer/contract/ai.ts`) — see [Entitlement gating](#entitlement-gating).

All four are **pure functions** in `composer/ai/expanded/`, unit-tested in isolation and
independent of React, the store, and the audio engine:

```
composer/ai/expanded/
  rng.ts            # FNV-1a hash + mulberry32 seeded PRNG (reproducible randomness)
  types.ts          # shared types & constants (scales, styles, presets, ranges)
  capabilities.ts   # contract AiEntitlementView + budget-based feature gating
  prompt.ts         # prompt → MotifParams (key/scale/density/register/length)
  textToMotif.ts    # MotifParams → notes (seeded random walk)
  styleTransfer.ts  # notes + style → restyled notes (count/pitch preserving)
  groove.ts         # notes + groove params → swung/humanized notes
  mastering.ts      # project → mix metrics → advisories + contract MasteringSuggestion
  index.ts          # barrel
```

## How it integrates — public API only

AI Studio never reaches into the reducer, store, or engine. Like the assistant, the
orchestration hook `composer/hooks/useAiStudio.ts` talks solely to the composer's public
[`ComposerController`](../apps/web/src/composer/hooks/useComposer.ts) surface:

- `controller.project` — read the current tracks/notes.
- `controller.selectedTrackId` — the track actions target.
- `controller.insertNotes(trackId, notes)` — text-to-motif inserts here.
- `controller.updateNote(trackId, noteId, changes)` — style & groove edit existing notes
  in place (one call per note, preserving count and order).
- `controller.notify(message)` — surface a status message to the user.

Because every write goes through `insertNotes` / `updateNote`, AI output is sanitized by
the same reducer as manual edits. This keeps the feature set fully decoupled from the
composer core, so it adds **zero edits** to the hot files (`useComposer.ts`, the
model/store, `App.tsx`) and does not change the public state shape.

### Wiring

`Composer.tsx` accepts an optional `aiStudioOptions` prop, resolves entitlements, and
renders the panel in the sidebar after the assistant:

```tsx
const resolvedEntitlements = useAiStudioEntitlements()
const aiStudio = useAiStudio(controller, {
  entitlements: aiStudioOptions?.entitlements ?? resolvedEntitlements,
})
// ...
<AiStudioPanel studio={aiStudio} />
```

## Entitlement gating

Gating is **contract-driven**. `capabilities.ts` implements the composer's published
[`AiEntitlementView`](../apps/web/src/composer/contract/ai.ts) seam and reads the single
server-authoritative budget field on
[`Entitlements`](../apps/web/src/billing/entitlementsClient.ts) —
`aiGenerationsPerDay` — rather than introducing a parallel tier model, exactly as the
contract mandates. The server catalog
([`EntitlementOptions`](../src/Cadence.Data/Entitlements/EntitlementOptions.cs)) ships a
generous free budget and an unlimited paid budget, so the budget alone distinguishes the
tiers:

- **Any budget** (free `50/day`, or unlimited) unlocks the idea-starters `text-to-motif`
  and `groove-humanize`.
- **Unlimited budget** (`aiGenerationsPerDay < 0`) additionally unlocks the heavier
  "producer" tools `style-transfer` and `auto-master`.
- **A spent budget** (`0`) locks every AI Studio feature.

`canUseFeature(feature, entitlements)` maps each UI feature onto its
`ExtendedAssistantAction` and asks `aiEntitlementView.canUse(action, entitlements)`, so
the panel and the orchestration hook share one source of truth — there is no parallel
tier/capability model. `isUnlimited(entitlements)` distinguishes the paid tier by reading
`remainingGenerations(entitlements, usedToday)` (an unlimited budget reports `Infinity`),
which also exposes the per-day counter.

Gating is **defensive**: a `null` entitlement (anonymous or unresolved) or a malformed
payload with no numeric budget falls back to the free budget rather than throwing during
render or locking everyone out. `useAiStudioEntitlements.ts` reads auth defensively via
`useContext(AuthContext)` (which defaults to `null`) rather than the throwing `useAuth()`
hook, and only fetches entitlements when a user is authenticated. That is what lets the
panel render in any context — including tests and anonymous sessions — without requiring
an `AuthProvider`, and therefore without touching `App.tsx`.

Producer features stay **visible but locked** without an unlimited budget: their controls
are disabled with an upgrade note, and the orchestration hook additionally guards each
action so a locked feature announces an upgrade prompt instead of running.

> **Auto-master and the mixer overlay.** The contract notes that `auto-master` targets the
> mixer overlay (`contract/mixing.ts`), not raw audio. AI Studio's analyzer is fully
> symbolic — it derives metrics from the project's notes with no audio processing — so it
> already honors that boundary. `analyzeMastering` **emits a contract-typed
> `MasteringSuggestion`** (`report.suggestion`: `masterGainDb`, `limiterThresholdDb`,
> per-track `perTrackGainDb`, and a plain-language `rationale`) whose fields map directly
> onto the `contract/mixing.ts` master-bus and per-track gain overlay. The panel renders
> that directive alongside the human-readable `advisories`. The suggestion is **advisory**:
> AI Studio produces and displays it but never mutates the mixer itself — applying it to the
> master bus is the mixer overlay's job, keeping this feature set free of composer-core
> edits.

## Accessibility

`AiStudioPanel.tsx` mirrors the assistant panel's proven-clean structure so it passes the
full-page axe scans in the Playwright a11y suite: a labelled `<section>` region, a
`<fieldset>`/`<legend>` feature `radiogroup`, a `<label>` around every input and select,
`type="button"` on every button, and a `role="status" aria-live="polite"` region for
feedback.

## Determinism & testing

Randomness is always seeded (`rng.ts`), so identical inputs produce identical output —
essential for reliable unit tests and reproducible results for users. Each module has a
focused unit test, the orchestration hook has a `renderHook` test covering the
entitlement guard and empty-track branches, and the panel has component tests covering
free/pro gating across all four features.

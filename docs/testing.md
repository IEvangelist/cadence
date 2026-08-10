# Testing & automation harness

Cadence is built **test-first**. Every behavior change lands with a test that
fails before the change and passes after it. This document describes the TDD
loop and how to run each suite locally and in CI.

All versions are pinned deterministically (see
[`versioning-policy.md`](./versioning-policy.md)): npm exact + `npm ci`, .NET via
Central Package Management + committed `packages.lock.json`, and every GitHub
Action pinned to a full commit SHA.

## The TDD loop

```
1. RED     Write a test that captures the desired behavior. Run it; watch it fail
           for the right reason (asserting real behavior, not a typo).
2. GREEN   Write the minimum code to make the test pass. Run it; watch it pass.
3. REFACTOR Clean up with the test as a safety net. Keep it green.
```

Keep tests **meaningful, not tautological**: assert observable behavior
(rendered output, HTTP status/shape, coverage of real code paths), never
`expect(true).toBe(true)`.

## Suites at a glance

| Suite | Tech | Where | CI job |
|---|---|---|---|
| Web unit + coverage gate | Vitest + v8 | `apps/web/src/**/*.test.tsx` | `web` |
| Web e2e smoke | Playwright | `apps/web/e2e/smoke.spec.ts` | `web-e2e` |
| Web auth e2e | Playwright | `apps/web/e2e/auth.spec.ts` | `web-e2e` |
| Web accessibility | Playwright + axe-core | `apps/web/e2e/a11y.spec.ts`, `auth.spec.ts`, `pricing.spec.ts` | `web-e2e` |
| .NET unit | xUnit | `tests/Cadence.Api.Tests` | `dotnet` |
| .NET coverage gate | coverlet.msbuild | `tests/Cadence.Api.Tests` | `dotnet-coverage` |
| .NET integration | Aspire.Hosting.Testing | `tests/Cadence.Api.IntegrationTests` | `dotnet-integration` |
| Site accessibility | Playwright + axe-core | `site/tests/a11y.spec.ts` | `site` |
| Site responsive + links | Playwright | `site/tests/responsive.spec.ts`, `links.spec.ts` | `site` |
| SAST | CodeQL (js-ts, csharp) | — | `codeql-web`, `codeql-dotnet` |
| Dependency review | dependency-review-action | — | `dependency-review` |
| Secret scan | gitleaks | — | `secret-scan` |
| Supply-chain audit | npm audit + NuGetAudit | — | `npm-audit`, `dotnet*` |

CI (`.github/workflows/ci.yml`) uses a `detect` job to gate the stack-specific
jobs, so the pipeline stays green as the monorepo fills in. Repo-wide gates
(`secret-scan`, `dependency-review`) run independently of `detect`.

## Web

Run from the repo root (npm workspaces) or from `apps/web`.

```bash
npm ci                     # install exact, lockfile-pinned deps

# Unit tests
npm test                   # vitest run (fast feedback)
npm run test:watch --workspace @cadence/web   # red/green loop while editing

# Coverage gate (fails below 80% lines/functions/branches/statements)
npm run test:coverage

# Lint / typecheck / build
npm run lint
npm run typecheck
npm run build
```

### End-to-end + accessibility (Playwright)

Playwright serves a **production build** via `vite preview`
(`apps/web/playwright.config.ts`), so the smoke suite proves the shipped bundle
compiles and renders. The a11y suite runs axe-core against WCAG 2.1 A/AA in a
real browser.

```bash
# One-time: download the Chromium browser (add --with-deps in CI/Linux)
npx playwright install chromium          # from apps/web
# or: npm run e2e:install --workspace @cadence/web

npm run e2e                              # build SPA + run smoke + a11y
```

The coverage thresholds live in `apps/web/vite.config.ts` (`test.coverage`).
Vitest v8 includes every file matched by `coverage.include` (`src/**`) in the
denominator, so new untested source drags coverage down and fails the gate.

### Format interop (import / export / share)

Client-side format interop lives in `apps/web/src/composer/formats` and is
documented in [`share.md`](share.md). Every format has a **round-trip** unit test
(`model → format → model` preserves pitch/start/duration + tempo within tolerance):

- `projectFile.test.ts` — portable `.cadence.json` envelope round-trip.
- `musicxml.test.ts` — MusicXML `score-partwise` subset (velocity is not carried by
  notation; restored to the model default on import).
- `audioExport.test.ts` — pure `encodeWav` + a mocked offline renderer, so the WAV
  path runs under jsdom and asserts a non-empty file of the expected duration.
- `share.test.ts` — URL-fragment snapshot encode/decode + file fallback.

Malformed input for each importer throws a typed error and surfaces a friendly UI
status (mirrors the existing `MidiImportError` pattern). `audio/offlineRender.ts`
binds to `Tone.Offline` (Web Audio) and is coverage-excluded — it is exercised in the
browser/e2e, not jsdom. The `composer.spec.ts` e2e adds export → re-import and
share-link round-trips. **No new runtime dependencies were added**, so the npm-audit
surface and `package-lock.json` are unchanged.

### Billing & entitlements (web)

Freemium UI and the free-tier watermark (issue #8) are covered by:

- `composer/formats/audioWatermark.test.ts` — the pure watermark function:
  asserts added energy at the watermark spec for **free** exports and
  **byte-identical passthrough** (same references) for **paid**.
- `billing/entitlementsClient.test.ts` — the typed billing client
  (`getEntitlements`, `startCheckout`, `openPortal`) over an injected `fetch`.
- `billing/PricingPage.test.tsx` + `billing/useEntitlements.test.ts` —
  entitlement-driven UI state and the checkout CTA calling the API (mocked).
- `e2e/pricing.spec.ts` — Playwright + axe on the pricing page with **mocked**
  billing calls (no live Stripe). See [`billing-setup.md`](billing-setup.md).

### Plugin SDK & extensibility

The Plugin SDK (`apps/web/src/composer/plugins`) generalizes the composer's
built-in registries (instruments, formats, AI providers, effects) behind one
typed, in-process host. It is **test-first and adds zero runtime dependencies** —
manifest validation is hand-rolled in the `persistence.ts` style, so the audit
surface and `package-lock.json` are unchanged. See [`plugins.md`](plugins.md) for
the authoring guide and the reference plugin.

- `manifest.test.ts` — `validateManifest` accepts well-formed manifests and throws
  a typed `PluginManifestError` for each malformed shape (mirrors `MidiImportError`
  / `ProjectFileError`).
- `host.test.ts` — register / activate / dispose lifecycle, duplicate-id rejection,
  `{ override: true }` last-wins, and active-only contribution aggregation.
- `preferences.test.ts` — versioned localStorage round-trip + migration/coercion of
  enabled plugins, keybindings, and panel visibility.
- `builtins/*.test.ts` + `resolveAssistant.test.ts` — the dogfooded built-ins
  (instruments, formats, AI providers, one effect) resolve **through** the host.
- `engineEffect.test.ts` — an enabled effect contribution is inserted into the
  engine's master chain; disabled effects leave the signal path untouched.
- `keybindings.test.ts`, `usePlugins.test.tsx`, `PluginsPanel.test.tsx` — the React
  glue: prefs-driven enable/disable, global shortcut dispatch, and the accessible
  Extensions UI.
- `examples/helloPlugin.test.tsx` — the reference plugin end to end (instrument +
  text exporter + command + panel).

`plugins.spec.ts` (Playwright) enables the reference plugin from the production
build, runs its contributed command, asserts persistence across reload, and scans
the new UI with axe. The AI worker code-split is preserved: the SDK and its
built-ins import only `tone` (already in the main chunk), never `@magenta/music`
or `@tensorflow/tfjs`, so those stay in the worker-loaded chunks.

### Stem separation (web)

The standalone stems UI (`apps/web/src/stems`, issue #10 Phase 1 — **not** the
composer) is covered by:

- `stems/stemsClient.test.ts` — the typed client over an injected `fetch`:
  raw-body upload, the `402/413/415/401` → `StemsError` mapping, job read/list,
  and download-URL resolution against the base URL.
- `stems/StemsPage.test.tsx` — entitlement-gated UI state (anonymous sign-in
  prompt, free-tier upgrade CTA, entitled uploader), the upload flow, **polling an
  in-flight job to completion**, completed-stem preview/download rendering, and
  failed-job + load-error alerts.
- `e2e/stems.spec.ts` — Playwright + axe on both the **gated** free-tier surface
  and the **entitled** upload → downloadable-stems surface, with all `/api/**`
  calls mocked (no worker/model in e2e).

No new runtime dependencies were added (the UI uses `fetch` and the native
`<audio>` element), so the npm-audit surface and `package-lock.json` are unchanged.

## .NET

```bash
dotnet restore
dotnet build -c Release

# Fast unit tests (skips container-booting integration tests)
dotnet test -c Release --filter "Category!=Integration"

# Coverage gate (line + method >= 80%, enforced by coverlet.msbuild)
dotnet clean tests/Cadence.Api.Tests -c Release      # coverlet needs a fresh build
dotnet test tests/Cadence.Api.Tests -c Release /p:CollectCoverage=true
```

The coverage gate is configured in `tests/Cadence.Api.Tests.csproj`
(`CollectCoverage=true`). .NET minimal-API endpoints are emitted by a source
generator as `[GeneratedCode]`; those are excluded via `ExcludeByAttribute` so
the number reflects hand-written product code. Branch coverage on infrastructure
conditionals is intentionally not gated.

> coverlet.msbuild only instruments a **fresh** build — if the build is
> up-to-date it produces no coverage file. `dotnet clean` first (CI always runs
> on clean runners).

### Integration tests (Aspire)

`tests/Cadence.Api.IntegrationTests` uses `Aspire.Hosting.Testing` to boot the
real AppHost graph (API + Postgres + Redis + Azurite blob) and asserts the API's
contract surface — `/health`, `/alive`, `/api/info`, and the OpenAPI document at
`/openapi/v1.json`. It also drives a **register → sign in → create project**
round-trip that proves EF Core migrations apply and a project persists in
Postgres. A **billing** integration test drives a signed Stripe webhook
(`checkout.session.completed` → `customer.subscription.updated`) end-to-end and
asserts the user's entitlements **flip Free → Pro** against real Postgres, then
replays the event to prove **idempotency**. It **requires a container runtime
(Docker)** and is tagged `[Trait("Category", "Integration")]`.

```bash
# Docker must be running
dotnet test tests/Cadence.Api.IntegrationTests -c Release --filter "Category=Integration"
```

### Auth & persistence tests

Identity, profile, and Projects behavior is covered by the `dotnet` unit suite
using `WebApplicationFactory` over a **SQLite in-memory** database (fast, no
container), including:

- local register/login/logout and `GET /api/auth/me`,
- passwordless magic-link request → verify (single-use),
- external OAuth via a **mock provider handler** registered only in the `Testing`
  environment (no live OAuth secrets), and
- Projects CRUD **plus an authorization test that user A cannot read or modify
  user B's projects** (non-owner access returns `404`), and
- **billing & entitlements** — entitlement mapping per subscription status, gate
  enforcement (free over-limit → `402`, paid-only → `402`, paid allowed), Stripe
  webhook signature verification (valid/invalid) and idempotency (same event id
  twice = one state change), and the tier claim updating on subscription change.
  Tests construct Stripe test signatures/events locally — **no live API call**.

The EF migrations, design-time factory, and the startup migrator are excluded
from the coverage denominator (`[*]Cadence.Data.Migrations.*` + `[ExcludeFromCodeCoverage]`)
because they only execute under Postgres and are exercised by the integration
suite, not the SQLite unit suite.

### Stem separation (.NET + Aspire integration)

Stem separation (issue #10 Phase 1) is test-first across the pipeline. The
`dotnet` unit suite (`tests/Cadence.Api.Tests`) covers the pure `Cadence.Data`
pieces and the `/api/stems` endpoints over `WebApplicationFactory` + SQLite:

- **State machine** — every legal `Queued → Processing → Completed | Failed`
  transition and rejection of illegal ones.
- **Stem catalog + labeling** — the fixed 7-label catalog (`bass`, `drums`,
  `vocals`, `guitar`, `keys`, `synth`, `other`) and slug ordering.
- **WAV codec + band-split** — PCM16 read/write round-trip and the deterministic
  `BandSplitStemSeparator` (the hermetic default engine).
- **Job processor** — happy path, failure capture (`Failed` + error message), and
  claim semantics.
- **Endpoints** — free-tier **`402`** (tier read from the DB, not the cookie),
  Pro **`202`**, `415`/`413` (size + duration)/`400` validation, list/get/download,
  **IDOR** (cross-owner read → `404`), and anonymous → `401`.

The Aspire integration suite (`tests/Cadence.Api.IntegrationTests`, Docker) boots
the **real** AppHost graph including the `separation` worker and drives the full
lifecycle against real Postgres + Azurite: register → promote to Pro via a signed
Stripe webhook → upload a WAV mix → poll the job to `Completed` → assert the
7-stem catalog → download each stem from Blob. It uses the band-split engine (no
`Stems:ModelUri`), so it needs **no model download**; the real model inference is
isolated behind the `IStemSeparator` seam. `Cadence.SeparationWorker` and the
Azure/ONNX I/O classes are `[ExcludeFromCodeCoverage]` (network/GPU glue) and the
worker is not referenced by the coverage-gated unit project.

`Cadence.SeparationWorker` uses a plain `Microsoft.NET.Sdk` with a
`FrameworkReference` to `Microsoft.AspNetCore.App` (for `IHost`/`BackgroundService`)
and a single `net10.0` target — so its committed `packages.lock.json` is
RID-agnostic. As with `Cadence.AppHost`, adding the `Azure.Storage.Blobs` central
pin can surface as a `win-x64`/`linux-x64` flip in the **non-locked** AppHost and
IntegrationTests locks on a full-solution restore; those two are reverted to
`origin/main` (they set `RestoreLockedMode=false`), and only real dependency
additions are committed to the four locked-mode locks (`Cadence.Data`,
`Cadence.Api`, `Cadence.Api.Tests`, `Cadence.SeparationWorker`). See
[`stems.md`](stems.md).

## Security & supply-chain gates

| Gate | What it does | Fails the build when |
|---|---|---|
| CodeQL | Static analysis for js-ts and csharp. SARIF is always produced as an artifact; upload to code scanning is gated on repo visibility (needs GitHub Advanced Security). | A query finds a high-confidence issue (once code scanning is enabled). |
| dependency-review | Reviews dependency changes on PRs. Gated on `pull_request` + public visibility (needs GHAS). | A PR adds a dependency at/above `high` severity. |
| gitleaks | Scans the working tree for committed secrets. | Any secret is detected. |
| npm audit | Full report is informational; the gate runs at `--audit-level=critical`. | A `critical` npm advisory is present. |
| NuGetAudit | `Directory.Build.props` sets `NuGetAudit`/`NuGetAuditMode=all`; `NU1903`/`NU1904` are promoted to errors. | A high/critical NuGet advisory (direct or transitive) is present. |

Run the audits locally:

```bash
npm audit                              # full advisory report
npm audit --audit-level=critical       # the CI gate
dotnet restore                         # NuGetAudit runs on every restore
```

The gitleaks ruleset is the built-in default (`[extend] useDefault = true` in
`.gitleaks.toml`); the only allowlisted paths are the `secret-handling` skill
docs, which intentionally list example secret *patterns* (e.g. the literal
string `-----BEGIN PRIVATE KEY-----`) rather than real secrets.

### Known, tracked advisories

`npm audit` reports a set of pre-existing/tolerated **high** advisories. None is
`critical`, so the `--audit-level=critical` gate stays green; all are surfaced by
the informational report and tracked for a future compatible bump.

- **`nanoid < 3.3.17`** ([GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8))
  pulled in transitively by `vite -> postcss`. `postcss` pins `nanoid ^3.3.16`
  and no patched `3.3.x` release exists, so there is no compatible fix.
- **`@magenta/music` audio-resample chain** — `static-eval`, `static-module`,
  `cwise`, `ndarray-fft`, `ndarray-resample`
  ([GHSA-x9hc-rw35-f44h](https://github.com/advisories/GHSA-x9hc-rw35-f44h),
  [GHSA-5mjw-6jrh-hvfq](https://github.com/advisories/GHSA-5mjw-6jrh-hvfq)).
  `@magenta/music@1.23.1` (the latest release, and the one the in-browser AI
  assistant depends on) drags these in through its **audio resampling** helpers.
  The only "fix" `npm audit fix --force` offers is a downgrade to
  `@magenta/music@1.1.13`, a breaking change — declined. Crucially, these
  packages are reachable **only** from Magenta's audio path (`core/audio_utils`,
  used by `Player`/`SoundFont`/DDSP); the assistant imports just
  `@magenta/music/esm/music_rnn` (MusicRNN), which never loads that chain, so the
  vulnerable code is not on any runtime path we ship. The `minimist`/`protobufjs`
  criticals that Magenta would otherwise introduce are pinned out via root
  `package.json` `overrides` (`minimist 1.2.8`, `protobufjs 7.6.5`).

The isolated landing + docs site (`site/`, own lockfile) surfaces the **same**
`nanoid` advisory through `astro -> vite -> postcss -> nanoid` (5 high, 0
critical). The only offered fix is a breaking Astro downgrade, so it is tracked
the same way; the `site` job's `--audit-level=critical` gate stays green.

## CI notes

- **All GitHub Actions are pinned to full commit SHAs** with a version comment.
  Resolve a tag with `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`.
- `ContinuousIntegrationBuild=true` on the `dotnet` job enables **locked-mode
  restore** — CI fails if a committed `packages.lock.json` is stale. Regenerate
  locks with `dotnet restore` and commit them when dependencies change.
  `Cadence.AppHost` and `Cadence.Api.IntegrationTests` opt out
  (`RestoreLockedMode=false`) because the Aspire SDK injects host-RID-specific
  packages a single committed lock can't satisfy cross-OS.
- CodeQL for C# uses `build-mode: manual` (autobuild is unreliable on .NET 10)
  and compiles `Cadence.Api` explicitly so the extractor observes the assemblies.

## Live collaboration (CRDT + presence + authz)

Effort #9's collaboration feature is tested at every layer, security-sensitive
paths first. See [`collaboration.md`](collaboration.md) for the design.

**Web unit (Vitest)** — `apps/web/src/composer/model/collab/*.test.ts(x)`,
`components/PresenceBar.test.tsx`, `ShareProjectButton.test.tsx`:

- **Convergence**: two independent `Y.Doc`s apply interleaved/conflicting
  edits (insert, move, delete notes and tracks) and read back byte-for-byte
  identical projects — the core CRDT guarantee, asserted directly.
- **Sanitization**: a crafted remote update carrying out-of-range/`NaN` values
  is folded in and the reducer only ever sees values the `migrateProject` /
  `coerceNote` seam permits (a hostile peer cannot inject illegal data).
- **Offline replay**: updates buffered while "disconnected" exchange on
  reconnect and both docs converge with no lost edits.
- **Deferred single-seed**: only the first client to see an empty doc seeds it;
  joiners adopt without duplicating tracks.
- **Presence**: awareness add/remove reflects join/leave; the roster renders
  accessible avatars with WCAG-contrast ink for both hex and `hsl` colors.

**.NET authz (xUnit)** — `tests/Cadence.Api.Tests` (collaboration relay + share
CRUD). These are the fail-closed access-control assertions:

- A **viewer** connection's document-write frames are **rejected server-side**
  (dropped in `RelayLoopAsync` via `YProtocol.IsWriteMessage`) and never reach
  peers; an **editor**/owner write is relayed.
- Malformed/undecodable frames are treated as writes and dropped for viewers.
- Unauthenticated upgrades are refused; a share token for a different project
  does not grant access (`ResolveRoleAsync` returns no role → connection denied).
- Share CRUD is owner-only. Backend line + method coverage stays ≥ 80%.

**E2E (Playwright + axe)** — `apps/web/e2e/collaboration.spec.ts`, backed by a
throwaway Node relay fixture (`apps/web/e2e/collab-server.mjs`; a second
`webServer` in `playwright.config.ts` on `VITE_COLLAB_URL`):

- Two browser contexts edit the same project concurrently; both converge and
  each sees the other's live presence.
- A **viewer** link is read-only end-to-end: the viewer's attempted edit leaves
  the editor's note count unchanged (proving the server gate, not just UI
  gating).
- The collaborative composer (presence bar + remote cursors) is **axe-clean**.

Note-adds in the e2e specs use deterministic keyboard input (focus the note
grid, arrow to an empty pitch row, `Enter`) rather than pixel clicks, and assert
relative counts so they are robust to the seeded demo project.

## Local run (`aspire run`) — the `web` resource

Effort #79 adds the `apps/web` SPA to the AppHost as an auto-start Aspire NodeJS
resource so `dotnet run --project src/Cadence.AppHost` serves the UI. Two
properties keep this from disturbing the test/CI matrix:

- **It never enters the published manifest.** The resource is guarded by
  `builder.ExecutionContext.IsRunMode`, so `aspire publish` / manifest generation
  emits the unchanged baseline (postgres, redis, storage, api, separation) with
  **no `web`**. Verify with:

  ```bash
  dotnet run --project src/Cadence.AppHost -- --publisher manifest --output-path aspire-manifest.json
  # aspire-manifest.json contains no "web" resource
  ```

- **It stays out of the Aspire integration harness.** `Aspire.Hosting.Testing`
  boots the AppHost in **run mode**, so the `IsRunMode` guard alone would add
  `web` there too. The resource is therefore *also* gated on the repo-root
  `node_modules` existing — which the Docker-only `dotnet-integration` job never
  installs — so that job boots exactly the API + backing services it asserts on,
  never Vite. Locally, run `npm ci` at the repo root first to see the SPA under
  `aspire run`.

The dev proxy added to `apps/web/vite.config.ts` is a **dev-server-only** option
(`server.proxy`); Vitest and the production build ignore it, so web unit coverage
and the bundle are unchanged.

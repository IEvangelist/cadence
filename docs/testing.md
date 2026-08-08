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
| Web accessibility | Playwright + axe-core | `apps/web/e2e/a11y.spec.ts`, `auth.spec.ts` | `web-e2e` |
| .NET unit | xUnit | `tests/Cadence.Api.Tests` | `dotnet` |
| .NET coverage gate | coverlet.msbuild | `tests/Cadence.Api.Tests` | `dotnet-coverage` |
| .NET integration | Aspire.Hosting.Testing | `tests/Cadence.Api.IntegrationTests` | `dotnet-integration` |
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
Postgres. It **requires a container runtime (Docker)** and is tagged
`[Trait("Category", "Integration")]`.

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
  user B's projects** (non-owner access returns `404`).

The EF migrations, design-time factory, and the startup migrator are excluded
from the coverage denominator (`[*]Cadence.Data.Migrations.*` + `[ExcludeFromCodeCoverage]`)
because they only execute under Postgres and are exercised by the integration
suite, not the SQLite unit suite.

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

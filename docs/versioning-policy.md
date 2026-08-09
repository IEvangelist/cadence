# Versioning & supply-chain policy

**Principle:** always adopt the *latest* stable versions, but **pin them
deterministically** so builds are reproducible and the supply chain is auditable.
Dependabot (see `.github/dependabot.yml`) proposes weekly bumps to keep pins current.

## GitHub Actions — pin to full commit SHA

Never reference actions by mutable tags (`@v4`) or branches. Pin to the **full
40-char commit SHA** of the latest release, with a trailing comment naming the
version:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

Currently pinned (Phase 0):

| Action | Version | SHA |
|---|---|---|
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| actions/github-script | v9.0.0 | `3a2844b7e9c422d3c10d287c895573f7108da1b3` |
| actions/setup-dotnet | v6.0.0 | `a98b56852c35b8e3190ac28c8c2271da59106c68` |
| actions/upload-artifact | v7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| actions/configure-pages | v6.0.0 | `45bfe0192ca1faeb007ade9deae92b16b8254a0d` |
| actions/upload-pages-artifact | v5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
| actions/deploy-pages | v5.0.0 | `cd2ce8fcbc39b97be8ca5fce6e763baed58fa128` |
| actions/cache | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| github/codeql-action | v4.37.6 | `5595ccaf912efad79be6eef63a5619ff05969be3` |
| actions/dependency-review-action | v5.0.0 | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` |
| Azure/setup-azd | v2.4.0 | `0b7e3a35ab00f2eee7080c845eb39c3f0ebfa553` |
| dtolnay/rust-toolchain | v1 (stable) | `e97e2d8cc328f1b50210efc529dca0028893a2d9` |

> Non-action pinned tools: gitleaks `v8.30.1` (secret scan) is downloaded as a
> version-pinned release binary in `.github/workflows/ci.yml`.

> Resolve a tag → SHA with: `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`

## npm (apps/web, apps/desktop)

- Use the latest stable of each package; record **exact** versions.
- Commit `package-lock.json`; CI uses `npm ci` (integrity hashes enforce the pin).
- No `^`/`~` drift in production deps where avoidable.

### Exception: `@tensorflow/tfjs` pinned to 2.8.6 (not latest 4.x)

The in-browser AI assistant (`apps/web/src/composer/ai`) uses `@magenta/music`
`1.23.1` — the **latest** published Magenta — which constrains its tfjs peer to
`^2.7.0`. So `@tensorflow/tfjs@2.8.6` (+ `@tensorflow/tfjs-backend-webgl@2.8.6`)
is the **latest tfjs that is compatible with the latest Magenta**; adopting
tfjs 4.x would break Magenta's model loading. This is a deliberate, tracked
deviation from "always latest".

Magenta.js is effectively unmaintained, so this pin will not move on its own. The
typed `CompositionAssistant` provider seam (`apps/web/src/composer/ai/types.ts`)
exists precisely so we can migrate to a modern client-side model runtime, or add
a server-side premium provider, later — without touching the assistant UI. Until
then, `2.8.6` is intentional and Dependabot bumps of tfjs past the Magenta peer
range should be declined.

## .NET (src, tests)

- **Central Package Management**: versions live in `Directory.Packages.props`
  (`<PackageVersion>`), exact and pinned.
- Pin the SDK in `global.json`.
- Restore is lockfile-backed (`packages.lock.json`, `RestorePackagesWithLockFile`).

## Rust / Tauri (apps/desktop/src-tauri)

- Exact crate versions; commit `Cargo.lock`.
- Pin the toolchain via `rust-toolchain.toml`.

## Containers / deploy

- Reference base images by **digest** (`image@sha256:...`), not floating tags.
- `azd` / IaC pin provider and module versions.

## Automation

- Dependabot groups updates per ecosystem and rewrites SHA pins + version comments.
- CI must pass on the bumped versions before merge (human approval via Squad gates).

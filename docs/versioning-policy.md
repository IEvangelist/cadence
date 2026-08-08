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
| actions/cache | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| dtolnay/rust-toolchain | v1 (stable) | `e97e2d8cc328f1b50210efc529dca0028893a2d9` |

> Resolve a tag → SHA with: `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`

## npm (apps/web, apps/desktop)

- Use the latest stable of each package; record **exact** versions.
- Commit `package-lock.json`; CI uses `npm ci` (integrity hashes enforce the pin).
- No `^`/`~` drift in production deps where avoidable.

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

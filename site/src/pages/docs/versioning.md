---
layout: ../../layouts/DocsLayout.astro
title: Versioning policy
description: How Cadence pins GitHub Actions to commit SHAs and npm/.NET/Rust dependencies to exact versions for reproducible, auditable builds.
---

# Versioning & supply-chain policy

**Principle:** always adopt the *latest* stable versions, but **pin them
deterministically** so builds are reproducible and the supply chain is auditable.
Dependabot proposes weekly bumps to keep pins current. This page mirrors
[`docs/versioning-policy.md`](https://github.com/IEvangelist/cadence/blob/main/docs/versioning-policy.md).

## GitHub Actions — pin to full commit SHA

Never reference actions by mutable tags (`@v4`) or branches. Pin to the **full
40-char commit SHA** of the latest release, with a trailing comment naming the
version:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

Resolve a tag → SHA with:

```bash
gh api repos/<owner>/<repo>/commits/<tag> --jq .sha
```

### Actions used by the site & deploy workflows

The landing/docs and deploy surfaces added these pins:

| Action | Version | SHA |
|---|---|---|
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v7.0.0 | `820762786026740c76f36085b0efc47a31fe5020` |
| actions/setup-dotnet | v6.0.0 | `a98b56852c35b8e3190ac28c8c2271da59106c68` |
| actions/upload-artifact | v7.0.1 | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| actions/configure-pages | v6.0.0 | `45bfe0192ca1faeb007ade9deae92b16b8254a0d` |
| actions/upload-pages-artifact | v5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
| actions/deploy-pages | v5.0.0 | `cd2ce8fcbc39b97be8ca5fce6e763baed58fa128` |
| azure/login | v3.0.1 | `f5d393ae46f8fde4be8b75f32e3fc50e654ad0ca` |
| Azure/setup-azd | v2.4.0 | `0b7e3a35ab00f2eee7080c845eb39c3f0ebfa553` |

These join the repo's existing Phase 0 pins (github-script, cache, CodeQL,
dependency-review, rust-toolchain) — the full list lives in the repository's
versioning policy.

## npm

- Use the latest stable of each package; record **exact** versions (no `^`/`~`).
- Commit `package-lock.json`; CI uses `npm ci` (integrity hashes enforce the pin).

The landing/docs site under `site/` follows this rule with its **own** isolated
`package.json` + lockfile — it is **not** part of the root npm workspaces, so it
never churns `apps/web` or the root lockfile. Its dependencies are exact-pinned
(Astro and the Playwright/axe test tooling) and installed with `npm ci`.

## .NET

- **Central Package Management**: versions live in `Directory.Packages.props`,
  exact and pinned.
- Pin the SDK in `global.json`; restore is lockfile-backed
  (`packages.lock.json`).

## Rust / Tauri

- Exact crate versions; commit `Cargo.lock`. Pin the toolchain via
  `rust-toolchain.toml`.

## Containers / deploy

- Reference base images by **digest** (`image@sha256:...`), not floating tags.
- `azd` / IaC pin provider and module versions.

## Automation

Dependabot groups updates per ecosystem and rewrites SHA pins + version comments.
CI must pass on the bumped versions before a merge (human approval via Squad
gates).

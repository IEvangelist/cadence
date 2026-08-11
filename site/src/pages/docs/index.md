---
layout: ../../layouts/DocsLayout.astro
title: Documentation
description: Guides for building, running, deploying, and understanding Cadence — the AI-powered, cross-platform music creation studio.
---

# Cadence documentation

Cadence is an AI-powered, cross-platform music creation studio: a Tauri desktop
shell around a TypeScript SPA, backed by an Aspire service graph. These docs
cover how to run it locally, how the pieces fit together, and how to deploy your
own instance.

> These pages mirror the source-of-truth documents in the
> [`docs/`](https://github.com/IEvangelist/cadence/tree/main/docs) folder of the
> repository. When something here disagrees with the code, the repo wins — please
> [open an issue](https://github.com/IEvangelist/cadence/issues).

## Start here

- **[Getting started](getting-started/)** — prerequisites and the commands to run
  the backend, web UI, and desktop shell locally.
- **[Architecture](architecture/)** — the desktop shell, the SPA, and the Aspire
  service graph (API, Postgres, Redis, Blob).
- **[Features](features/)** — what Cadence does today, tier by tier.
- **[Plugin SDK](plugin-sdk/)** — author a composer plugin: instruments, effects,
  formats, AI providers, commands, and panels.
- **[API reference](api-reference/)** — reach the OpenAPI/Scalar docs and browse
  the REST endpoint groups.
- **[Self-hosting & deploy](self-hosting/)** — the `azd` flow that deploys the
  Aspire backend to Azure Container Apps.
- **[Authentication](auth/)** — the sign-in methods and how to configure OAuth.
- **[Versioning policy](versioning/)** — how dependencies and GitHub Actions are
  pinned.

## The short version

```bash
# 1. Run the backend (Aspire orchestrates Postgres, Redis, Azurite, and the API)
aspire run

# 2. Run the web UI
cd apps/web && npm install && npm run dev
```

Local password and passwordless **magic-link** sign-in work with **no secrets**
at all — external OAuth providers are opt-in. See
[Authentication](auth/) for the details.

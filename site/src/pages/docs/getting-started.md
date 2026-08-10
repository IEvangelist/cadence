---
layout: ../../layouts/DocsLayout.astro
title: Getting started
description: Prerequisites and commands to run the Cadence backend, web UI, and desktop shell on your own machine.
---

# Getting started

This guide gets Cadence running locally. The backend is orchestrated by
[.NET Aspire](https://learn.microsoft.com/dotnet/aspire/), so a single command
starts the API together with its Postgres, Redis, and Blob dependencies.

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| [.NET SDK](https://dotnet.microsoft.com/download) | 10.0+ | The API, AppHost, and data projects |
| [Node.js](https://nodejs.org/) | 22+ | The web SPA (`apps/web`) and desktop shell |
| [Docker](https://www.docker.com/) | latest | Aspire-managed Postgres, Redis, and the Azurite blob emulator |
| [Rust](https://www.rust-lang.org/tools/install) | stable | Optional — only for building the Tauri desktop app |

The exact SDK is pinned in `global.json`; Docker must be running before you start
the AppHost so Aspire can spin up the backing containers.

## 1. Clone the repository

```bash
git clone https://github.com/IEvangelist/cadence.git
cd cadence
```

## 2. Run the backend

The Aspire AppHost is the entry point. It builds the API and starts every
resource it models:

```bash
dotnet run --project src/Cadence.AppHost
```

This opens the **Aspire dashboard**, which lists each resource, its health, logs,
and the assigned URLs. The API applies its EF Core migrations against the
Aspire-wired Postgres database at startup, so there is no manual database step.

## 3. Run the web UI

In a second terminal:

```bash
cd apps/web
npm install
npm run dev
```

The SPA is offline-first: signed out, it stores projects in a versioned
`localStorage` store; on sign-in it syncs local-only projects up to the API and
switches to the remote store.

<figure>
  <img
    src="/cadence/screenshots/composer.webp"
    width="1600"
    height="639"
    alt="The Cadence web UI running locally: a project toolbar with import, export, and share actions above a transport bar and a two-track piano roll of violet note blocks."
    loading="lazy"
    decoding="async"
  />
  <figcaption>The Cadence web UI running from <code>npm run dev</code>.</figcaption>
</figure>

## 4. Run the desktop shell (optional)

The desktop app wraps the same SPA in a [Tauri](https://tauri.app/) (Rust) shell:

```bash
cd apps/desktop
npm install
npm run tauri dev
```

## 5. Sign in

Local email + password and passwordless **magic-link** sign-in work immediately,
with **no configuration and no secrets**. The default magic-link sender writes the
link to the logs, so you can complete a passwordless sign-in straight from the
Aspire dashboard's log stream. To enable GitHub/Google/Microsoft OAuth, follow
[Authentication](../auth/).

## Where to next

- Understand the moving parts in [Architecture](../architecture/).
- Deploy your own instance with [Self-hosting & deploy](../self-hosting/).

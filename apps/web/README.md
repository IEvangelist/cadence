# apps/web

`@cadence/web` — the Cadence web client: a [React](https://react.dev) 19 single-page app
built with [Vite](https://vite.dev) and [TypeScript](https://www.typescriptlang.org). It
hosts the entire composer experience (audio engine, piano roll, in-browser AI assistant,
import/export, billing, and stem separation) and is the same UI loaded by the
[Tauri desktop shell](../desktop/README.md).

It is one of the root npm workspaces; the committed `package-lock.json` lives at the
repository root.

## Run locally

**Prerequisites:** [Node.js LTS](https://nodejs.org) (>= 20).

```bash
npm ci        # install all workspaces once, from the repository root
```

Then, from `apps/web`:

```bash
npm run dev   # Vite dev server with hot-module reload on http://localhost:5173
```

To run the same UI inside the native desktop window instead, use the Tauri shell — see
[`../desktop/README.md`](../desktop/README.md).

## Talking to the API

By default the client calls the API on the **same origin** (ideal when the SPA is served
by, or reverse-proxied alongside, the API). To point it at a separate API — for example
the Aspire-hosted `api` service during local development — set `VITE_API_BASE_URL`:

```bash
VITE_API_BASE_URL="https://localhost:7001" npm run dev
```

Start the back end with the Aspire AppHost, which prints the API's dynamic URL in the
Aspire dashboard; see [`../../src/README.md`](../../src/README.md).

## Testing

- **`npm test`** — [Vitest](https://vitest.dev) unit + component tests (jsdom).
- **`npm run e2e`** — [Playwright](https://playwright.dev) end-to-end tests
  (run `npm run e2e:install` once to fetch the browser).
- **`npm run lint`** / **`npm run typecheck`** — ESLint and the TypeScript project build.

See [`../../docs/testing.md`](../../docs/testing.md) for the full harness and CI gates.

## Determinism

Exact-pinned dependencies with a committed root `package-lock.json`. TensorFlow.js is
held at **2.8.6** for Magenta compatibility — do not bump it.

## More

- [`../../docs/README.md`](../../docs/README.md) — the documentation index.
- [`../desktop/README.md`](../desktop/README.md) — the Tauri desktop shell.

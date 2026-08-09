# apps/desktop

Tauri (Rust) desktop shell that loads the Cadence web SPA (`apps/web`).
Cross-platform from day one.

## Requirements

- **Rust toolchain** via `rustup` (channel pinned in
  [`src-tauri/rust-toolchain.toml`](src-tauri/rust-toolchain.toml)).
- Node.js + the root npm workspaces (`npm ci` at the repo root).
- Platform WebView + build prerequisites — see the
  [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).
  Windows ships WebView2; Linux needs `libwebkit2gtk-4.1-dev` and friends
  (installed by the `desktop` CI job).

## Layout

- `src-tauri/` — the Rust crate (`cadence-desktop`), `tauri.conf.json`,
  `Cargo.toml`/`Cargo.lock` (committed for reproducible builds), icons, and
  capabilities.
- The shell serves the built SPA from `../web/dist` in production and proxies
  `http://localhost:5173` (Vite dev server) during development.

## Scripts

Run from `apps/desktop`:

- `npm run dev` — `tauri dev`; builds/serves the web dev server first
  (`beforeDevCommand`) then opens the desktop window.
- `npm run build` — `tauri build`; builds the web SPA first
  (`beforeBuildCommand`) then produces the desktop bundle.
- `npm run build:web` / `npm run dev:web` — build/serve the `@cadence/web`
  workspace directly.

## Determinism

- Exact crate versions pinned in `src-tauri/Cargo.toml`; `Cargo.lock` committed.
- Toolchain channel pinned via `src-tauri/rust-toolchain.toml`.

## Content Security Policy

Issue #52 hardened the desktop webview, which previously shipped with CSP disabled.

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: blob:;
font-src 'self' https://fonts.gstatic.com data:;
media-src 'self' blob: data:;
connect-src 'self' ipc: http://ipc.localhost https://storage.googleapis.com;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
frame-ancestors 'self'
```

- `default-src 'self'` — default to same-origin app assets.
- `script-src` — same-origin scripts plus `wasm-unsafe-eval` for tfjs/Magenta WASM backends; no `unsafe-eval` needed.
- `style-src` — React inline styles and the Google Fonts stylesheet.
- `img-src` — same-origin icons plus `data:`/`blob:` generated images.
- `font-src` — same-origin fonts, Google Fonts files, and `data:` fonts.
- `media-src` — `blob:`/`data:` audio object URLs.
- `connect-src` — same-origin API, Tauri IPC, and Magenta checkpoints on `storage.googleapis.com`.
- `worker-src` — same-origin and `blob:` tfjs worker bundles.
- `object-src`/`base-uri`/`frame-ancestors` — hardening: no plugins, same-origin base URLs, same-origin embedding.

`devCsp` additionally allows `ws://localhost:5173`, `http://localhost:5173`, and inline scripts for the Vite dev server / HMR.

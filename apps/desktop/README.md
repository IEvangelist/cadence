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

# tools/brand

Standalone tooling for the Cadence brand kit. **Not part of the npm workspaces**
(`apps/*`), so it never runs in app CI and never bloats app installs — run it by
hand when the source SVGs or tokens change.

## Scripts

| Command | Does |
|---|---|
| `npm run render` | Rasterizes `docs/brand/logo/*.svg` into the Tauri icon set (`apps/desktop/src-tauri/icons/`) and PWA/web favicons (`apps/web/public/`). |
| `npm run contrast` | Verifies every semantic token pair in `docs/brand/color/tokens.json` meets WCAG 2.1 AA; exits non-zero on any failure. |

## Usage
```bash
cd tools/brand
npm ci          # uses the committed package-lock.json (exact-pinned deps)
npm run render
npm run contrast
```

## Dependencies (exact-pinned)
- **sharp** `0.35.3` — SVG → PNG rasterization (via librsvg).
- **png2icons** `2.0.1` — multi-resolution `.ico` and `.icns` from a PNG master.

Both have prebuilt binaries; `npm ci` restores them from the committed lockfile.

## Notes
- Icon geometry lives in the SVGs under `docs/brand/logo/` — edit there, then
  re-render. Don't hand-edit generated PNG/ICO/ICNS files.
- The sonic logo has its own generator: `python docs/brand/sonic/synthesize.py`
  (Python standard library only).

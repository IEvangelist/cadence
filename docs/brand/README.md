# Brand kit (Phase 1) — Cadence

Owned by the **Brand & Design** squad. Version **1.0** — closes #4.

> **Hook:** a *cadence* resolves a musical phrase — the moment it lands "home."
> Cadence helps you build an idea and **land it**. *Every idea, resolved.*

## What's here

| Area | Location | Highlights |
|---|---|---|
| **Naming** | [`naming.md`](./naming.md) | Shortlist + recommendation (keep **Cadence**), trademark/domain sanity check |
| **Logo & wordmark** | [`logo/`](./logo/) | Original vector logomark + wordmark, light/dark + mono variants, app icon (+ maskable) |
| **Color** | [`color/`](./color/) | `tokens.json`, contrast report (all pairs WCAG 2.1 AA) |
| **Typography** | [`type/typography.md`](./type/typography.md) | Space Grotesk · Inter · JetBrains Mono (all OFL) + scale |
| **Iconography** | [`icon/iconography.md`](./icon/iconography.md) | 24px grid, 1.75px stroke, Lucide (ISC) base |
| **Motion** | [`motion/motion.md`](./motion/motion.md) | Durations, easings, "resolve" patterns, reduced-motion |
| **Sonic identity** | [`sonic/`](./sonic/) | 2.8s audio-logo brief + reproducible synth + `.wav` |
| **Guidelines** | [`guidelines.md`](./guidelines.md) | Logo usage, clearspace, color/type rules, voice & tone |

## Design tokens
- **Interchange:** [`color/tokens.json`](./color/tokens.json) — Style-Dictionary-friendly
  (`value`/`type` schema), light + dark semantic sets, plus type/space/radius/motion.
- **Consumable:** [`apps/web/src/theme/tokens.css`](../../apps/web/src/theme/tokens.css) —
  CSS custom properties wired into the web app (auto light/dark).

## Regenerating assets
Raster exports and the WCAG check are reproducible from source via a standalone
tool package (not part of the npm workspaces, so it never touches app CI):

```bash
cd tools/brand
npm ci
npm run render     # SVG -> Tauri icons + PWA/web favicons
npm run contrast   # verify every token pair meets WCAG 2.1 AA (exits non-zero on fail)
```

The sonic logo regenerates with the Python standard library only:

```bash
python docs/brand/sonic/synthesize.py
```

> **Assets are original to Cadence.** Bundled open-source fonts (OFL) and icons
> (ISC) are used under their licenses; keep those license files with any copies.

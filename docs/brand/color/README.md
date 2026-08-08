# Color

- **[`tokens.json`](./tokens.json)** — the source of truth: full violet/blue/cyan/
  neutral ramps, `status` colors, gradients, and **light + dark semantic sets**
  (also carries type, space, radius, shadow, motion). Style-Dictionary-friendly
  (`value`/`type` schema; theme tokens use `{color.x.y}` references).
- **[`contrast-report.md`](./contrast-report.md)** — every text/background and UI
  pair with its measured WCAG 2.1 ratio. All pass **AA**.
- **Consumable CSS:** [`apps/web/src/theme/tokens.css`](../../../apps/web/src/theme/tokens.css)
  exposes these as `--color-*` custom properties (auto light/dark).

## Palette at a glance

| Role | Light | Dark |
|---|---|---|
| Primary (violet) | `#7A2FF0` | `#A26BFF` |
| Secondary (blue) | `#2563EB` | `#5B96F8` |
| Accent (cyan) | `#12BDDC` | `#38D6EE` |
| Text | `#1B1430` | `#F4F1FB` |
| Background | `#FFFFFF` | `#0E0A1A` |
| Surface | `#F7F5FC` | `#171126` |

**Signature gradient:** `linear-gradient(120deg, #7A2FF0 → #4361F0 → #12BDDC)`.

## Verify
```bash
cd tools/brand && npm ci && npm run contrast
```
Re-runs the AA check straight from `tokens.json`; exits non-zero on any failure.

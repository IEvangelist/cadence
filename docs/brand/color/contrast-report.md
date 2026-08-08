# WCAG 2.1 contrast report — Cadence palette

All semantic text/background and UI pairs below were measured with the WCAG 2.1
relative-luminance formula. **Normal text** targets ≥ 4.5:1 (AA), **large text /
UI components / focus rings** target ≥ 3:1 (AA). Every documented pair passes.

> Method: `L = 0.2126·R + 0.7152·G + 0.0722·B` on linearized sRGB channels;
> ratio = `(Lmax + 0.05) / (Lmin + 0.05)`. Source script:
> `tools/brand/contrast.mjs` (run `node tools/brand/contrast.mjs`).

## Light theme (bg `#FFFFFF`, surface `#F7F5FC`)

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---|---|---|
| Body text on bg | `#1B1430` | `#FFFFFF` | 17.66:1 | 4.5 | ✅ |
| Body text on surface | `#1B1430` | `#F7F5FC` | 16.33:1 | 4.5 | ✅ |
| Muted text on bg | `#5A5470` | `#FFFFFF` | 7.15:1 | 4.5 | ✅ |
| Muted text on surface | `#5A5470` | `#F7F5FC` | 6.61:1 | 4.5 | ✅ |
| Subtle text on bg | `#6E6886` | `#FFFFFF` | 5.27:1 | 4.5 | ✅ |
| Primary link/text on bg | `#6620CF` | `#FFFFFF` | 7.86:1 | 4.5 | ✅ |
| Primary link/text on surface | `#6620CF` | `#F7F5FC` | 7.27:1 | 4.5 | ✅ |
| On-primary (white) on primary btn | `#FFFFFF` | `#7A2FF0` | 6.01:1 | 4.5 | ✅ |
| On-primary (white) on primary-hover | `#FFFFFF` | `#6620CF` | 7.86:1 | 4.5 | ✅ |
| On-secondary (white) on secondary btn | `#FFFFFF` | `#2563EB` | 5.17:1 | 4.5 | ✅ |
| Accent text on bg | `#0B6377` | `#FFFFFF` | 6.85:1 | 4.5 | ✅ |
| On-accent ink on accent chip | `#1B1430` | `#12BDDC` | 7.85:1 | 4.5 | ✅ |
| Primary UI/border on bg | `#8A47FF` | `#FFFFFF` | 4.74:1 | 3.0 | ✅ |
| Focus ring on bg | `#7A2FF0` | `#FFFFFF` | 6.01:1 | 3.0 | ✅ |
| Success text on bg | `#0F7A4B` | `#FFFFFF` | 5.38:1 | 4.5 | ✅ |
| Warning text on bg | `#8A5300` | `#FFFFFF` | 6.33:1 | 4.5 | ✅ |
| Danger text on bg | `#C4123B` | `#FFFFFF` | 6.01:1 | 4.5 | ✅ |
| Info text on bg | `#1D66C9` | `#FFFFFF` | 5.53:1 | 4.5 | ✅ |

## Dark theme (bg `#0E0A1A`, surface `#171126`)

| Pair | Foreground | Background | Ratio | Target | Result |
|---|---|---|---|---|---|
| Body text on bg | `#F4F1FB` | `#0E0A1A` | 17.48:1 | 4.5 | ✅ |
| Body text on surface | `#F4F1FB` | `#171126` | 16.44:1 | 4.5 | ✅ |
| Muted text on bg | `#B7AFCC` | `#0E0A1A` | 9.30:1 | 4.5 | ✅ |
| Muted text on surface | `#B7AFCC` | `#171126` | 8.75:1 | 4.5 | ✅ |
| Subtle text on bg | `#9A92B2` | `#0E0A1A` | 6.62:1 | 4.5 | ✅ |
| Primary link/text on bg | `#BB92FF` | `#0E0A1A` | 8.05:1 | 4.5 | ✅ |
| Primary link/text on surface | `#BB92FF` | `#171126` | 7.57:1 | 4.5 | ✅ |
| Primary (400) text on bg | `#A26BFF` | `#0E0A1A` | 5.65:1 | 4.5 | ✅ |
| On-primary ink on primary btn | `#0E0A1A` | `#A26BFF` | 5.65:1 | 4.5 | ✅ |
| Accent text on bg | `#38D6EE` | `#0E0A1A` | 11.16:1 | 4.5 | ✅ |
| Accent (300) on surface | `#67E8F9` | `#171126` | 12.66:1 | 4.5 | ✅ |
| On-accent ink on accent btn | `#0E0A1A` | `#38D6EE` | 11.16:1 | 4.5 | ✅ |
| Primary UI/border on bg | `#A26BFF` | `#0E0A1A` | 5.65:1 | 3.0 | ✅ |
| Success text on bg | `#4ADE9A` | `#0E0A1A` | 11.33:1 | 4.5 | ✅ |
| Warning text on bg | `#F4C152` | `#0E0A1A` | 11.70:1 | 4.5 | ✅ |
| Danger text on bg | `#FF7A93` | `#0E0A1A` | 7.85:1 | 4.5 | ✅ |
| Info text on bg | `#7BB8FF` | `#0E0A1A` | 9.42:1 | 4.5 | ✅ |

## Notes

- **Cyan is graphic-first.** The vivid accent `#12BDDC`/`#38D6EE` is reserved for
  fills, icons, borders and large display type. When cyan must carry *body* text on
  light surfaces, use the darker **`accent-text` = `#0B6377`** (6.85:1).
- **Primary as text vs. as a fill differ by shade.** On light, link text uses
  violet-700 (`#6620CF`); button fills use violet-600 (`#7A2FF0`) with white. On
  dark, interactive violet is lightened to violet-400/300 so it clears 4.5:1.
- All ratios recomputed on every change via `tools/brand/contrast.mjs`.

# Cadence — Brand Guidelines

Version 1.0 · Brand & Design squad. This is the usage contract for the Cadence
identity. Companion specs: [`naming`](./naming.md) ·
[`color/`](./color/) · [`type/typography.md`](./type/typography.md) ·
[`icon/iconography.md`](./icon/iconography.md) · [`motion/motion.md`](./motion/motion.md) ·
[`sonic/brief.md`](./sonic/brief.md). Machine-readable tokens:
[`color/tokens.json`](./color/tokens.json) and `apps/web/src/theme/tokens.css`.

---

## 1. The hook

> A **cadence** is the chord progression that resolves a musical phrase — the
> satisfying moment it lands "home."

Cadence (the product) makes that feeling effortless: you build an idea and the AI
helps you **land it**. Everything — mark, color, motion, sound — expresses one
arc: **rise → resolution.**

**Brand line:** *Every idea, resolved.*
**Positioning:** *AI-powered, cross-platform music studio — stupid-easy to start,
endlessly deep to master.*

---

## 2. Logo

### Anatomy
The **logomark** is four rounded bars that rise like a musical phrase to a climax,
then **resolve** into a separate cyan bar + floating dot — the "tonic" landing.
Violet = the phrase building; **cyan = the resolution.**

### Assets ([`logo/`](./logo/))
| File | Use |
|---|---|
| `logomark.svg` | Full-color mark, transparent. Primary in-app/site mark. |
| `logomark-mono-light.svg` / `-mono-dark.svg` | One-color mark for constrained/mono contexts. |
| `wordmark-light.svg` / `wordmark-dark.svg` | Mark + "Cadence" lockup (Space Grotesk). |
| `app-icon.svg` | Rounded-square app icon (mark on brand gradient). |
| `app-icon-maskable.svg` | Full-bleed variant for PWA maskable icons. |
| `raster/` + generated icons | PNG/ICO/ICNS exports (regenerate via `tools/brand`). |

### Clearspace
Keep clear space of **one bar-width** (the width of a single logomark bar) on all
sides of the mark or lockup. Nothing — text, other logos, UI chrome — intrudes.

### Minimum sizes
- Logomark: **16px** (favicon floor). Below 24px prefer the mark alone, never the
  full wordmark.
- Wordmark lockup: **120px** wide minimum so "Cadence" stays legible.

### Placement on color
- On light backgrounds: full-color `logomark.svg` or `-mono-light`.
- On dark backgrounds: full-color `logomark.svg` or `-mono-dark`.
- On photos/busy backgrounds or brand-gradient fills: use the **mono** mark in
  white (`#FFFFFF`) or ink (`#1B1430`) for guaranteed contrast.

### Logo don'ts
- ❌ Don't recolor the mark outside the palette or swap violet/cyan roles.
- ❌ Don't rotate, skew, stretch, or add drop shadows/outlines/bevels.
- ❌ Don't re-typeset the wordmark in another font or alter letter-spacing.
- ❌ Don't box the mark or place it on low-contrast backgrounds.
- ❌ Don't rebuild the mark from UI icons, or use it as a generic UI icon.
- ❌ Don't crowd the clearspace.

---

## 3. Color

Full ramps, semantic light/dark tokens, and **measured WCAG 2.1 AA ratios** live
in [`color/tokens.json`](./color/tokens.json) and
[`color/contrast-report.md`](./color/contrast-report.md).

### Core
| Role | Light | Dark | Notes |
|---|---|---|---|
| Primary (violet) | `#7A2FF0` | `#A26BFF` | Buttons, key actions, focus |
| Secondary (blue) | `#2563EB` | `#5B96F8` | Supporting actions, links |
| Accent (cyan) | `#12BDDC` | `#38D6EE` | The "resolve" — highlights, active/AI |
| Ink / text | `#1B1430` | `#F4F1FB` | Body text |
| Background | `#FFFFFF` | `#0E0A1A` | Page |
| Surface | `#F7F5FC` | `#171126` | Cards, panels |

**Signature gradient:** `linear-gradient(120deg, #7A2FF0 → #4361F0 → #12BDDC)` —
violet resolving into cyan. Use for hero moments, the app icon, key illustration.
Use it sparingly; it is a spotlight, not wallpaper.

### Color usage rules
- **Cyan is graphic-first.** For *body text* on light surfaces use the darker
  `accent-text` (`#0B6377`) — the vivid cyan fails 4.5:1 as small text.
- One primary action per view. Don't compete violet against cyan for attention.
- Never encode meaning by hue alone; add text/icon/shape (accessibility).
- Status colors (success/warning/danger/info) are defined per theme and all pass
  AA — don't hand-pick ad-hoc reds/greens.
- Maintain the theme contract: always pair a `--color-*` foreground with its
  intended `--color-*` background so AA is preserved.

---

## 4. Typography

**Space Grotesk** (display) · **Inter** (body/UI) · **JetBrains Mono** (numeric) —
all SIL OFL. Full scale and rules in [`type/typography.md`](./type/typography.md).

- Headlines in Space Grotesk, tight tracking; **all readable copy in Inter**.
- Transport/timecodes/BPM in JetBrains Mono with tabular figures.
- Sentence case for UI; all-caps only for tiny overlines (`+0.04em`).
- Minimum body size 16px on web.

---

## 5. Iconography & motion
- Icons: line-first, 24px grid, 1.75px rounded strokes, `currentColor`. Base set
  **Lucide (ISC)**. See [`icon/iconography.md`](./icon/iconography.md).
- Motion: fast, resolves into place (ease-out), rhythmic staggers, honors
  reduced-motion. Tokens + patterns in [`motion/motion.md`](./motion/motion.md).

---

## 6. Sonic identity
A 2.8s D-major mnemonic that **resolves home** — the audio twin of the mark.
Spec + reproducible synth + WAV in [`sonic/`](./sonic/). Use full logo for launch,
the bloom-only for success states, a single note for micro-confirmations; always
respect the OS "mute UI sounds" setting.

---

## 7. Voice & tone

**Personality:** an encouraging, knowledgeable collaborator — the friend who's a
pro musician but never makes you feel small.

| We are | We are not |
|---|---|
| Warm, encouraging, human | Cutesy, hype-y, exclamation-spammy |
| Clear and concrete | Jargon-heavy or academic |
| Confident, calm | Arrogant or gatekeeping |
| Playful about music, precise about the product | Vague or gimmicky |

**Principles**
- **Plain words first.** "Split the vocals from the track," not "execute stem
  source separation."
- **Encourage, then guide.** Celebrate the user's idea; make the next step obvious.
- **Respect expertise levels.** Never condescend to pros; never overwhelm beginners.
  Progressive disclosure in words as in UI.
- **Lower-case features, capital-C product.** *the composer*, *stem split*, *the
  assistant* — but always **Cadence**.

**Examples**
- Empty state: *"Nothing here yet. Hum an idea, drop a loop, or let the assistant
  start you off."*
- AI suggestion: *"Here's a way to resolve that phrase. Keep it, tweak it, or ask
  for another."*
- Error: *"That export didn't finish — the file may be too long for the free tier.
  Try a shorter section or upgrade for full-length exports."* (say what happened +
  the way forward; never blame the user).
- Success: *"Exported. Your track's ready to share."*

---

## 8. Governance
- Source of truth is this folder; tokens flow into `apps/web` and the landing page.
- Change a color/type/motion value in `tokens.json`, re-run
  `tools/brand` (`npm run contrast`, `npm run render`), and update the affected
  docs in the same PR.
- Assets are **original** to Cadence. Third-party fonts/icons are used under their
  open licenses (OFL / ISC) — keep those license files with any bundled copies.

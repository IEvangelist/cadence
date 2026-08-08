# Typography

All three families are **open-source and OFL-licensed** (SIL Open Font License
1.1) — free to bundle, self-host, and ship in a desktop app.

| Role | Typeface | License | Why |
|---|---|---|---|
| **Display / headings** | **Space Grotesk** | SIL OFL 1.1 | Distinctive, slightly technical grotesque with musical, mechanical character — gives the brand its "hook" without novelty. |
| **Body / UI** | **Inter** | SIL OFL 1.1 | The workhorse: superb legibility at small sizes, huge weight range, excellent for dense DAW UI and long text. |
| **Mono / numeric** | **JetBrains Mono** | SIL OFL 1.1 | Timecodes, BPM, MIDI values, code. Tabular figures keep transport read-outs from jittering. |

> Fallback stacks (in `tokens.json` / `tokens.css`) degrade to `Segoe UI` /
> `system-ui` / `-apple-system` so the UI never renders unstyled while webfonts
> load. Self-host the WOFF2 files for offline/desktop; do **not** hard-depend on a
> third-party CDN at runtime.

## Type scale

A ~1.2–1.25 modular scale. Sizes are tokens (`--font-size-*`); use `rem` so the
scale respects user zoom / OS text-size settings.

| Token | Size | Suggested use | Family / weight | Line-height |
|---|---|---|---|---|
| `6xl` | 4.5rem / 72px | Hero / landing | Display · 700 | tight (1.1) |
| `5xl` | 3.75rem / 60px | Page hero | Display · 700 | tight |
| `4xl` | 3rem / 48px | H1 | Display · 600 | tight |
| `3xl` | 2.25rem / 36px | H2 | Display · 600 | snug (1.25) |
| `2xl` | 1.875rem / 30px | H3 | Display · 600 | snug |
| `xl` | 1.5rem / 24px | H4 / section | Display · 500 | snug |
| `lg` | 1.25rem / 20px | Lead paragraph | Body · 400/500 | normal (1.5) |
| `md` | 1.125rem / 18px | Emphasis body | Body · 400 | normal |
| `base` | 1rem / 16px | Body default | Body · 400 | normal |
| `sm` | 0.875rem / 14px | Secondary / labels | Body · 400/500 | normal |
| `xs` | 0.75rem / 12px | Captions, meta | Body · 500 | snug |

Numeric read-outs (transport, mixer, timecodes) use **JetBrains Mono** with
`font-variant-numeric: tabular-nums`.

## Pairing rules
- **Display for headlines, Inter for everything readable.** Never set long copy in
  Space Grotesk.
- Headlines use tight tracking (`--tracking-tight`, −0.02em); body stays at 0.
- One display weight per view where possible (600 for most headings, 700 reserved
  for hero moments).
- Sentence case for UI and most headings; reserve all-caps for tiny overline
  labels only, with `--tracking-wide` (+0.04em).
- Keep body measure at ~60–75 characters.
- Minimum body size **16px** on web for readability/accessibility.

## CSS

```css
h1, h2, h3, .display { font-family: var(--font-display); letter-spacing: var(--tracking-tight); }
body, p, .ui        { font-family: var(--font-body); }
.metric, code, kbd  { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

## Getting the fonts
- Space Grotesk — https://fonts.google.com/specimen/Space+Grotesk (OFL)
- Inter — https://fonts.google.com/specimen/Inter (OFL)
- JetBrains Mono — https://fonts.google.com/specimen/JetBrains+Mono (OFL)

Bundle the OFL `LICENSE` alongside any self-hosted WOFF2 files.

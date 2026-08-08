# Iconography

A single, quiet, line-first system so product icons never fight the expressive
brand mark.

## Base set
Use **[Lucide](https://lucide.dev)** (ISC license — permissive, bundle-friendly)
as the foundation. It already matches our target style: consistent 24px grid,
rounded caps/joins, even stroke weight. Custom/domain icons (piano roll, stems,
transport, AI-assist) are drawn to the **same rules** so they sit seamlessly
beside Lucide glyphs.

> ISC is MIT-equivalent; keep Lucide's `LICENSE` in the icon package.

## Grid & construction
- **Canvas:** 24 × 24 with a **1.5px live-area padding** (draw inside 21 × 21).
- **Stroke:** **1.75px** at 24px, `stroke-linecap="round"`, `stroke-linejoin="round"`.
  Scale stroke proportionally at other sizes (≈ `size / 13.7`).
- **Corner radius:** ~2px on outer corners; keep interior geometry crisp.
- **Keyline shapes:** align to circle Ø20, square 20×20, or the pixel grid; snap
  to whole/half pixels to stay sharp.
- **Style:** outline by default. Reserve **filled** variants for active/selected
  states (e.g. a toggled transport button) and system-tray/monochrome contexts.
- **Optical balance** over mathematical: a circle icon may exceed the square's
  bounds slightly so it reads the same visual size as a square one.

## Color & states
- Default icons inherit text color: `stroke: currentColor` (so they follow theme
  and contrast tokens automatically — ≥ 3:1 against their background).
- **Interactive:** default `--color-text-muted`; hover/active `--color-text`.
- **Selected / accent:** `--color-primary` (or `--color-accent` for the
  "resolve/AI" family) — never rely on color alone; pair with a fill or label.
- Two-tone brand icons may borrow the **violet→cyan** logic: structure in violet,
  the "resolved/active" element in cyan.

## Sizes
| Context | Size |
|---|---|
| Dense toolbars / inline | 16px |
| Default UI | 20px |
| Primary actions / nav | 24px |
| Empty states / feature marks | 32–48px |

Below 16px, prefer a simplified glyph over shrinking a detailed one.

## Authoring an SVG icon
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="1.75"
     stroke-linecap="round" stroke-linejoin="round">
  <!-- paths inside the 1.5px live-area padding -->
</svg>
```

## Do / don't
- ✅ Keep one visual weight per icon; match the family's rhythm.
- ✅ Optimize exported SVGs (SVGO); strip editor cruft; keep `viewBox`.
- ❌ Don't mix filled and outline within one toolbar row.
- ❌ Don't add drop shadows, gradients, or skeuomorphic detail to UI icons —
  save expression for the brand mark and illustration.
- ❌ Don't recolor the app **logomark** to serve as a UI icon.

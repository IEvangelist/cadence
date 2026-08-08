# Motion

Motion in Cadence is **musical**: things move with intent and **resolve** — they
ease out and land, they don't drift. Animation clarifies cause and effect,
reinforces rhythm, and never gets in the way of making music.

## Principles
1. **Resolve, don't hover.** Default transitions *decelerate into place*
   (ease-out). Motion should feel like a phrase landing on the tonic.
2. **Fast by default.** UI feedback is 150–200ms. If a user waits on an
   animation, it's too long.
3. **Rhythmic, not random.** Stagger lists on a consistent beat (~40–60ms/item).
   Related elements share timing so the interface feels "in time."
4. **Purpose over polish.** Animate to explain (where did this come from? where did
   it go?), not to decorate.
5. **Respect the user.** Honor `prefers-reduced-motion` — swap movement for
   instant/opacity changes (our motion-duration tokens collapse to `0ms`).

## Tokens

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | 100ms | Micro-feedback (checkbox, tiny toggles) |
| `--duration-fast` | 150ms | Hover, focus, small state changes |
| `--duration-base` | 200ms | Default: buttons, tabs, inputs |
| `--duration-slow` | 300ms | Panels, popovers, drawers |
| `--duration-slower` | 500ms | Page/route transitions, hero moments |

| Easing token | Curve | Feel |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default enter/resolve — decelerates and lands |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Elements leaving (accelerate out) |
| `--ease-emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` | Expressive entrances, key moments |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful overshoot — use sparingly (e.g. the resolution dot) |

## Patterns
- **Enter:** fade + 8–12px rise, `--duration-base` `--ease-standard`.
- **Exit:** fade + slight fall, `--duration-fast` `--ease-exit` (leave faster than enter).
- **Hover/press:** `--duration-fast`; press scales to ~0.98.
- **Focus ring:** appears instantly (no delay); use `--shadow-glow`.
- **Signature "resolve":** on success/AI-accept, the accent (cyan) element settles
  with a small `--ease-spring` overshoot — the visual echo of the sonic logo.
- **Loading/AI thinking:** a calm looping pulse on the logomark bars
  (opacity/height, ≥1s cycle) — a metronome, never a frantic spinner.

## Implementation
```css
.button { transition: background-color var(--duration-fast) var(--ease-standard),
                      transform var(--duration-fast) var(--ease-standard); }
.button:active { transform: scale(0.98); }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
```

## Do / don't
- ✅ Keep durations in the token scale; keep enters slower than exits.
- ✅ Animate `transform` and `opacity` (GPU-friendly, 60fps).
- ❌ Don't animate audio-critical UI (playhead, meters) with easing that lags the
   transport — those are **linear and sample-accurate**, not "designed" motion.
- ❌ Don't bounce or spring everything; reserve overshoot for the resolve moment.

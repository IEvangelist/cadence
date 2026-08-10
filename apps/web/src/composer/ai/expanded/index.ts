/**
 * Expanded-AI feature set (effort #45) — public barrel.
 *
 * Four self-contained, deterministic, dependency-free capabilities that extend
 * the base composition assistant, integrated through the composer's public
 * controller/Plugin-SDK surface:
 *
 *  - **Text → motif** — a prompt becomes a short melodic idea.
 *  - **Style transfer** — restyle an existing phrase (lo-fi, jazz, cinematic, EDM).
 *  - **Groove / humanize** — swing + seeded humanization for a played feel.
 *  - **Auto-mastering** — symbolic mix analysis with actionable suggestions.
 *
 * None of these download a model or touch the pinned in-browser AI stack
 * (@tensorflow/tfjs 2.8.6). See docs/composer-ai.md.
 */
export * from './types'
export { hashString, mulberry32, randInt, pick } from './rng'
export {
  FREE_AI_GENERATIONS_PER_DAY,
  UNLIMITED,
  FREE_DEFAULT_ENTITLEMENTS,
  aiEntitlementView,
  canUseFeature,
  isUnlimited,
} from './capabilities'
export { interpretPrompt, describeParams, SUPPORTED_SCALES } from './prompt'
export { generateMotif, type GenerateMotifOptions } from './textToMotif'
export { STYLES, applyStyle, findStyle } from './styleTransfer'
export { GROOVE_PRESETS, applyGroove, findGroovePreset } from './groove'
export { analyzeMastering, computeMixMetrics } from './mastering'

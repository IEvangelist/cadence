/**
 * Public entry point for the built-in **house dubs** template registry.
 *
 * The composer UI (the Quick Starts gallery) reads templates from here and loads
 * a chosen template's `build()` output through the existing `load-project`
 * dispatch path — no parallel load path, no audio-engine changes.
 */
import { HOUSE_DUBS } from './houseDubs'
import type { SongTemplate, TemplateGroup } from './types'

export type { SongTemplate, TemplateGroup } from './types'
export { HOUSE_DUBS } from './houseDubs'

/** All built-in song templates, in gallery order. */
export function listSongTemplates(): SongTemplate[] {
  return HOUSE_DUBS
}

/** Look up a template by id, or `undefined` when unknown. */
export function getSongTemplate(id: string): SongTemplate | undefined {
  return HOUSE_DUBS.find((template) => template.id === id)
}

/**
 * Templates bucketed by genre, preserving first-seen genre order so the gallery
 * renders a stable, grouped list.
 */
export function songTemplatesByGenre(
  templates: readonly SongTemplate[] = HOUSE_DUBS,
): TemplateGroup[] {
  const order: string[] = []
  const buckets = new Map<string, SongTemplate[]>()
  for (const template of templates) {
    if (!buckets.has(template.genre)) {
      buckets.set(template.genre, [])
      order.push(template.genre)
    }
    buckets.get(template.genre)!.push(template)
  }
  return order.map((genre) => ({ genre, templates: buckets.get(genre)! }))
}

import { interactionManifest } from './interactionManifest'

const knownInteractionIds = new Set(interactionManifest.map(({ id }) => id))

export function coversInteractions(...ids: readonly string[]): void {
  for (const id of ids) {
    if (!knownInteractionIds.has(id)) {
      throw new Error(`Unknown interaction ID: ${id}`)
    }
  }
}

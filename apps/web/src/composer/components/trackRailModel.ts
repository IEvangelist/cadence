import type { ComposerController } from '../hooks/useComposer'
import type { Track } from '../model/project'

export function trackRequiresDeleteConfirmation(
  controller: ComposerController,
  track: Track,
): boolean {
  if (track.notes.length > 0) return true
  if ((controller.project.automation ?? []).some((lane) => lane.trackId === track.id)) return true
  const mixer = controller.mixer.getSnapshot().tracks[track.id]
  if (mixer && (mixer.gainDb !== 0 || mixer.pan !== 0 || mixer.solo)) return true
  return controller.mixer.listInserts(track.id).length > 0
}


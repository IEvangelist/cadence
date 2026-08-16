import { X } from 'lucide-react'
import { Icon } from '../../ui/Icon'
import { DialogClose, DialogSurface } from '../../ui/Dialog'
import type { ComposerController } from '../hooks/useComposer'
import { StartCenter } from './StartCenter'

interface ProjectBrowserProps {
  controller: ComposerController
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectBrowser({ controller, open, onOpenChange }: ProjectBrowserProps) {
  return (
    <DialogSurface
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="visually-hidden">Project browser</span>}
      description={
        <span className="visually-hidden">
          Create, import, or open a Cadence project.
        </span>
      }
      contentClassName="project-dialog__content"
    >
      <DialogClose asChild>
        <button
          type="button"
          className="icon-button project-dialog__close"
          data-interaction="studio.project-browser.close"
          aria-label="Close project browser"
        >
          <Icon icon={X} />
        </button>
      </DialogClose>
      <StartCenter
        controller={controller}
        mode="browser"
        onProjectReady={() => onOpenChange(false)}
      />
    </DialogSurface>
  )
}

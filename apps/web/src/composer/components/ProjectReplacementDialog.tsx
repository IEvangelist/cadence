import { useRef } from 'react'
import { DialogClose, DialogSurface } from '../../ui/Dialog'
import type { ComposerController } from '../hooks/useComposer'

interface ProjectReplacementDialogProps {
  controller: ComposerController
  onReplaced?: () => void
}

export function ProjectReplacementDialog({
  controller,
  onReplaced,
}: ProjectReplacementDialogProps) {
  const retryRef = useRef<HTMLButtonElement>(null)
  const replacement = controller.replacement
  const blocked = replacement.status === 'blocked'
  const message = replacement.status === 'blocked' ? replacement.message : ''

  return (
    <DialogSurface
      open={blocked}
      onOpenChange={(open) => {
        if (!open) controller.cancelProjectReplacement()
      }}
      title={<h2>Current changes are not saved</h2>}
      description={
        <p>
          {blocked
            ? `${message} Retry, keep editing, or explicitly discard those changes.`
            : ''}
        </p>
      }
      contentClassName="replacement-dialog__content"
      role="alertdialog"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        retryRef.current?.focus()
      }}
    >
      <div className="replacement-dialog__actions">
        <button
          ref={retryRef}
          type="button"
          className="btn btn-primary"
          data-interaction="studio.project-replacement.retry"
          onClick={() => {
            void controller.retryProjectReplacement().then((result) => {
              if (result === 'replaced') onReplaced?.()
            })
          }}
        >
          Retry save
        </button>
        <DialogClose asChild>
          <button
            type="button"
            className="btn"
            data-interaction="studio.project-replacement.cancel"
          >
            Keep editing
          </button>
        </DialogClose>
        <button
          type="button"
          className="btn btn-danger"
          data-interaction="studio.project-replacement.discard"
          onClick={() => {
            void controller.discardProjectReplacement().then((result) => {
              if (result === 'replaced') onReplaced?.()
            })
          }}
        >
          Discard changes and continue
        </button>
      </div>
    </DialogSurface>
  )
}

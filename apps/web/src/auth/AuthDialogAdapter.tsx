import { type ReactNode, useEffect, useId, useRef } from 'react'

interface AuthDialogAdapterProps {
  open: boolean
  title: string
  description: string
  children: ReactNode
  onOpenChange: (open: boolean) => void
}

export function AuthDialogAdapter({
  open,
  title,
  description,
  children,
  onOpenChange,
}: AuthDialogAdapterProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal()
      } else {
        dialog.setAttribute('open', '')
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close()
      } else {
        dialog.removeAttribute('open')
      }
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="auth-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        onOpenChange(false)
      }}
      onClose={() => onOpenChange(false)}
    >
      <div className="auth-panel">
        <div className="auth-dialog__header">
          <h2 className="auth-panel-title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="btn btn-sm"
            data-interaction="auth.dialog.close"
            onClick={() => onOpenChange(false)}
          >
            Close
          </button>
        </div>
        <p className="auth-dialog__description" id={descriptionId}>
          {description}
        </p>
        {children}
      </div>
    </dialog>
  )
}

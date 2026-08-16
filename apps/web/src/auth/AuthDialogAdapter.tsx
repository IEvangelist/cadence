import type { ReactNode } from 'react'
import { DialogClose, DialogSurface } from '../ui/Dialog'

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
  return (
    <DialogSurface
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="auth-dialog"
      title={<h2 className="auth-panel-title">{title}</h2>}
      description={<p className="auth-dialog__description">{description}</p>}
    >
      <DialogClose asChild>
        <button
          type="button"
          className="btn btn-sm auth-dialog__close"
          data-interaction="auth.dialog.close"
        >
          Close
        </button>
      </DialogClose>
      {children}
    </DialogSurface>
  )
}

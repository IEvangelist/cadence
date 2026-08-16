import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'

export function DialogClose(props: ComponentPropsWithoutRef<typeof RadixDialog.Close>) {
  return <RadixDialog.Close {...props} />
}

export function DialogTrigger(props: ComponentPropsWithoutRef<typeof RadixDialog.Trigger>) {
  return <RadixDialog.Trigger {...props} />
}

interface DialogSurfaceProps
  extends Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, 'title'> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  children: ReactNode
  contentClassName?: string
}

/**
 * Shared accessible modal surface. Feature code supplies content and actions;
 * this wrapper owns the Radix portal, modal overlay, labelling, and focus scope.
 */
export function DialogSurface({
  open,
  onOpenChange,
  title,
  description,
  children,
  contentClassName = '',
  ...contentProps
}: DialogSurfaceProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog__overlay" />
        <RadixDialog.Content
          {...contentProps}
          className={`ui-dialog__content ${contentClassName}`.trim()}
        >
          <RadixDialog.Title asChild>{title}</RadixDialog.Title>
          <RadixDialog.Description asChild>{description}</RadixDialog.Description>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

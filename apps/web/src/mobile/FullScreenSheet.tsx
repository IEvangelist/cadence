import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { Icon } from '../ui/Icon'
import './mobile.css'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface FullScreenSheetProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  testId?: string
}

export function FullScreenSheet({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  testId,
}: FullScreenSheetProps) {
  const titleId = useId()
  const descriptionId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      first?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      previousFocusRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = [
      ...(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []),
    ]
    if (focusable.length === 0) {
      event.preventDefault()
      sheetRef.current?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="mobile-sheet-layer">
      <div
        ref={sheetRef}
        className="mobile-sheet"
        data-testid={testId}
        data-interaction="mobile.sheet.keyboard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="mobile-sheet__header">
          <div className="mobile-sheet__heading">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button
            type="button"
            className="mobile-icon-button"
            data-interaction="mobile.sheet.close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <Icon icon={X} />
          </button>
        </header>
        <div className="mobile-sheet__body">{children}</div>
        {footer && <footer className="mobile-sheet__footer">{footer}</footer>}
      </div>
    </div>
  )
}

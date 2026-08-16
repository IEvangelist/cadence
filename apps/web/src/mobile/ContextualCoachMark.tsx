import { X } from 'lucide-react'
import { Icon } from '../ui/Icon'
import type { CoachMarkDefinition } from './coachMarks'
import './mobile.css'

export interface ContextualCoachMarkProps {
  mark: CoachMarkDefinition | null
  onDismiss: (id: CoachMarkDefinition['id']) => void
}

export function ContextualCoachMark({
  mark,
  onDismiss,
}: ContextualCoachMarkProps) {
  if (!mark) return null

  return (
    <aside className="mobile-coach-mark" aria-labelledby={`coach-${mark.id}`}>
      <div>
        <h3 id={`coach-${mark.id}`}>{mark.title}</h3>
        <p>{mark.body}</p>
      </div>
      <button
        type="button"
        className="mobile-icon-button"
        data-interaction="mobile.coach.dismiss"
        aria-label={`Dismiss ${mark.title}`}
        onClick={() => onDismiss(mark.id)}
      >
        <Icon icon={X} size={18} />
      </button>
    </aside>
  )
}

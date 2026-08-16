import {
  AudioLines,
  FolderOpen,
  HelpCircle,
  Music2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Icon } from '../ui/Icon'
import {
  MOBILE_TASKS,
  type MobileTaskId,
  type MobileTaskState,
} from './mobileTaskModel'
import './mobile.css'

const TASK_ICONS: Record<MobileTaskId, LucideIcon> = {
  project: FolderOpen,
  tracks: AudioLines,
  notes: Music2,
  tools: Wrench,
}

export interface MobileTaskNavigatorProps {
  state: Pick<MobileTaskState, 'activeTask' | 'openSheet'>
  onOpenTask: (task: MobileTaskId) => void
  onOpenHelp: () => void
}

export function MobileTaskNavigator({
  state,
  onOpenTask,
  onOpenHelp,
}: MobileTaskNavigatorProps) {
  return (
    <nav className="mobile-task-nav" aria-label="Composer tasks">
      {MOBILE_TASKS.map((task) => (
        <button
          key={task.id}
          type="button"
          className="mobile-task-nav__button"
          data-interaction="mobile.task.open"
          aria-label={`${task.label}: ${task.description}`}
          aria-current={state.activeTask === task.id ? 'page' : undefined}
          aria-expanded={state.openSheet === task.id}
          onClick={() => onOpenTask(task.id)}
        >
          <Icon icon={TASK_ICONS[task.id]} />
          <span>{task.label}</span>
        </button>
      ))}
      <button
        type="button"
        className="mobile-task-nav__button"
        data-interaction="mobile.help.open"
        aria-label="Help and keyboard shortcuts"
        aria-expanded={state.openSheet === 'help'}
        onClick={onOpenHelp}
      >
        <Icon icon={HelpCircle} />
        <span>Help</span>
      </button>
    </nav>
  )
}

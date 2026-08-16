import type { ReactNode } from 'react'
import { FullScreenSheet } from './FullScreenSheet'
import {
  MOBILE_TASKS,
  type MobileSheetId,
  type MobileTaskId,
} from './mobileTaskModel'

export type MobileTaskContent = Record<MobileTaskId, ReactNode>

export interface MobileTaskSheetsProps {
  openSheet: MobileSheetId | null
  content: MobileTaskContent
  notesFooter?: ReactNode
  onClose: () => void
}

function isTaskSheet(sheet: MobileSheetId | null): sheet is MobileTaskId {
  return MOBILE_TASKS.some((task) => task.id === sheet)
}

export function MobileTaskSheets({
  openSheet,
  content,
  notesFooter,
  onClose,
}: MobileTaskSheetsProps) {
  if (!isTaskSheet(openSheet)) return null
  const task = MOBILE_TASKS.find((candidate) => candidate.id === openSheet)
  if (!task) return null

  return (
    <FullScreenSheet
      open
      title={task.label}
      description={task.description}
      onClose={onClose}
      footer={openSheet === 'notes' ? notesFooter : undefined}
      testId={`mobile-${openSheet}-sheet`}
    >
      {content[openSheet]}
    </FullScreenSheet>
  )
}


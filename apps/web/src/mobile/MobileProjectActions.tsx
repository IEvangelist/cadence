import './mobile.css'

export type MobileProjectActionId =
  | 'create'
  | 'open'
  | 'import'
  | 'save'
  | 'share'
  | 'export'

export interface MobileProjectActionsProps {
  busyAction?: MobileProjectActionId | null
  onCreate: () => void
  onOpen: () => void
  onImport: () => void
  onSave: () => void
  onShare: () => void
  onExport: () => void
}

const PROJECT_ACTIONS: readonly {
  id: MobileProjectActionId
  label: string
}[] = [
  { id: 'create', label: 'Create' },
  { id: 'open', label: 'Open' },
  { id: 'import', label: 'Import' },
  { id: 'save', label: 'Save' },
  { id: 'share', label: 'Share' },
  { id: 'export', label: 'Export' },
]

export function MobileProjectActions({
  busyAction = null,
  onCreate,
  onOpen,
  onImport,
  onSave,
  onShare,
  onExport,
}: MobileProjectActionsProps) {
  const handlers: Record<MobileProjectActionId, () => void> = {
    create: onCreate,
    open: onOpen,
    import: onImport,
    save: onSave,
    share: onShare,
    export: onExport,
  }

  return (
    <div className="mobile-project-actions" aria-label="Project actions">
      {PROJECT_ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          data-interaction="mobile.project.action"
          disabled={busyAction !== null}
          aria-busy={busyAction === action.id}
          onClick={handlers[action.id]}
        >
          {busyAction === action.id ? `${action.label} in progress` : action.label}
        </button>
      ))}
    </div>
  )
}


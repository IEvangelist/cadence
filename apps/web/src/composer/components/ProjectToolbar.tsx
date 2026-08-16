import { useRef } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronDown,
  Download,
  FilePlus2,
  FolderOpen,
  Music,
  Save,
  Share2,
  Upload,
} from 'lucide-react'
import { Icon } from '../../ui/Icon'
import { type ComposerController } from '../hooks/useComposer'
import {
  baseName,
  fileMatchesExtension,
  isProjectFileImport,
  pluginImportFormats,
  projectImportAccept,
} from './projectFileRouting'

interface ProjectToolbarProps {
  controller: ComposerController
  /** Injectable so the browser download can be stubbed in tests. */
  download?: (data: Uint8Array | string, filename: string, mime?: string) => void
  /** Injectable clipboard write so sharing can be asserted in tests. */
  copyText?: (text: string) => void | Promise<void>
  onNewProject?: () => void
  onOpenProject?: () => void
}

function defaultDownload(
  data: Uint8Array | string,
  filename: string,
  mime = 'application/octet-stream',
): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const part: BlobPart = typeof data === 'string' ? data : (data as BlobPart)
  const blob = new Blob([part], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function defaultCopyText(text: string): void {
  const clipboard = (globalThis.navigator as Navigator | undefined)?.clipboard
  if (clipboard?.writeText) void clipboard.writeText(text)
}

/** Slugify a project name into a safe filename stem. */
const slug = (name: string): string =>
  name.trim().replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'cadence'

const saveLabel = (controller: ComposerController): string => {
  switch (controller.saveState.status) {
    case 'dirty':
      return 'Unsaved changes'
    case 'saving':
      return 'Saving'
    case 'error':
      return 'Could not save'
    case 'saved':
      return controller.saveState.savedAt
        ? `Saved ${new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          }).format(new Date(controller.saveState.savedAt))}`
        : 'All changes saved'
    default:
      return 'All changes saved'
  }
}

/** Project name, explicit save state, and grouped project/export commands. */
export function ProjectToolbar({
  controller,
  download = defaultDownload,
  copyText = defaultCopyText,
  onNewProject,
  onOpenProject,
}: ProjectToolbarProps) {
  const {
    project,
    setProjectName,
    saveProject,
    exportMidi,
    exportWav,
    exportMp3,
    shareSnapshot,
    formats,
    exportFormat,
    actionMessage,
  } = controller
  const midiRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const exportableFormats = formats.filter((f) => f.export)
  const importablePluginFormats = pluginImportFormats(formats)

  const exportName = (ext: string): string => `${slug(project.name)}${ext}`

  const handleMidiImport = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const bytes = await file.arrayBuffer()
      await controller.replaceWithMidi(bytes, baseName(file.name))
    } catch {
      // importMidi surfaces parse errors itself; this guards the file read.
    }
  }

  const handleExportMidi = (): void => {
    download(exportMidi(), exportName('.mid'), 'audio/midi')
  }

  const handleExportFormat = async (value: string): Promise<void> => {
    if (value === 'wav') {
      const bytes = await exportWav()
      if (bytes) download(bytes, exportName('.wav'), 'audio/wav')
      return
    }
    if (value === 'mp3') {
      const bytes = await exportMp3()
      if (bytes) download(bytes, exportName('.mp3'), 'audio/mpeg')
      return
    }
    const format = formats.find((f) => f.id === value)
    if (!format?.export) return
    const data = exportFormat(value)
    if (data != null) download(data, exportName(format.extension), format.mimeType)
  }

  const handleImportFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      return
    }
    // Plugin-contributed formats route by file extension; the built-in
    // project/MusicXML importers keep their structural JSON sniffing below.
    const pluginFormat = importablePluginFormats.find((f) =>
      fileMatchesExtension(f.extension, file.name),
    )
    if (pluginFormat) {
      await controller.replaceWithPluginFormat(pluginFormat.id, text, baseName(file.name))
      return
    }
    if (isProjectFileImport(file.name, text)) {
      await controller.replaceWithProjectFile(text, baseName(file.name))
    } else {
      await controller.replaceWithMusicXml(text, baseName(file.name))
    }
  }

  const handleShare = (): void => {
    const snapshot = shareSnapshot()
    if (snapshot.kind === 'url') {
      void copyText(snapshot.url)
    } else {
      const data = exportFormat('project')
      if (data != null) download(data, exportName('.cadence.json'), 'application/json')
    }
  }

  return (
    <div className="toolbar" role="group" aria-label="Project toolbar">
      <label className="field field-grow">
        <span className="visually-hidden">Project name</span>
        <input
          className="project-name"
          data-interaction="studio.project.name"
          value={project.name}
          onChange={(event) => setProjectName(event.target.value)}
          onBlur={stopHistoryCapture}
          aria-label="Project name"
        />
      </label>

      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="btn btn-sm"
            data-interaction="studio.project.menu.toggle"
          >
            Project
            <Icon icon={ChevronDown} size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="ui-menu" align="start" sideOffset={8}>
            <DropdownMenu.Label className="ui-menu__label">Project</DropdownMenu.Label>
            <DropdownMenu.Item asChild>
              <button
                type="button"
                className="ui-menu__item"
                data-interaction="studio.project.new"
                onClick={onNewProject}
              >
                <Icon icon={FilePlus2} size={16} />
                <span>New project</span>
              </button>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <button
                type="button"
                className="ui-menu__item"
                data-interaction="studio.project.open"
                onClick={onOpenProject}
              >
                <Icon icon={FolderOpen} size={16} />
                <span>Open project</span>
              </button>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="ui-menu__separator" />
            <DropdownMenu.Item asChild>
              <button
                type="button"
                className="ui-menu__item"
                data-interaction="studio.project.import.trigger"
                onClick={() => importRef.current?.click()}
              >
                <Icon icon={Upload} size={16} />
                <span>Import file</span>
              </button>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <button
                type="button"
                className="ui-menu__item"
                data-interaction="studio.project.midi-import.trigger"
                onClick={() => midiRef.current?.click()}
              >
                <Icon icon={Music} size={16} />
                <span>Import MIDI</span>
              </button>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <button
        type="button"
        className="btn btn-primary btn-sm"
        data-interaction="studio.project.save"
        disabled={controller.saveState.status === 'saving'}
        onClick={() => void saveProject()}
      >
        <Icon icon={Save} size={15} />
        Save
      </button>

      <input
        ref={importRef}
        type="file"
        data-interaction="studio.project.import.file"
        accept={projectImportAccept(formats)}
        className="visually-hidden"
        aria-label="Import project or MusicXML file"
        onChange={(event) => {
          void handleImportFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      <input
        ref={midiRef}
        type="file"
        data-interaction="studio.project.midi-import.file"
        accept=".mid,.midi,audio/midi"
        className="visually-hidden"
        aria-label="Import MIDI file"
        onChange={(event) => {
          void handleMidiImport(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="btn btn-sm"
            data-interaction="studio.project.export"
          >
            Export &amp; share
            <Icon icon={ChevronDown} size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="ui-menu" align="end" sideOffset={8}>
            <DropdownMenu.Label className="ui-menu__label">Export</DropdownMenu.Label>
            {exportableFormats.map((format) => (
              <DropdownMenu.Item key={format.id} asChild>
                <button
                  type="button"
                  className="ui-menu__item"
                  data-interaction="studio.project.export.format"
                  onClick={() => void handleExportFormat(format.id)}
                >
                  <Icon icon={Download} size={16} />
                  <span>Export {format.name}</span>
                </button>
              </DropdownMenu.Item>
            ))}
            {[
              ['wav', 'WAV audio'],
              ['mp3', 'MP3 audio'],
            ].map(([id, label]) => (
              <DropdownMenu.Item key={id} asChild>
                <button
                  type="button"
                  className="ui-menu__item"
                  data-interaction="studio.project.export.format"
                  onClick={() => void handleExportFormat(id)}
                >
                  <Icon icon={Download} size={16} />
                  <span>Export {label}</span>
                </button>
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Item asChild>
              <button
                type="button"
                className="ui-menu__item"
                data-interaction="studio.project.midi-export"
                onClick={handleExportMidi}
              >
                <Icon icon={Music} size={16} />
                <span>Export MIDI</span>
              </button>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="ui-menu__separator" />
            <DropdownMenu.Item asChild>
              <button
                type="button"
                className="ui-menu__item"
                data-interaction="studio.project.share"
                onClick={handleShare}
              >
                <Icon icon={Share2} size={16} />
                <span>Share snapshot</span>
              </button>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <span
        className={`toolbar-save-state toolbar-save-state--${controller.saveState.status}`}
        role={controller.saveState.status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {saveLabel(controller)}
      </span>
      {controller.saveState.status === 'error' ? (
        <button
          type="button"
          className="btn btn-sm"
          data-interaction="studio.save.retry"
          onClick={() => void controller.retrySave()}
        >
          Retry save
        </button>
      ) : null}
      <span className="toolbar-status" role="status" aria-live="polite">
        {actionMessage?.text ?? ''}
      </span>
    </div>
  )
}

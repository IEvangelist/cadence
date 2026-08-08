import { useRef } from 'react'
import { type ComposerController } from '../hooks/useComposer'

interface ProjectToolbarProps {
  controller: ComposerController
  /** Injectable so the browser download can be stubbed in tests. */
  download?: (bytes: Uint8Array, filename: string) => void
}

function defaultDownload(bytes: Uint8Array, filename: string): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const safeFilename = (name: string): string =>
  `${name.trim().replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'cadence'}.mid`

/** Project name + New/Demo/Save/Open and MIDI import/export. */
export function ProjectToolbar({ controller, download = defaultDownload }: ProjectToolbarProps) {
  const {
    project,
    setProjectName,
    newProject,
    loadDemo,
    saveProject,
    loadProject,
    savedProjects,
    importMidi,
    exportMidi,
    status,
  } = controller
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImport = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const bytes = await file.arrayBuffer()
      importMidi(bytes, file.name.replace(/\.midi?$/i, ''))
    } catch {
      // importMidi surfaces parse errors itself; this guards the file read.
    }
  }

  const handleExport = (): void => {
    download(exportMidi(), safeFilename(project.name))
  }

  return (
    <div className="toolbar" role="group" aria-label="Project toolbar">
      <label className="field field-grow">
        <span className="visually-hidden">Project name</span>
        <input
          className="project-name"
          value={project.name}
          onChange={(event) => setProjectName(event.target.value)}
          aria-label="Project name"
        />
      </label>

      <button type="button" className="btn btn-sm" onClick={newProject}>
        New
      </button>
      <button type="button" className="btn btn-sm" onClick={loadDemo}>
        Demo
      </button>
      <button type="button" className="btn btn-sm" onClick={() => void saveProject()}>
        Save
      </button>

      <label className="field">
        <span className="visually-hidden">Open project</span>
        <select
          className="open-select"
          value=""
          aria-label="Open project"
          onChange={(event) => {
            if (event.target.value) void loadProject(event.target.value)
          }}
        >
          <option value="">Open…</option>
          {savedProjects.map((meta) => (
            <option key={meta.id} value={meta.id}>
              {meta.name}
            </option>
          ))}
        </select>
      </label>

      <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
        Import MIDI
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".mid,.midi,audio/midi"
        className="visually-hidden"
        aria-label="Import MIDI file"
        onChange={(event) => {
          void handleImport(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <button type="button" className="btn btn-sm" onClick={handleExport}>
        Export MIDI
      </button>

      <span className="toolbar-status" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  )
}

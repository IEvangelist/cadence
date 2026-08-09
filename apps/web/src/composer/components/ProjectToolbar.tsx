import { useRef } from 'react'
import { type ComposerController } from '../hooks/useComposer'

interface ProjectToolbarProps {
  controller: ComposerController
  /** Injectable so the browser download can be stubbed in tests. */
  download?: (data: Uint8Array | string, filename: string, mime?: string) => void
  /** Injectable clipboard write so sharing can be asserted in tests. */
  copyText?: (text: string) => void | Promise<void>
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

const baseName = (filename: string): string =>
  filename.replace(/\.cadence\.json$/i, '').replace(/\.[^.]+$/, '')

/**
 * Decide whether an imported file is a portable project (`.cadence.json`) or
 * MusicXML. Extension is the primary signal; when it's ambiguous we sniff
 * *structurally* (a project file is JSON) rather than scanning the text for a
 * substring like "score-partwise" — which would misroute a valid project whose
 * own content happens to contain that string.
 */
function isProjectFileImport(filename: string, text: string): boolean {
  if (/\.(xml|musicxml)$/i.test(filename)) return false
  if (/\.cadence(\.json)?$/i.test(filename) || /\.json$/i.test(filename)) return true
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** Built-in formats handled by the toolbar's own structural import routing. */
const BUILTIN_FORMAT_IDS = new Set(['musicxml', 'project'])

const fileMatchesExtension = (extension: string, filename: string): boolean =>
  filename.toLowerCase().endsWith(extension.toLowerCase())

/** Project name + New/Demo/Save/Open plus multi-format import/export and share. */
export function ProjectToolbar({
  controller,
  download = defaultDownload,
  copyText = defaultCopyText,
}: ProjectToolbarProps) {
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
    importMusicXml,
    importProjectFile,
    exportWav,
    shareSnapshot,
    formats,
    exportFormat,
    importFormat,
    status,
  } = controller
  const midiRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const exportableFormats = formats.filter((f) => f.export)
  const pluginImportFormats = formats.filter(
    (f) => f.import && !BUILTIN_FORMAT_IDS.has(f.id),
  )
  const importAccept = [
    '.cadence',
    '.cadence.json',
    '.json',
    '.xml',
    '.musicxml',
    'application/json',
    'application/xml',
    ...pluginImportFormats.map((f) => f.extension),
  ].join(',')

  const exportName = (ext: string): string => `${slug(project.name)}${ext}`

  const handleMidiImport = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const bytes = await file.arrayBuffer()
      importMidi(bytes, baseName(file.name))
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
    const pluginFormat = pluginImportFormats.find((f) =>
      fileMatchesExtension(f.extension, file.name),
    )
    if (pluginFormat) {
      importFormat(pluginFormat.id, text, baseName(file.name))
      return
    }
    if (isProjectFileImport(file.name, text)) importProjectFile(text, baseName(file.name))
    else importMusicXml(text, baseName(file.name))
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

      <button
        type="button"
        className="btn btn-sm"
        onClick={() => importRef.current?.click()}
      >
        Import file
      </button>
      <input
        ref={importRef}
        type="file"
        accept={importAccept}
        className="visually-hidden"
        aria-label="Import project or MusicXML file"
        onChange={(event) => {
          void handleImportFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      <label className="field">
        <span className="visually-hidden">Export as</span>
        <select
          className="export-select"
          value=""
          aria-label="Export as"
          onChange={(event) => {
            const { value } = event.target
            event.target.value = ''
            if (value) void handleExportFormat(value)
          }}
        >
          <option value="">Export…</option>
          {exportableFormats.map((format) => (
            <option key={format.id} value={format.id}>
              {format.name}
            </option>
          ))}
          <option value="wav">Audio (.wav)</option>
        </select>
      </label>

      <button type="button" className="btn btn-sm" onClick={handleShare}>
        Share
      </button>

      <button type="button" className="btn btn-sm" onClick={() => midiRef.current?.click()}>
        Import MIDI
      </button>
      <input
        ref={midiRef}
        type="file"
        accept=".mid,.midi,audio/midi"
        className="visually-hidden"
        aria-label="Import MIDI file"
        onChange={(event) => {
          void handleMidiImport(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <button type="button" className="btn btn-sm" onClick={handleExportMidi}>
        Export MIDI
      </button>

      <span className="toolbar-status" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  )
}

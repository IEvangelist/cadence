import { useRef, useState } from 'react'
import { FileMusic, FilePlus2, FolderOpen, RotateCcw, Sparkles } from 'lucide-react'
import { Icon } from '../../ui/Icon'
import type {
  ComposerController,
} from '../hooks/useComposer'
import type { ProjectReplacementResult } from '../model/projectLifecycle'
import { QuickStartGallery } from './QuickStartGallery'
import {
  baseName,
  fileMatchesExtension,
  isProjectFileImport,
  pluginImportFormats,
  projectImportAccept,
} from './projectFileRouting'
import './StartCenter.css'

interface StartCenterProps {
  controller: ComposerController
  mode?: 'initial' | 'browser'
  onProjectReady?: () => void
}

const updatedLabel = (updatedAt: number): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(updatedAt))

export function StartCenter({
  controller,
  mode = 'initial',
  onProjectReady,
}: StartCenterProps) {
  const projectInputRef = useRef<HTMLInputElement>(null)
  const midiInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pluginFormats = pluginImportFormats(controller.formats)

  const choose = async (operation: Promise<ProjectReplacementResult>): Promise<void> => {
    setBusy(true)
    try {
      if ((await operation) === 'replaced') onProjectReady?.()
    } finally {
      setBusy(false)
    }
  }

  const importProjectFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      const text = await file.text()
      const pluginFormat = pluginFormats.find((format) =>
        fileMatchesExtension(format.extension, file.name),
      )
      const result = pluginFormat
        ? await controller.replaceWithPluginFormat(pluginFormat.id, text, baseName(file.name))
        : isProjectFileImport(file.name, text)
          ? await controller.replaceWithProjectFile(text, baseName(file.name))
          : await controller.replaceWithMusicXml(text, baseName(file.name))
      if (result === 'replaced') onProjectReady?.()
    } catch {
      controller.notifyError('Cadence could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  const importMidiFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      const result = await controller.replaceWithMidi(
        await file.arrayBuffer(),
        baseName(file.name),
      )
      if (result === 'replaced') onProjectReady?.()
    } catch {
      controller.notifyError('Cadence could not read that MIDI file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={`start-center start-center--${mode}`}
      id={mode === 'initial' ? 'composer-main' : undefined}
      aria-labelledby={`start-center-title-${mode}`}
      tabIndex={-1}
      aria-busy={busy}
    >
      <header className="start-center__header">
        <p className="start-center__eyebrow">Cadence Studio</p>
        <h2 id={`start-center-title-${mode}`}>Start a project</h2>
        <p>Begin with a blank canvas, reopen recent work, or shape a ready-made idea.</p>
      </header>

      {controller.actionMessage ? (
        <p
          className={`start-center__message start-center__message--${controller.actionMessage.tone}`}
          role={controller.actionMessage.tone === 'error' ? 'alert' : 'status'}
        >
          {controller.actionMessage.text}
        </p>
      ) : null}

      {controller.hydration.status === 'restore-error' ? (
        <section className="start-center__restore-error" role="alert">
          <h3>Your last project could not be restored</h3>
          <p>{controller.hydration.message} Retry, or continue without changing saved data.</p>
          <div className="start-center__actions">
            <button
              type="button"
              className="btn btn-primary"
              data-interaction="start-center.restore.retry"
              onClick={controller.retryHydration}
            >
              <Icon icon={RotateCcw} size={16} />
              Retry restore
            </button>
            <button
              type="button"
              className="btn"
              data-interaction="start-center.restore.continue"
              onClick={controller.continueToStartCenter}
            >
              Continue to Start Center
            </button>
          </div>
        </section>
      ) : null}

      {controller.hydration.status !== 'restore-error' ? (
        <>
      <section className="start-center__section" aria-labelledby={`create-project-${mode}`}>
        <h3 id={`create-project-${mode}`}>Create or import</h3>
        <div className="start-center__primary-actions">
          <button
            type="button"
            className="start-center__action start-center__action--primary"
            data-interaction="start-center.blank"
            disabled={busy}
            onClick={() => void choose(controller.replaceWithBlank())}
          >
            <Icon icon={FilePlus2} />
            <span>
              <strong>Blank project</strong>
              <small>Start with one empty synth track.</small>
            </span>
          </button>
          <button
            type="button"
            className="start-center__action"
            data-interaction="studio.project.demo"
            disabled={busy}
            onClick={() => void choose(controller.replaceWithDemo())}
          >
            <Icon icon={Sparkles} />
            <span>
              <strong>Demo pattern</strong>
              <small>Open the familiar Cadence starter arrangement.</small>
            </span>
          </button>
          <button
            type="button"
            className="start-center__action"
            data-interaction="start-center.import.trigger"
            disabled={busy}
            onClick={() => projectInputRef.current?.click()}
          >
            <Icon icon={FolderOpen} />
            <span>
              <strong>Import project</strong>
              <small>Cadence, MusicXML, or an extension format.</small>
            </span>
          </button>
          <button
            type="button"
            className="start-center__action"
            data-interaction="start-center.midi-import.trigger"
            disabled={busy}
            onClick={() => midiInputRef.current?.click()}
          >
            <Icon icon={FileMusic} />
            <span>
              <strong>Import MIDI</strong>
              <small>Turn a MIDI file into a fresh project.</small>
            </span>
          </button>
        </div>
        <input
          ref={projectInputRef}
          className="visually-hidden"
          type="file"
          data-interaction="start-center.import.file"
          aria-label="Import project or MusicXML from Start Center"
          accept={projectImportAccept(controller.formats)}
          onChange={(event) => {
            void importProjectFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <input
          ref={midiInputRef}
          className="visually-hidden"
          type="file"
          data-interaction="start-center.midi-import.file"
          aria-label="Import MIDI from Start Center"
          accept=".mid,.midi,audio/midi"
          onChange={(event) => {
            void importMidiFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </section>

      <section className="start-center__section" aria-labelledby={`recent-projects-${mode}`}>
        <div className="start-center__section-heading">
          <h3 id={`recent-projects-${mode}`}>Recent projects</h3>
          {controller.recentProjectsState.status === 'error' ? (
            <button
              type="button"
              className="btn btn-sm"
              data-interaction="start-center.recents.retry"
              onClick={() => void controller.refreshSavedProjects()}
            >
              Retry
            </button>
          ) : null}
        </div>
        {controller.recentProjectsState.status === 'loading' ? (
          <p className="start-center__muted" role="status">Loading recent projects...</p>
        ) : controller.recentProjectsState.status === 'error' ? (
          <p className="start-center__error" role="alert">
            {controller.recentProjectsState.message}
          </p>
        ) : controller.savedProjects.length === 0 ? (
          <p className="start-center__muted">No saved projects yet.</p>
        ) : (
          <ul className="start-center__recents">
            {controller.savedProjects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="start-center__recent"
                  data-interaction="start-center.recent.open"
                  disabled={busy}
                  onClick={() => void choose(controller.openStoredProject(project.id))}
                >
                  <strong>{project.name}</strong>
                  <time dateTime={new Date(project.updatedAt).toISOString()}>
                    {updatedLabel(project.updatedAt)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="start-center__section" aria-labelledby={`templates-${mode}`}>
        <h3 id={`templates-${mode}`}>Quick Starts</h3>
        <QuickStartGallery
          onLoad={(template) => void choose(controller.replaceWithTemplate(template))}
        />
      </section>
        </>
      ) : null}
    </section>
  )
}

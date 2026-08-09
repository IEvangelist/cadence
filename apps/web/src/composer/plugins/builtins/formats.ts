/**
 * Built-in file formats, expressed as Plugin SDK contributions.
 *
 * These wrap the composer's existing, well-tested codecs (`projectToMusicXml` /
 * `musicXmlToProject` and `projectToFile` / `fileToProject`) in the same
 * {@link FormatContribution} contract a third-party plugin uses, so the toolbar's
 * export menu and importer are populated from one host registry.
 *
 * Scope note: the v1 contribution contract targets text/`Uint8Array` *synchronous*
 * codecs. MIDI (binary import) and WAV (async, engine-bound offline render) remain
 * dedicated toolbar controls; generalizing the contract to binary-import and async
 * exporters is a documented follow-up (see docs/plugins.md).
 */
import {
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_MIME,
  fileToProject,
  projectToFile,
} from '../../formats/projectFile'
import { musicXmlToProject, projectToMusicXml } from '../../formats/musicxml'
import type { FormatContribution } from '../types'

/** The MusicXML and portable-project formats, registered through the SDK. */
export const BUILTIN_FORMATS: FormatContribution[] = [
  {
    id: 'musicxml',
    name: 'MusicXML (.musicxml)',
    extension: '.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    export: (project) => projectToMusicXml(project),
    import: (data, options) => musicXmlToProject(data, options),
  },
  {
    id: 'project',
    name: 'Project file (.cadence.json)',
    extension: PROJECT_FILE_EXTENSION,
    mimeType: PROJECT_FILE_MIME,
    export: (project) => projectToFile(project),
    import: (data, options) => fileToProject(data, options),
  },
]

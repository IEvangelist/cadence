import type { FormatContribution } from '../plugins/types'

const BUILTIN_FORMAT_IDS = new Set(['musicxml', 'project'])

export const baseName = (filename: string): string =>
  filename.replace(/\.cadence\.json$/i, '').replace(/\.[^.]+$/, '')

export function isProjectFileImport(filename: string, text: string): boolean {
  if (/\.(xml|musicxml)$/i.test(filename)) return false
  if (/\.cadence(\.json)?$/i.test(filename) || /\.json$/i.test(filename)) return true
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export const pluginImportFormats = (
  formats: readonly FormatContribution[],
): FormatContribution[] =>
  formats.filter((format) => format.import && !BUILTIN_FORMAT_IDS.has(format.id))

export const fileMatchesExtension = (extension: string, filename: string): boolean =>
  filename.toLowerCase().endsWith(extension.toLowerCase())

export const projectImportAccept = (formats: readonly FormatContribution[]): string =>
  [
    '.cadence',
    '.cadence.json',
    '.json',
    '.xml',
    '.musicxml',
    'application/json',
    'application/xml',
    ...pluginImportFormats(formats).map((format) => format.extension),
  ].join(',')

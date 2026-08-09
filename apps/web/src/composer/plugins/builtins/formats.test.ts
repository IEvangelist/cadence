import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../model/project'
import { BUILTIN_FORMATS } from './formats'

const byId = (id: string) => {
  const format = BUILTIN_FORMATS.find((f) => f.id === id)
  if (!format) throw new Error(`missing format ${id}`)
  return format
}

describe('built-in format contributions', () => {
  it('registers MusicXML and the portable project file', () => {
    expect(BUILTIN_FORMATS.map((f) => f.id).sort()).toEqual(['musicxml', 'project'])
    for (const format of BUILTIN_FORMATS) {
      expect(format.name.length).toBeGreaterThan(0)
      expect(format.extension.startsWith('.')).toBe(true)
      expect(typeof format.export).toBe('function')
      expect(typeof format.import).toBe('function')
    }
  })

  it('round-trips a project through the project-file contribution', () => {
    const project = createDemoProject('demo')
    const format = byId('project')
    const text = format.export!(project) as string
    const restored = format.import!(text, { id: 'x', name: 'restored' })
    expect(restored.name).toBe('restored')
    expect(restored.tracks).toHaveLength(project.tracks.length)
  })

  it('round-trips note content through the MusicXML contribution', () => {
    const project = createDemoProject('demo')
    const format = byId('musicxml')
    const xml = format.export!(project) as string
    expect(xml).toContain('score-partwise')
    const restored = format.import!(xml, { id: 'y', name: 'from-xml' })
    expect(restored.tracks.length).toBeGreaterThan(0)
  })
})

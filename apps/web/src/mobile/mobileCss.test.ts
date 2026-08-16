import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/mobile/mobile.css'), 'utf8')

describe('mobile CSS contract', () => {
  it('accounts for every safe-area edge', () => {
    expect(css).toContain('env(safe-area-inset-top)')
    expect(css).toContain('env(safe-area-inset-right)')
    expect(css).toContain('env(safe-area-inset-bottom)')
    expect(css).toContain('env(safe-area-inset-left)')
  })

  it('keeps coarse-pointer controls at least 44px', () => {
    const coarsePointer = css.match(
      /@media \(pointer: coarse\) \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body

    expect(coarsePointer).toContain('min-width: 44px')
    expect(coarsePointer).toContain('min-height: 44px')
  })

  it('scopes touch-action to the scroll and manipulation targets', () => {
    expect(css).toMatch(
      /\.mobile-piano-scroll\s*\{[\s\S]*?touch-action: pan-x pan-y;/,
    )
    expect(css).toMatch(
      /\.mobile-note-manipulation\s*\{[\s\S]*?touch-action: none;/,
    )
    expect(css).not.toMatch(/(?:html|body|\*)\s*\{[^}]*touch-action:/)
  })

  it('honors reduced motion without suppressing root overflow', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).not.toMatch(/(?:html|body)\s*\{[^}]*overflow:\s*hidden/)
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/mobile/mobile.css'), 'utf8')
const composerCss = readFileSync(
  path.resolve(process.cwd(), 'src/composer/Composer.css'),
  'utf8',
)

describe('mobile CSS contract', () => {
  it('routes every safe-area edge through overridable env-backed variables', () => {
    expect(css).toContain('env(safe-area-inset-top)')
    expect(css).toContain('env(safe-area-inset-right)')
    expect(css).toContain('env(safe-area-inset-bottom)')
    expect(css).toContain('env(safe-area-inset-left)')
    expect(css).toMatch(
      /\.mobile-sheet__body\s*\{[\s\S]*?var\(--mobile-safe-area-bottom\)/,
    )
  })

  it('keeps coarse-pointer controls at least 44px', () => {
    const coarsePointer = css.match(
      /@media \(pointer: coarse\) \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body

    expect(coarsePointer).toContain('min-width: 44px')
    expect(coarsePointer).toContain('min-height: 44px')
  })

  it('scopes touch-action to the real piano-roll targets', () => {
    expect(composerCss).toMatch(
      /\.pr-scroll\s*\{[\s\S]*?touch-action: pan-x pan-y;/,
    )
    expect(composerCss).toMatch(
      /\.pr-note,\s*\.pr-vel-bar\s*\{[\s\S]*?touch-action: none;/,
    )
    expect(composerCss).toMatch(
      /\.pr-note::before\s*\{[\s\S]*?width: max\(44px, 100%\);[\s\S]*?height: 44px;/,
    )
    expect(`${css}\n${composerCss}`).not.toMatch(
      /(?:html|body|\*)\s*\{[^}]*touch-action:/,
    )
  })

  it('honors reduced motion without suppressing root overflow', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).not.toMatch(/(?:html|body)\s*\{[^}]*overflow:\s*hidden/)
  })
})

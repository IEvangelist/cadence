/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import { interactionManifest } from './interactionManifest'

const webRoot = process.cwd()
const sourceRoot = path.resolve(webRoot, 'src')
const parseForESLint = tseslint.parser.parseForESLint as (
  code: string,
  options: { filePath: string; jsx: boolean; loc: boolean },
) => ReturnType<typeof tseslint.parser.parseForESLint>

const nativeInteractiveTags = new Set(['button', 'a', 'input', 'select', 'textarea'])
const interactiveHandlers = new Set([
  'onClick',
  'onChange',
  'onInput',
  'onKeyDown',
  'onKeyUp',
  'onPointerDown',
  'onPointerUp',
  'onMouseDown',
  'onMouseUp',
  'onTouchStart',
  'onTouchEnd',
  'onScroll',
  'onSubmit',
])
const interactiveRoles = new Set([
  'application',
  'button',
  'checkbox',
  'link',
  'menuitem',
  'radio',
  'slider',
  'switch',
  'tab',
])

interface AllowlistedInteraction {
  key: string
  reason: string
}

const allowlistedInteractions: readonly AllowlistedInteraction[] = [
  {
    key: 'auth/AuthBar.tsx::form::auth-form',
    reason: 'The identified credentials submit button owns this non-focusable form submission.',
  },
  {
    key: 'auth/AuthBar.tsx::form::auth-form auth-magic',
    reason: 'The identified magic-link submit button owns this non-focusable form submission.',
  },
  {
    key: 'auth/ProfilePage.tsx::form::auth-form',
    reason: 'The identified profile save button owns this non-focusable form submission.',
  },
  {
    key: 'stems/StemsPage.tsx::form::stems-uploader',
    reason: 'The identified separation submit button owns this non-focusable form submission.',
  },
  {
    key: 'composer/components/PianoRoll.tsx::div::pr-scroll',
    reason: 'This passive wrapper only synchronizes the already identified velocity lane scroll.',
  },
]

interface SourceInteraction {
  id: string
  file: string
  line: number
}

interface AstNode extends Record<string, unknown> {
  type: string
  loc?: {
    start: { line: number }
  }
}

interface JsxAttribute extends AstNode {
  type: 'JSXAttribute'
  name: AstNode & { type: 'JSXIdentifier'; name: string }
  value: AstNode & { type: 'Literal'; value: string }
}

interface JsxOpeningElement extends AstNode {
  type: 'JSXOpeningElement'
  name: AstNode & { type: 'JSXIdentifier'; name: string }
  attributes: AstNode[]
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'test' ? [] : sourceFiles(resolved)
    }
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [resolved] : []
  })
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && 'type' in value
}

function isOpeningElement(node: AstNode): node is JsxOpeningElement {
  return (
    node.type === 'JSXOpeningElement' &&
    isAstNode(node.name) &&
    node.name.type === 'JSXIdentifier' &&
    typeof node.name.name === 'string' &&
    Array.isArray(node.attributes)
  )
}

function isJsxAttribute(node: AstNode): node is JsxAttribute {
  return (
    node.type === 'JSXAttribute' &&
    isAstNode(node.name) &&
    node.name.type === 'JSXIdentifier' &&
    typeof node.name.name === 'string'
  )
}

function attribute(node: JsxOpeningElement, name: string): JsxAttribute | undefined {
  return node.attributes.find(
    (candidate): candidate is JsxAttribute =>
      isJsxAttribute(candidate) && candidate.name.name === name,
  )
}

function stringAttribute(node: JsxOpeningElement, name: string): string | undefined {
  const value = attribute(node, name)?.value
  return isAstNode(value) && value.type === 'Literal' && typeof value.value === 'string'
    ? value.value
    : undefined
}

function isIntrinsic(tagName: string): boolean {
  return tagName[0] === tagName[0]?.toLowerCase()
}

function isInteractive(node: JsxOpeningElement): boolean {
  const tagName = node.name.name
  const names = node.attributes
    .filter((candidate): candidate is JsxAttribute => isJsxAttribute(candidate))
    .map((candidate) => candidate.name.name)
  const role = stringAttribute(node, 'role')
  return (
    nativeInteractiveTags.has(tagName) ||
    ((tagName === 'audio' || tagName === 'video') && names.includes('controls')) ||
    names.some((name) => interactiveHandlers.has(name)) ||
    (role !== undefined && interactiveRoles.has(role))
  )
}

function allowlistKey(
  file: string,
  node: JsxOpeningElement,
): string {
  return `${file}::${node.name.name}::${stringAttribute(node, 'className') ?? ''}`
}

function scanSource() {
  const interactions: SourceInteraction[] = []
  const missing: string[] = []
  const encounteredAllowlist = new Set<string>()
  const allowlist = new Set(allowlistedInteractions.map(({ key }) => key))

  for (const absoluteFile of sourceFiles(sourceRoot)) {
    const text = readFileSync(absoluteFile, 'utf8')
    const relativeFile = path.relative(sourceRoot, absoluteFile).replaceAll('\\', '/')
    const sourceFile = parseForESLint(text, {
      filePath: absoluteFile,
      jsx: true,
      loc: true,
    }).ast

    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (!isAstNode(value)) return

      if (isOpeningElement(value) && isIntrinsic(value.name.name) && isInteractive(value)) {
        const line = value.loc?.start.line ?? 0
        const key = allowlistKey(relativeFile, value)
        if (allowlist.has(key)) {
          encounteredAllowlist.add(key)
        } else {
          const id = stringAttribute(value, 'data-interaction')
          if (id) {
            interactions.push({ id, file: relativeFile, line })
          } else {
            missing.push(`${relativeFile}:${line} <${value.name.name}>`)
          }
        }
      }

      Object.entries(value).forEach(([key, child]) => {
        if (key !== 'parent' && key !== 'loc' && key !== 'range') visit(child)
      })
    }

    visit(sourceFile)
  }

  return { interactions, missing, encounteredAllowlist }
}

describe('interaction coverage contract', () => {
  const source = scanSource()
  const manifestIds = interactionManifest.map(({ id }) => id)
  const sourceIds = new Set(source.interactions.map(({ id }) => id))

  it('identifies every real source interaction', () => {
    expect(source.missing).toEqual([])
    expect(source.encounteredAllowlist).toEqual(
      new Set(allowlistedInteractions.map(({ key }) => key)),
    )
  })

  it('keeps manifest ids unique and bidirectionally registered', () => {
    expect(new Set(manifestIds).size).toBe(manifestIds.length)
    expect([...sourceIds].sort()).toEqual([...manifestIds].sort())
  })

  it('links every interaction to an existing behavior spec coverage marker', () => {
    const deadLinks = interactionManifest.flatMap(({ id, behaviorSpec }) => {
      const absoluteSpec = path.resolve(webRoot, behaviorSpec)
      if (!existsSync(absoluteSpec)) return [`${id}: missing ${behaviorSpec}`]
      return readFileSync(absoluteSpec, 'utf8').includes(id)
        ? []
        : [`${id}: no coverage marker in ${behaviorSpec}`]
    })
    expect(deadLinks).toEqual([])
  })

  it('requires concrete user-visible outcome descriptions', () => {
    const vagueOutcomes = interactionManifest
      .filter(({ outcome }) => {
        const normalized = outcome.trim()
        return normalized.length < 20 || /^(works|handles interaction|updates state)\.?$/i.test(normalized)
      })
      .map(({ id }) => id)
    expect(vagueOutcomes).toEqual([])
  })
})

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

interface SpecCoverage {
  ids: Set<string>
  violations: string[]
}

function nodeChildren(node: AstNode): unknown[] {
  return Object.entries(node)
    .filter(([key]) => !['parent', 'loc', 'range'].includes(key))
    .map(([, child]) => child)
}

function visitAst(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    value.forEach((child) => visitAst(child, visit))
    return
  }
  if (!isAstNode(value)) return
  visit(value)
  nodeChildren(value).forEach((child) => visitAst(child, visit))
}

function callRootName(value: unknown): string | undefined {
  if (!isAstNode(value)) return undefined
  if (value.type === 'Identifier' && typeof value.name === 'string') return value.name
  if (value.type === 'MemberExpression') return callRootName(value.object)
  if (value.type === 'CallExpression') return callRootName(value.callee)
  return undefined
}

function callArguments(node: AstNode): unknown[] {
  return node.type === 'CallExpression' && Array.isArray(node.arguments) ? node.arguments : []
}

function callMembers(value: unknown): string[] {
  if (!isAstNode(value)) return []
  if (value.type === 'MemberExpression') {
    const property =
      isAstNode(value.property) &&
      value.property.type === 'Identifier' &&
      typeof value.property.name === 'string'
        ? [value.property.name]
        : []
    return [...callMembers(value.object), ...property]
  }
  if (value.type === 'CallExpression') return callMembers(value.callee)
  return []
}

function isFunctionNode(value: unknown): value is AstNode {
  return (
    isAstNode(value) &&
    ['ArrowFunctionExpression', 'FunctionExpression'].includes(value.type)
  )
}

function visitDirectCallback(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    value.forEach((child) => visitDirectCallback(child, visit))
    return
  }
  if (!isAstNode(value) || isFunctionNode(value)) return
  visit(value)
  nodeChildren(value).forEach((child) => visitDirectCallback(child, visit))
}

function scanBehaviorSpecText(text: string, absoluteFile: string): SpecCoverage {
  const sourceFile = parseForESLint(text, {
    filePath: absoluteFile,
    jsx: true,
    loc: true,
  }).ast
  const ids = new Set<string>()
  const violations: string[] = []
  const allCoverageLines = new Set<number>()
  const testCoverageLines = new Set<number>()

  visitAst(sourceFile, (node) => {
    if (
      node.type === 'CallExpression' &&
      callRootName(node.callee) === 'coversInteractions'
    ) {
      allCoverageLines.add(node.loc?.start.line ?? 0)
    }

    if (
      node.type !== 'CallExpression' ||
      !['it', 'test'].includes(callRootName(node.callee) ?? '') ||
      callMembers(node.callee).some((member) => ['skip', 'todo'].includes(member))
    ) {
      return
    }

    const callback = callArguments(node).find(isFunctionNode)
    if (!callback) return
    let hasAssertion = false
    const coverageCalls: AstNode[] = []

    visitAst(callback, (candidate) => {
      if (candidate.type !== 'CallExpression') return
      const name = callRootName(candidate.callee)
      if (name === 'expect') hasAssertion = true
    })
    visitDirectCallback(callback.body, (candidate) => {
      if (
        candidate.type === 'CallExpression' &&
        callRootName(candidate.callee) === 'coversInteractions'
      ) {
        coverageCalls.push(candidate)
      }
    })

    for (const coverageCall of coverageCalls) {
      const line = coverageCall.loc?.start.line ?? 0
      testCoverageLines.add(line)
      if (!hasAssertion) {
        violations.push(`${path.relative(webRoot, absoluteFile)}:${line}: no expect in test callback`)
        continue
      }
      for (const argument of callArguments(coverageCall)) {
        if (
          isAstNode(argument) &&
          argument.type === 'Literal' &&
          typeof argument.value === 'string'
        ) {
          ids.add(argument.value)
        } else {
          violations.push(
            `${path.relative(webRoot, absoluteFile)}:${line}: interaction id must be a string literal`,
          )
        }
      }
    }
  })

  for (const line of allCoverageLines) {
    if (!testCoverageLines.has(line)) {
      violations.push(
        `${path.relative(webRoot, absoluteFile)}:${line}: coversInteractions is outside it/test`,
      )
    }
  }

  return { ids, violations }
}

function scanBehaviorSpec(absoluteFile: string): SpecCoverage {
  return scanBehaviorSpecText(readFileSync(absoluteFile, 'utf8'), absoluteFile)
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

  it('links every interaction to an asserted executable behavior test', () => {
    const scans = new Map<string, SpecCoverage>()
    const deadLinks = interactionManifest.flatMap(({ id, behaviorSpec }) => {
      const absoluteSpec = path.resolve(webRoot, behaviorSpec)
      if (!existsSync(absoluteSpec)) return [`${id}: missing ${behaviorSpec}`]
      const scan =
        scans.get(behaviorSpec) ??
        (() => {
          const result = scanBehaviorSpec(absoluteSpec)
          scans.set(behaviorSpec, result)
          return result
        })()
      return scan.ids.has(id)
        ? []
        : [`${id}: no asserted coversInteractions call in ${behaviorSpec}`]
    })
    const violations = [...scans.values()].flatMap(({ violations: invalid }) => invalid)
    const wrongSpec = [...scans.entries()].flatMap(([behaviorSpec, scan]) =>
      [...scan.ids]
        .filter(
          (id) =>
            !interactionManifest.some(
              (entry) => entry.id === id && entry.behaviorSpec === behaviorSpec,
            ),
        )
        .map((id) => `${id}: registered in the wrong behavior spec ${behaviorSpec}`),
    )
    expect([...deadLinks, ...violations, ...wrongSpec]).toEqual([])
  })

  it('rejects non-executable interaction coverage declarations', () => {
    const cases = [
      `coversInteractions('app.skip-to-composer')`,
      `it.skip('skipped', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it('nested', () => {
        const neverCalled = () => coversInteractions('app.skip-to-composer')
        expect(neverCalled).toBeTypeOf('function')
      })`,
    ]
    const scans = cases.map((code, index) =>
      scanBehaviorSpecText(code, path.resolve(webRoot, `invalid-coverage-${index}.tsx`)),
    )
    expect(scans.map(({ ids }) => [...ids])).toEqual([[], [], []])
    expect(scans.map(({ violations }) => violations.length)).toEqual([1, 1, 1])
  })

  it('links related E2E metadata only to existing specs', () => {
    const deadLinks = interactionManifest.flatMap(({ id, relatedE2e }) => {
      if (!relatedE2e) return []
      return existsSync(path.resolve(webRoot, relatedE2e))
        ? []
        : [`${id}: missing ${relatedE2e}`]
    })
    expect(deadLinks).toEqual([])
  })

  it('keeps accessibility exemptions narrow, explicit, and actionable', () => {
    const invalid = interactionManifest.flatMap(
      ({ id, expectedName, expectedRole, accessibilityExemption }) => {
        if (!accessibilityExemption) {
          return expectedName.trim() ? [] : [`${id}: empty name without exemption`]
        }
        const problems: string[] = []
        if (expectedName.trim()) problems.push(`${id}: exempt interaction invents a name`)
        if (!['none', 'presentation'].includes(expectedRole)) {
          problems.push(`${id}: exempt role ${expectedRole} is not narrow`)
        }
        if (accessibilityExemption.reason.trim().length < 20) {
          problems.push(`${id}: exemption reason is not concrete`)
        }
        if (accessibilityExemption.alternativeInteractionIds.length === 0) {
          problems.push(`${id}: exemption has no alternative interaction`)
        }
        for (const alternativeId of accessibilityExemption.alternativeInteractionIds) {
          if (alternativeId === id || !manifestIds.includes(alternativeId)) {
            problems.push(`${id}: invalid alternative ${alternativeId}`)
          }
        }
        return problems
      },
    )
    expect(invalid).toEqual([])
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

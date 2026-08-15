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
    const property = value.computed
      ? isAstNode(value.property) &&
        value.property.type === 'Literal' &&
        typeof value.property.value === 'string'
        ? [value.property.value]
        : ['[computed]']
      : isAstNode(value.property) &&
          value.property.type === 'Identifier' &&
          typeof value.property.name === 'string'
        ? [value.property.name]
        : ['[computed]']
    return [...callMembers(value.object), ...property]
  }
  if (value.type === 'CallExpression') return callMembers(value.callee)
  return []
}

function hasConditionalCallChain(value: unknown): boolean {
  if (!isAstNode(value)) return false
  if (value.type === 'ChainExpression' || value.optional === true) return true
  if (value.type === 'MemberExpression' || value.type === 'CallExpression') {
    return hasConditionalCallChain(value.object) || hasConditionalCallChain(value.callee)
  }
  return false
}

interface FunctionAstNode extends AstNode {
  type: 'ArrowFunctionExpression' | 'FunctionExpression' | 'FunctionDeclaration'
}

function isFunctionNode(value: unknown): value is FunctionAstNode {
  return (
    isAstNode(value) &&
    ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(
      value.type,
    )
  )
}

function isExecutableCallback(value: unknown): value is FunctionAstNode {
  return (
    isFunctionNode(value) &&
    value.type !== 'FunctionDeclaration' &&
    value.generator !== true
  )
}

interface TestInvocation {
  callback: FunctionAstNode
  options: unknown[]
}

function isStaticTestName(value: unknown): boolean {
  return (
    (isAstNode(value) &&
      value.type === 'Literal' &&
      typeof value.value === 'string') ||
    (isAstNode(value) &&
      value.type === 'TemplateLiteral' &&
      Array.isArray(value.expressions) &&
      value.expressions.length === 0)
  )
}

function testInvocation(node: AstNode): TestInvocation | undefined {
  const args = callArguments(node)
  if (!isStaticTestName(args[0])) return undefined
  const callbackIndex = args.findIndex(
    (argument, index) => index > 0 && isExecutableCallback(argument),
  )
  if (callbackIndex < 0) return undefined
  return {
    callback: args[callbackIndex] as FunctionAstNode,
    options: args.slice(1, callbackIndex),
  }
}

function propertyName(value: unknown): string | undefined {
  if (!isAstNode(value)) return undefined
  if (value.type === 'Identifier' && typeof value.name === 'string') return value.name
  if (value.type === 'Literal' && typeof value.value === 'string') return value.value
  return undefined
}

function hasConditionalOptions(options: unknown[]): boolean {
  return options.some((option) => {
    if (!isAstNode(option) || option.type !== 'ObjectExpression') return true
    if (!Array.isArray(option.properties)) return true
    return option.properties.some((property) => {
      if (!isAstNode(property) || property.type !== 'Property') return true
      const key = propertyName(property.key)
      return (
        !key ||
        ['skip', 'todo', 'skipIf', 'runIf'].includes(key) ||
        property.computed === true
      )
    })
  })
}

function unwrapStaticExpression(value: unknown): AstNode | undefined {
  if (!isAstNode(value)) return undefined
  if (
    ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(value.type) &&
    isAstNode(value.expression)
  ) {
    return unwrapStaticExpression(value.expression)
  }
  return value
}

function hasProvablyNonEmptyEachData(value: unknown): boolean {
  if (!isAstNode(value)) return false
  if (
    value.type === 'CallExpression' &&
    callMembers(value.callee).includes('each')
  ) {
    const data = unwrapStaticExpression(callArguments(value)[0])
    return (
      data?.type === 'ArrayExpression' &&
      Array.isArray(data.elements) &&
      data.elements.length > 0 &&
      data.elements.every(
        (element) => isAstNode(element) && element.type !== 'SpreadElement',
      )
    )
  }
  if (value.type === 'CallExpression' || value.type === 'MemberExpression') {
    return (
      hasProvablyNonEmptyEachData(value.callee) ||
      hasProvablyNonEmptyEachData(value.object)
    )
  }
  return false
}

function isIdentifierCall(node: AstNode, name: string): boolean {
  return (
    node.type === 'CallExpression' &&
    isAstNode(node.callee) &&
    node.callee.type === 'Identifier' &&
    node.callee.name === name
  )
}

function directStatements(callback: AstNode): AstNode[] {
  return (
    isAstNode(callback.body) &&
    callback.body.type === 'BlockStatement' &&
    Array.isArray(callback.body.body)
  )
    ? callback.body.body.filter(isAstNode)
    : []
}

function directCoverageCalls(callback: AstNode): AstNode[] {
  const calls: AstNode[] = []
  for (const statement of directStatements(callback)) {
    const expression =
      statement.type === 'ExpressionStatement' && isAstNode(statement.expression)
        ? statement.expression
        : undefined
    if (!expression || !isIdentifierCall(expression, 'coversInteractions')) break
    calls.push(expression)
  }
  return calls
}

function containsCallOutsideNestedFunctions(value: unknown, name: string): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsCallOutsideNestedFunctions(child, name))
  }
  if (
    !isAstNode(value) ||
    isFunctionNode(value) ||
    [
      'LogicalExpression',
      'ConditionalExpression',
      'ChainExpression',
      'ClassExpression',
      'ClassDeclaration',
    ].includes(value.type) ||
    value.optional === true
  ) {
    return false
  }
  if (isIdentifierCall(value, name)) return true
  return nodeChildren(value).some((child) =>
    containsCallOutsideNestedFunctions(child, name),
  )
}

const assertionHelpers = new Set(['waitFor', 'waitForElementToBeRemoved'])

function unwrapAwait(value: unknown): AstNode | undefined {
  if (!isAstNode(value)) return undefined
  if (value.type === 'AwaitExpression' && isAstNode(value.argument)) {
    return value.argument
  }
  return value
}

const executionBarriers = new Set([
  'ReturnStatement',
  'ThrowStatement',
  'IfStatement',
  'SwitchStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'TryStatement',
])

function statementExpression(statement: AstNode): AstNode | undefined {
  if (statement.type === 'ExpressionStatement' && isAstNode(statement.expression)) {
    return statement.expression
  }
  if (statement.type === 'ReturnStatement' && isAstNode(statement.argument)) {
    return statement.argument
  }
  return undefined
}

function directHelperHasAssertion(value: unknown): boolean {
  const call = unwrapAwait(value)
  if (
    !call ||
    call.type !== 'CallExpression' ||
    !isAstNode(call.callee) ||
    call.callee.type !== 'Identifier' ||
    !assertionHelpers.has(call.callee.name as string)
  ) {
    return false
  }
  return callArguments(call)
    .filter(isExecutableCallback)
    .some((callback) => hasReachableAssertion(callback, false))
}

function hasReachableAssertion(
  callback: AstNode,
  allowAssertionHelpers = true,
): boolean {
  if (!isAstNode(callback.body)) return false
  if (callback.body.type !== 'BlockStatement') {
    return containsCallOutsideNestedFunctions(callback.body, 'expect')
  }
  for (const statement of directStatements(callback)) {
    const expression = statementExpression(statement)
    if (
      expression &&
      (containsCallOutsideNestedFunctions(expression, 'expect') ||
        (allowAssertionHelpers && directHelperHasAssertion(expression)))
    ) {
      return true
    }
    if (executionBarriers.has(statement.type)) return false
  }
  return false
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
  })

  const conditionalNodes = new Set([
    'IfStatement',
    'SwitchStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'TryStatement',
    'ConditionalExpression',
    'LogicalExpression',
  ])
  const executableModifiers = new Set([
    'only',
    'concurrent',
    'sequential',
    'shuffle',
    'fails',
    'each',
  ])

  const scanExecutionTree = (value: unknown, blocked = false): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => scanExecutionTree(child, blocked))
      return
    }
    if (!isAstNode(value) || isFunctionNode(value)) return

    if (value.type === 'CallExpression') {
      const root = callRootName(value.callee)
      const members = callMembers(value.callee)
      const invocation = testInvocation(value)
      const callback = invocation?.callback
      const invalidOptions = invocation
        ? hasConditionalOptions(invocation.options)
        : true
      const invalidEach =
        members.includes('each') && !hasProvablyNonEmptyEachData(value.callee)

      if (root && ['describe', 'suite'].includes(root)) {
        if (callback) {
          scanExecutionTree(
            callback.body,
            blocked ||
              invalidOptions ||
              invalidEach ||
              hasConditionalCallChain(value.callee) ||
              members.some((member) => !executableModifiers.has(member)),
          )
        }
        return
      }

      if (root && ['it', 'test'].includes(root)) {
        if (
          !blocked &&
          callback &&
          !invalidOptions &&
          !invalidEach &&
          !hasConditionalCallChain(value.callee) &&
          !members.some((member) => !executableModifiers.has(member))
        ) {
          const coverageCalls = directCoverageCalls(callback)
          const hasAssertion = hasReachableAssertion(callback)

          for (const coverageCall of coverageCalls) {
            const line = coverageCall.loc?.start.line ?? 0
            testCoverageLines.add(line)
            if (!hasAssertion) {
              violations.push(
                `${path.relative(webRoot, absoluteFile)}:${line}: no reachable expect in test callback`,
              )
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
        }
        return
      }
    }

    const childBlocked = blocked || conditionalNodes.has(value.type)
    nodeChildren(value).forEach((child) => scanExecutionTree(child, childBlocked))
  }

  scanExecutionTree(sourceFile)

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

function wrongBehaviorSpecIds(behaviorSpec: string, ids: ReadonlySet<string>): string[] {
  return [...ids].filter(
    (id) =>
      !interactionManifest.some(
        (entry) => entry.id === id && entry.behaviorSpec === behaviorSpec,
      ),
  )
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
      wrongBehaviorSpecIds(behaviorSpec, scan.ids)
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
      `test.todo('todo', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `describe.skip('skipped suite', () => {
        it('nested test', () => {
          coversInteractions('app.skip-to-composer')
          expect(true).toBe(true)
        })
      })`,
      `suite.skip('skipped suite', () => {
        test('nested test', () => {
          coversInteractions('app.skip-to-composer')
          expect(true).toBe(true)
        })
      })`,
      `it.skipIf(true)('conditional skip', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it.skipIf(false)('conditional skip', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it.runIf(false)('conditional run', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it.runIf(true)('conditional run', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it('conditional declaration', () => {
        if (false) {
          coversInteractions('app.skip-to-composer')
        }
        expect(true).toBe(true)
      })`,
      `it('nested', () => {
        const neverCalled = () => coversInteractions('app.skip-to-composer')
        expect(neverCalled).toBeTypeOf('function')
      })`,
      `it('nested assertion', () => {
        coversInteractions('app.skip-to-composer')
        const neverCalled = () => expect(true).toBe(true)
        void neverCalled
      })`,
      `it('conditional assertion', () => {
        coversInteractions('app.skip-to-composer')
        false && expect(true).toBe(true)
      })`,
      `it['skip']('computed skip', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `describe['skip']('computed skipped suite', () => {
        it('nested test', () => {
          coversInteractions('app.skip-to-composer')
          expect(true).toBe(true)
        })
      })`,
      `it('early return', () => {
        return
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it('optional assertion', () => {
        coversInteractions('app.skip-to-composer')
        gate.run?.(expect(true).toBe(true))
      })`,
      `it('bound helper', () => {
        coversInteractions('app.skip-to-composer')
        waitFor.bind(null, () => expect(true).toBe(true))
      })`,
      `it('generator helper callback', async () => {
        coversInteractions('app.skip-to-composer')
        await waitFor(function* () {
          expect(true).toBe(true)
        })
      })`,
      `it('skipped options', { skip: true }, () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `describe('skipped options suite', { skip: true }, () => {
        it('nested test', () => {
          coversInteractions('app.skip-to-composer')
          expect(true).toBe(true)
        })
      })`,
      `it(
        function neverExecutedName() {
          coversInteractions('app.skip-to-composer')
          expect(true).toBe(true)
        },
        () => expect(true).toBe(true),
      )`,
      `it('generator callback', function* () {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it.each([])('empty parameterization', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it('deferred class assertion', () => {
        coversInteractions('app.skip-to-composer')
        void class {
          result = expect(true).toBe(true)
        }
      })`,
      `it('non-literal', () => {
        const id = 'app.skip-to-composer'
        coversInteractions(id)
        expect(true).toBe(true)
      })`,
    ]
    const scans = cases.map((code, index) =>
      scanBehaviorSpecText(code, path.resolve(webRoot, `invalid-coverage-${index}.tsx`)),
    )
    expect(scans.every(({ ids }) => ids.size === 0)).toBe(true)
    expect(scans.every(({ violations }) => violations.length >= 1)).toBe(true)
  })

  it('accepts direct coverage in unconditional test variants with reachable assertions', () => {
    const cases = [
      `it('ordinary', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `test('ordinary', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it.each([1])('parameterized %s', () => {
        coversInteractions('app.skip-to-composer')
        expect(true).toBe(true)
      })`,
      `it('async helper', async () => {
        coversInteractions('app.skip-to-composer')
        await waitFor(() => expect(true).toBe(true))
      })`,
    ]
    const scans = cases.map((code, index) =>
      scanBehaviorSpecText(code, path.resolve(webRoot, `valid-coverage-${index}.tsx`)),
    )
    expect(scans.map(({ ids }) => [...ids])).toEqual(
      cases.map(() => ['app.skip-to-composer']),
    )
    expect(scans.every(({ violations }) => violations.length === 0)).toBe(true)

    const wrongSpec = scanBehaviorSpecText(
      cases[0],
      path.resolve(webRoot, 'src/auth/AuthBar.test.tsx'),
    )
    expect(wrongBehaviorSpecIds('src/auth/AuthBar.test.tsx', wrongSpec.ids)).toEqual([
      'app.skip-to-composer',
    ])
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

import type { Page, TestInfo } from '@playwright/test'
import {
  interactionManifest,
  type InteractionManifestEntry,
} from '../../src/test/interactionManifest'

const interactiveSelector = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'audio[controls]',
  'video[controls]',
  '[role="application"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[data-interaction]',
].join(', ')

export interface InteractionCoverageReport {
  coveredFamilies: string[]
  coveredInteractionCount: number
  coveredInteractions: string[]
  familyCoveragePercent: number
  interactionCoveragePercent: number
  missingFamilies: string[]
  missingInteractions: string[]
  totalFamilyCount: number
  totalInteractionCount: number
  untaggedRenderedControls: string[]
  unknownRenderedIds: string[]
}

export function interactionFamily(entry: InteractionManifestEntry): string {
  return entry.id.split('.').slice(0, 2).join('.')
}

export async function collectRenderedInteractionIds(
  page: Page,
): Promise<{
  registered: Set<string>
  unknown: Set<string>
  untagged: Set<string>
}> {
  const manifestIds = new Set(interactionManifest.map(({ id }) => id))
  const rendered = await page.locator(interactiveSelector).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = getComputedStyle(element)
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getAttribute('aria-hidden') !== 'true'
        )
      })
      .map((element) => ({
        id: element.getAttribute('data-interaction'),
        description: [
          element.tagName.toLowerCase(),
          element.getAttribute('role'),
          element.getAttribute('aria-label') ??
            element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80),
        ]
          .filter(Boolean)
          .join(' | '),
      })),
  )
  const ids = rendered.flatMap(({ id }) => (id ? [id] : []))

  return {
    registered: new Set(ids.filter((id) => manifestIds.has(id))),
    unknown: new Set(ids.filter((id) => !manifestIds.has(id))),
    untagged: new Set(
      rendered.flatMap(({ id, description }) => (id ? [] : [description])),
    ),
  }
}

export function buildInteractionCoverageReport(
  observedIds: ReadonlySet<string>,
  unknownIds: ReadonlySet<string> = new Set(),
  untaggedControls: ReadonlySet<string> = new Set(),
): InteractionCoverageReport {
  const allIds = interactionManifest.map(({ id }) => id).sort()
  const allFamilies = [
    ...new Set(interactionManifest.map(interactionFamily)),
  ].sort()
  const coveredInteractions = allIds.filter((id) => observedIds.has(id))
  const coveredFamilySet = new Set(
    interactionManifest
      .filter(({ id }) => observedIds.has(id))
      .map(interactionFamily),
  )
  const coveredFamilies = allFamilies.filter((family) =>
    coveredFamilySet.has(family),
  )

  return {
    coveredFamilies,
    coveredInteractionCount: coveredInteractions.length,
    coveredInteractions,
    familyCoveragePercent:
      allFamilies.length === 0
        ? 100
        : (coveredFamilies.length / allFamilies.length) * 100,
    interactionCoveragePercent:
      allIds.length === 0
        ? 100
        : (coveredInteractions.length / allIds.length) * 100,
    missingFamilies: allFamilies.filter(
      (family) => !coveredFamilySet.has(family),
    ),
    missingInteractions: allIds.filter((id) => !observedIds.has(id)),
    totalFamilyCount: allFamilies.length,
    totalInteractionCount: allIds.length,
    untaggedRenderedControls: [...untaggedControls].sort(),
    unknownRenderedIds: [...unknownIds].sort(),
  }
}

export async function writeInteractionCoverageReport(
  report: InteractionCoverageReport,
  testInfo: TestInfo,
): Promise<void> {
  const body = Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
  await testInfo.attach('interaction-manifest-report', {
    body,
    contentType: 'application/json',
  })
}

import { expect, type Page } from '@playwright/test'

export interface RegionGeometry {
  bottom: number
  height: number
  left: number
  right: number
  scrollHeight: number
  scrollWidth: number
  top: number
  width: number
}

export interface GeometryReport {
  document: {
    height: number
    width: number
  }
  regions: Record<string, RegionGeometry | null>
  viewport: {
    height: number
    width: number
  }
}

export async function collectGeometryReport(
  page: Page,
  regions: Record<string, string>,
): Promise<GeometryReport> {
  return page.evaluate((selectors) => {
    const measured = Object.fromEntries(
      Object.entries(selectors).map(([name, selector]) => {
        const element = document.querySelector(selector)
        if (!(element instanceof HTMLElement)) return [name, null]
        const box = element.getBoundingClientRect()
        return [
          name,
          {
            bottom: box.bottom,
            height: box.height,
            left: box.left,
            right: box.right,
            scrollHeight: element.scrollHeight,
            scrollWidth: element.scrollWidth,
            top: box.top,
            width: box.width,
          },
        ]
      }),
    )

    return {
      document: {
        height: document.documentElement.scrollHeight,
        width: document.documentElement.scrollWidth,
      },
      regions: measured,
      viewport: {
        height: innerHeight,
        width: innerWidth,
      },
    }
  }, regions)
}

export function assertDesktopViewportGeometry(
  report: GeometryReport,
  editorRegion: string,
): void {
  expect(report.document.height).toBeLessThanOrEqual(report.viewport.height + 1)
  expect(report.document.width).toBeLessThanOrEqual(report.viewport.width + 1)

  const editor = report.regions[editorRegion]
  expect(editor, `${editorRegion} geometry is missing`).not.toBeNull()
  if (!editor) return
  expect(editor.top).toBeGreaterThanOrEqual(0)
  expect(editor.left).toBeGreaterThanOrEqual(0)
  expect(editor.bottom).toBeLessThanOrEqual(report.viewport.height + 1)
  expect(editor.right).toBeLessThanOrEqual(report.viewport.width + 1)
}

import { expect, type Locator, type Page } from '@playwright/test'

export interface FocusStep {
  interactionId: string | null
  role: string | null
  name: string
  tag: string
}

async function focusedStep(page: Page): Promise<FocusStep> {
  return page.evaluate(() => {
    const element = document.activeElement
    if (!(element instanceof HTMLElement)) {
      return { interactionId: null, role: null, name: '', tag: 'none' }
    }
    const labelledBy = element.getAttribute('aria-labelledby')
    const labelledText = labelledBy
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
    return {
      interactionId: element.getAttribute('data-interaction'),
      role: element.getAttribute('role'),
      name:
        element.getAttribute('aria-label') ??
        labelledText ??
        element.textContent?.trim() ??
        '',
      tag: element.tagName.toLowerCase(),
    }
  })
}

async function targetContainsFocus(target: Locator): Promise<boolean> {
  return target.evaluate(
    (element) =>
      element === document.activeElement ||
      element.contains(document.activeElement),
  )
}

export async function tabTo(
  page: Page,
  target: Locator,
  options: { backwards?: boolean; maxTabs?: number } = {},
): Promise<FocusStep[]> {
  const trace: FocusStep[] = []
  const key = options.backwards ? 'Shift+Tab' : 'Tab'
  const maxTabs = options.maxTabs ?? 80

  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press(key)
    trace.push(await focusedStep(page))
    if (await targetContainsFocus(target)) return trace
  }

  throw new Error(
    `Keyboard focus did not reach the target after ${maxTabs} tabs.\n${JSON.stringify(
      trace,
      null,
      2,
    )}`,
  )
}

export async function activateFocused(
  page: Page,
  key: 'Enter' | 'Space' = 'Enter',
): Promise<void> {
  await page.keyboard.press(key)
}

export async function expectVisibleFocusIndicator(
  locator: Locator,
): Promise<void> {
  await expect(locator).toBeFocused()
  const visible = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const outlineWidth = Number.parseFloat(style.outlineWidth)
    const hasOutline =
      style.outlineStyle !== 'none' &&
      Number.isFinite(outlineWidth) &&
      outlineWidth > 0
    const hasBoxShadow = style.boxShadow !== 'none'
    return hasOutline || hasBoxShadow
  })
  expect(visible, 'focused control must expose an outline or box-shadow').toBe(
    true,
  )
}

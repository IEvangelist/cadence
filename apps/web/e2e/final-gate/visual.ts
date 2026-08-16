import { expect, type Page } from '@playwright/test'

export async function waitForStableCapture(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve()),
      ),
    )
  })
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

  const play = page.locator('[data-interaction="studio.transport.play"]')
  if ((await play.count()) > 0) {
    await expect(play).toHaveAttribute('aria-pressed', 'false')
  }
}

export async function expectStableScreenshot(
  page: Page,
  name: string,
  options: { mask?: ReturnType<Page['locator']>[] } = {},
): Promise<void> {
  await waitForStableCapture(page)
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
    mask: options.mask ?? [],
    scale: 'css',
  })
}

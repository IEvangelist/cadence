import { expect, type Locator, type Page } from '@playwright/test'

export async function openStudioDestination(
  page: Page,
  name: 'Stems' | 'Pricing' | 'Third-party licenses',
): Promise<void> {
  await page.getByRole('button', { name: 'Help' }).click()
  await page.getByRole('menuitem', { name }).click()
}

export async function openInspectorPanel(
  page: Page,
  tabName: 'Track' | 'Assistant' | 'AI Studio' | 'Extensions',
): Promise<Locator> {
  const inspector = page.getByRole('button', { name: 'Inspector' })
  if ((await inspector.getAttribute('aria-expanded')) !== 'true') await inspector.click()
  await page.getByRole('tab', { name: tabName, exact: true }).click()
  const panel = page.getByRole('tabpanel')
  await expect(panel).toBeVisible()
  return panel
}

export async function openMixWorkspace(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Mix', exact: true }).click()
  const mixer = page.getByRole('region', { name: 'Mixer' })
  await expect(mixer).toBeVisible()
  return mixer
}

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
  tabName: 'Track' | 'AI' | 'Extensions',
): Promise<Locator> {
  const inspector = page.getByRole('button', { name: 'Inspector' })
  if ((await inspector.getAttribute('aria-expanded')) !== 'true') await inspector.click()
  const tab = page.getByRole('tab', { name: tabName, exact: true })
  await tab.click()
  const panelId = await tab.getAttribute('aria-controls')
  if (!panelId) throw new Error(`${tabName} tab does not identify its panel`)
  const panel = page.locator(`[id="${panelId}"]`)
  await expect(panel).toBeVisible()
  return panel
}

export async function openAiInspectorMode(
  page: Page,
  mode: 'Basic' | 'Advanced',
): Promise<Locator> {
  const panel = await openInspectorPanel(page, 'AI')
  await panel.getByRole('tab', { name: mode, exact: true }).click()
  return panel
}

export async function openMixWorkspace(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Mix', exact: true }).click()
  const mixer = page.getByRole('region', { name: 'Mixer' })
  await expect(mixer).toBeVisible()
  return mixer
}

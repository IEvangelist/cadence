import type { Page } from '@playwright/test'

export async function createBlankProject(page: Page): Promise<void> {
  const startCenterBlank = page.getByRole('button', { name: /Blank project/ })
  const projectMenu = page.getByRole('button', { name: 'Project', exact: true })
  await startCenterBlank.or(projectMenu).first().waitFor({ state: 'visible' })
  if (await startCenterBlank.isVisible().catch(() => false)) {
    await startCenterBlank.click()
    return
  }
  await projectMenu.click()
  await page.getByRole('menuitem', { name: 'New project' }).click()
  await page.getByRole('button', { name: /Blank project/ }).click()
}

export async function chooseExport(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Export & share' }).click()
  await page.getByRole('menuitem', { name }).click()
}

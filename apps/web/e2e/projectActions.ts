import type { Page } from '@playwright/test'

export async function createBlankProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New project' }).click()
  await page.getByRole('button', { name: /Blank project/ }).click()
}

export async function chooseExport(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Export & share' }).click()
  await page.getByRole('menuitem', { name }).click()
}

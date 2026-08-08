import { test, expect } from '@playwright/test'

// Smoke: the production build boots and the app shell renders. If the SPA fails
// to compile or mount, `vite preview` serves an empty root and these fail.
test.describe('smoke', () => {
  test('serves the built SPA and renders the app shell', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('Cadence')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Cadence' }),
    ).toBeVisible()
    await expect(
      page.getByText('AI-powered, cross-platform music studio'),
    ).toBeVisible()
  })

  test('mounts into the React root element', async ({ page }) => {
    await page.goto('/')

    // main.tsx mounts into #root; a non-empty root proves hydration succeeded.
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.locator('main.app')).toBeVisible()
  })
})

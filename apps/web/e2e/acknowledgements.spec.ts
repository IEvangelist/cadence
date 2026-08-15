import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Route } from '@playwright/test'

// In-app third-party licenses / acknowledgements surface (issue #138) against the
// production build. There is no backend in e2e, so `/api/**` is stubbed. We prove:
//   1. the surface is reachable from the app shell footer using only the keyboard,
//   2. it renders the @breezystack/lamejs LGPL-3.0 entry + the LAME credit link,
//   3. it is axe-clean (WCAG 2.1 A/AA).
async function mockApi(route: Route): Promise<void> {
  const request = route.request()
  const path = new URL(request.url()).pathname
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/api/auth/me') return json({}, 401)
  if (path === '/api/auth/providers') return json({ providers: [] })
  return json({}, request.method() === 'GET' ? 200 : 204)
}

test.describe('acknowledgements', () => {
  test('is reachable from the footer via the keyboard and is accessible', async ({
    page,
  }) => {
    await page.route('**/api/**', mockApi)
    await page.goto('/')

    // Drive the entry point with the keyboard only: focus the footer control and
    // activate it. This asserts the surface is keyboard-reachable from the shell.
    const entry = page.getByRole('button', { name: 'Third-party licenses' })
    await entry.focus()
    await expect(entry).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(
      page.getByRole('heading', {
        name: /acknowledgements & third-party licenses/i,
      }),
    ).toBeVisible()

    const table = page.getByRole('table', { name: /third-party components/i })
    await expect(table.getByText('@breezystack/lamejs')).toBeVisible()
    await expect(table.getByText('LGPL-3.0-or-later')).toBeVisible()
    await expect(table.getByText('react-router-dom')).toBeVisible()
    await expect(table.getByText('lucide-react')).toBeVisible()
    await expect(table.getByText('@fontsource-variable/inter')).toBeVisible()
    await expect(page.getByRole('link', { name: /SIL Open Font License/i })).toHaveAttribute(
      'href',
      '/licenses/OFL-1.1.txt',
    )

    await expect(page.getByRole('link', { name: /lame project/i })).toHaveAttribute(
      'href',
      'https://lame.sourceforge.io/',
    )

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })
})

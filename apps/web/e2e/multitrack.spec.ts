import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'

// #131 multi-track piano roll. The app boots with the demo project (a Synth track
// and a Drums track), so "Show all tracks" overlays the Drums notes as read-only,
// colour-coded context beneath the editable Synth track. This spec proves the
// overlay + legend render and — crucially — that the multi-track view has no
// axe-core WCAG violations (colour is paired with the track name, never the sole
// cue), running against the production build in a real browser.

async function dismissTour(page: Page): Promise<void> {
  const tour = page.getByTestId('onboarding-tour-root')
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss onboarding tour' }).click()
    await expect(tour).toBeHidden()
  }
}

test.describe('composer multi-track view (#131)', () => {
  test('overlays colour-coded tracks with a legend and stays a11y-clean', async ({
    page,
  }) => {
    await page.goto('/')
    await dismissTour(page)

    // The demo seeds notes on the selected (Synth) track before any toggle.
    await expect(page.locator('.pr-note').first()).toBeVisible()
    await expect(page.locator('.pr-note.is-ghost')).toHaveCount(0)
    await expect(page.locator('.pr-legend')).toHaveCount(0)

    // Reveal every track from the persistent #156 track rail.
    await page
      .getByRole('complementary', { name: 'Track rail' })
      .getByRole('button', { name: 'Show all tracks' })
      .click()

    const legend = page.getByRole('list', { name: /Tracks shown on the piano roll/ })
    await expect(legend).toBeVisible()
    // The legend maps each colour to its track NAME and editable/read-only role.
    await expect(legend.getByText('Synth')).toBeVisible()
    await expect(legend.getByText('Drums')).toBeVisible()
    await expect(legend.getByText('(editing)')).toBeVisible()
    await expect(legend.getByText('(read-only)')).toBeVisible()

    // The other track's notes are now overlaid as ghosts, none of them focusable.
    await expect(page.locator('.pr-note.is-ghost').first()).toBeVisible()
    await expect(page.locator('button.pr-note.is-ghost')).toHaveCount(0)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })
})

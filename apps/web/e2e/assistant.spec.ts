import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'

// The AI assistant is exercised against the production build with the model
// MOCKED: `window.__CADENCE_AI_MOCK__` makes the provider factory return the
// deterministic in-process mock, so CI never downloads a Magenta checkpoint or
// touches the network. This proves the generate → preview → accept UX and that
// accepted notes land on the timeline.
test.describe('AI assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as unknown as { __CADENCE_AI_MOCK__: boolean }).__CADENCE_AI_MOCK__ = true
    })
  })

  test('generate → preview → accept inserts notes', async ({ page }) => {
    await page.goto('/')

    // Start from a clean, empty project so counts are unambiguous.
    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByText('Your canvas is empty.')).toBeVisible()

    const panel = page.getByRole('region', { name: 'AI Assistant' })
    await expect(panel).toBeVisible()

    // "Generate melody" can start from an empty region.
    await panel.getByRole('radio', { name: /Generate melody/ }).check()

    await panel.getByRole('button', { name: 'Generate' }).click()

    // Suggestion appears with ghost preview notes and accept/discard controls.
    await expect(panel.getByRole('button', { name: 'Accept' })).toBeVisible()
    await expect(page.locator('.pr-note.is-preview').first()).toBeVisible()
    const committedBefore = await page.locator('.pr-note:not(.is-preview)').count()

    // Audition should not throw (silent/real engine both fine).
    await panel.getByRole('button', { name: 'Preview' }).click()

    // Accept commits the suggestion through the reducer.
    await panel.getByRole('button', { name: 'Accept' }).click()

    await expect
      .poll(async () => page.locator('.pr-note:not(.is-preview)').count())
      .toBeGreaterThan(committedBefore)
    await expect(page.locator('.pr-note.is-preview')).toHaveCount(0)
  })

  test('is keyboard-operable', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'New' }).click()

    const panel = page.getByRole('region', { name: 'AI Assistant' })
    const generateAction = panel.getByRole('radio', { name: /Generate melody/ })

    await generateAction.focus()
    await page.keyboard.press('Space')
    await expect(generateAction).toBeChecked()

    const generate = panel.getByRole('button', { name: 'Generate' })
    await generate.focus()
    await page.keyboard.press('Enter')

    await expect(panel.getByRole('button', { name: 'Accept' })).toBeVisible()
  })

  test('assistant panel has no detectable a11y violations, idle and with a suggestion', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'New' }).click()

    const scan = () =>
      new AxeBuilder({ page })
        .include('[aria-label="AI Assistant"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

    // Idle state.
    expect((await scan()).violations).toEqual([])

    // With a pending suggestion (preview/accept/discard visible).
    const panel = page.getByRole('region', { name: 'AI Assistant' })
    await panel.getByRole('radio', { name: /Generate melody/ }).check()
    await panel.getByRole('button', { name: 'Generate' }).click()
    await expect(panel.getByRole('button', { name: 'Accept' })).toBeVisible()

    expect((await scan()).violations).toEqual([])
  })
})

import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { openInspectorPanel } from './studioActions'

// Plugin SDK end-to-end, against the production build: the reference plugin
// ("Hello Cadence") ships registered-but-disabled. Enabling it in the Extensions
// panel makes its contributions go live — here we run its "Insert a C-major
// chord" command and confirm notes land on the timeline, prove the choice
// persists across reload, and scan the new UI for accessibility violations.
test.describe('plugins / extensions', () => {
  const exampleToggle = /Hello Cadence \(example\)/

  test('enable the example plugin and run its command', async ({ page }) => {
    await page.goto('/')

    const inspector = await openInspectorPanel(page, 'Extensions')
    const panel = inspector.getByRole('region', { name: 'Extensions' })

    // The example plugin is listed and disabled; its command isn't present yet.
    const toggle = panel.getByRole('checkbox', { name: exampleToggle })
    await expect(toggle).not.toBeChecked()
    await expect(panel.getByRole('button', { name: 'Insert a C-major chord' })).toHaveCount(0)

    // Enabling it makes the contributed command go live.
    await toggle.check()
    await expect(toggle).toBeChecked()
    const runButton = panel.getByRole('button', { name: 'Insert a C-major chord' })
    await expect(runButton).toBeVisible()

    // The contributed instrument appears live in registry-backed discovery.
    const trackInspector = await openInspectorPanel(page, 'Track')
    await trackInspector.getByRole('button', { name: /Choose instrument for/ }).click()
    const browser = page.getByRole('region', { name: 'Instrument browser' })
    const musicBox = browser.getByRole('option', { name: /Music Box/ })
    await expect(musicBox).toBeVisible()
    await musicBox.click()

    // Select a track to receive the chord, then run the command.
    await page
      .getByRole('complementary', { name: 'Track rail' })
      .getByRole('button', { name: /Selected: Synth|Select Synth/ })
      .first()
      .click()

    const extensionInspector = await openInspectorPanel(page, 'Extensions')
    const restoredPanel = extensionInspector.getByRole('region', { name: 'Extensions' })
    const restoredRunButton = restoredPanel.getByRole('button', { name: 'Insert a C-major chord' })
    const before = await page.locator('.pr-note').count()
    await restoredRunButton.click()
    await expect.poll(async () => page.locator('.pr-note').count()).toBe(before + 3)
  })

  test('the enabled choice persists across reload', async ({ page }) => {
    await page.goto('/')
    const inspector = await openInspectorPanel(page, 'Extensions')
    const panel = inspector.getByRole('region', { name: 'Extensions' })
    await panel.getByRole('checkbox', { name: exampleToggle }).check()

    await page.reload()
    const restored = await openInspectorPanel(page, 'Extensions')
    await expect(
      restored.getByRole('checkbox', { name: exampleToggle }),
    ).toBeChecked()
  })

  test('the extensions UI has no detectable a11y violations once enabled', async ({ page }) => {
    await page.goto('/')
    const inspector = await openInspectorPanel(page, 'Extensions')
    await inspector
      .getByRole('region', { name: 'Extensions' })
      .getByRole('checkbox', { name: exampleToggle })
      .check()
    // Wait for the contributed command/panel to render before scanning.
    await expect(
      page.getByRole('region', { name: 'Example plugin' }),
    ).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })
})

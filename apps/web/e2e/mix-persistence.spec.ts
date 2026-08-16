import { expect, test, type Locator } from '@playwright/test'
import { createBlankProject } from './projectActions'
import { openMixWorkspace, openStudioDestination } from './studioActions'

async function firstTrackStrip(mixer: Locator): Promise<Locator> {
  return mixer.locator('.mixer-strip').first()
}

test.describe('persisted Mix workspace', () => {
  test('round-trips manual mix state through save, reload, and route remount', async ({ page }) => {
    await page.goto('/')
    const mixer = await openMixWorkspace(page)
    const track = await firstTrackStrip(mixer)
    const master = mixer.getByRole('group', { name: 'Master bus' })

    await track.getByRole('slider', { name: /Gain/ }).fill('-12')
    await track.getByRole('slider', { name: /Pan/ }).fill('0.5')
    await track.getByRole('button', { name: 'Solo' }).click()
    await track.getByRole('button', { name: 'Mute' }).click()
    await track.getByRole('combobox', { name: /Add insert/ }).selectOption('reverb')
    await track.getByRole('button', { name: 'Add', exact: true }).click()
    await master.getByRole('slider', { name: /Gain/ }).fill('-4')
    await master.getByRole('checkbox', { name: 'Limiter' }).check()
    await master.getByRole('slider', { name: /Ceiling/ }).fill('-3')

    await page.getByRole('button', { name: 'Save' }).click()
    await page.reload()

    const reloadedMixer = await openMixWorkspace(page)
    const reloadedTrack = await firstTrackStrip(reloadedMixer)
    const reloadedMaster = reloadedMixer.getByRole('group', { name: 'Master bus' })
    await expect(reloadedTrack.getByRole('slider', { name: /Gain/ })).toHaveValue('-12')
    await expect(reloadedTrack.getByRole('slider', { name: /Pan/ })).toHaveValue('0.5')
    await expect(reloadedTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(reloadedTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(reloadedTrack.getByRole('checkbox', { name: /Studio Reverb/ })).toBeChecked()
    await expect(reloadedMaster.getByRole('slider', { name: /Gain/ })).toHaveValue('-4')
    await expect(reloadedMaster.getByRole('checkbox', { name: 'Limiter' })).toBeChecked()
    await expect(reloadedMaster.getByRole('slider', { name: /Ceiling/ })).toHaveValue('-3')

    await openStudioDestination(page, 'Pricing')
    await page.getByRole('button', { name: 'Back to composer' }).click()

    const remountedMixer = await openMixWorkspace(page)
    const remountedTrack = await firstTrackStrip(remountedMixer)
    await expect(remountedTrack.getByRole('slider', { name: /Gain/ })).toHaveValue('-12')
    await expect(remountedTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('loading a new project replaces prior runtime mix state with neutral defaults', async ({
    page,
  }) => {
    await page.goto('/')
    let mixer = await openMixWorkspace(page)
    let track = await firstTrackStrip(mixer)
    await track.getByRole('slider', { name: /Gain/ }).fill('-18')
    await track.getByRole('button', { name: 'Solo' }).click()

    await createBlankProject(page)

    mixer = await openMixWorkspace(page)
    track = await firstTrackStrip(mixer)
    await expect(track.getByRole('slider', { name: /Gain/ })).toHaveValue('0')
    await expect(track.getByRole('slider', { name: /Pan/ })).toHaveValue('0')
    await expect(track.getByRole('button', { name: 'Solo' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

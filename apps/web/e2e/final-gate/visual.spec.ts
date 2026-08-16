import { test } from './audit-test'

test.describe('authoritative UX snapshots', () => {
  test.skip(
    true,
    'Generate Linux Chromium baselines only after #154-#159 are merged into the #159 parent.',
  )

  test('captures the approved deterministic matrix', async () => {
    // The final scenario adapters and screenshot calls are wired after the parent
    // UX stack is complete; keeping this test skipped prevents premature baselines.
  })
})

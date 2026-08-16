import {
  expect,
  test as base,
} from '@playwright/test'

export const test = base.extend<{ auditIdentity: void }>({
  auditIdentity: [
    async ({ browserName }, use, testInfo) => {
      const servedHead = process.env.CADENCE_FINAL_GATE_SERVED_HEAD
      const baseURL = process.env.CADENCE_FINAL_GATE_BASE_URL
      const workingTreeDirty =
        process.env.CADENCE_FINAL_GATE_WORKTREE_DIRTY === 'true'
      if (!servedHead || !baseURL) {
        throw new Error(
          'Final-gate audit identity is missing. Run with playwright.final-gate.config.ts.',
        )
      }

      await testInfo.attach('final-gate-audit-identity', {
        body: Buffer.from(
          `${JSON.stringify(
            {
              baseURL,
              browserName,
              servedHead,
              workingTreeDirty,
            },
            null,
            2,
          )}\n`,
        ),
        contentType: 'application/json',
      })
      await use()
    },
    { auto: true },
  ],
})

export { expect }

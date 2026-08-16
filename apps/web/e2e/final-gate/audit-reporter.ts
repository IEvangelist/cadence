import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

interface AuditIdentity {
  baseURL: string
  servedHead: string
  workingTreeDirty: boolean
}

interface AuditTestResult extends AuditIdentity {
  durationMs: number
  retry: number
  status: TestResult['status']
  title: string
}

class FinalGateAuditReporter implements Reporter {
  private identity: AuditIdentity = {
    baseURL: 'unknown',
    servedHead: 'unknown',
    workingTreeDirty: true,
  }

  private attempts: AuditTestResult[] = []
  private finalResults = new Map<string, AuditTestResult>()
  private totalTests = 0

  onBegin(config: FullConfig, suite: Suite): void {
    const metadata = config.metadata as Partial<AuditIdentity>
    this.identity = {
      baseURL: metadata.baseURL ?? 'unknown',
      servedHead: metadata.servedHead ?? 'unknown',
      workingTreeDirty: metadata.workingTreeDirty ?? true,
    }
    this.totalTests = suite.allTests().length
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const auditResult = {
      ...this.identity,
      durationMs: result.duration,
      retry: result.retry,
      status: result.status,
      title: test.titlePath().join(' › '),
    }
    this.attempts.push(auditResult)
    this.finalResults.set(test.id, auditResult)
  }

  onEnd(result: FullResult): void {
    const reportPath = resolve(
      process.cwd(),
      'test-results',
      'final-gate',
      'audit-summary.json',
    )
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          ...this.identity,
          attempts: this.attempts,
          completedTests: this.finalResults.size,
          overallStatus: result.status,
          results: [...this.finalResults.values()],
          totalTests: this.totalTests,
        },
        null,
        2,
      )}\n`,
    )
  }
}

export default FinalGateAuditReporter

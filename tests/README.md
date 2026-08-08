# tests

Test-first (TDD) suites. Every feature starts with a failing test.

- **unit** — Vitest (web) + xUnit (.NET)
- **integration** — Aspire test host (API + Postgres + Blob + Redis)
- **e2e** — Playwright user journeys
- **a11y** — axe-core + keyboard-only journeys (WCAG AA)
- **security** — SAST, dependency/secret scans, authZ/entitlement, watermark-bypass

Owned by the **QA/Test** squad; enforced as CI gates.

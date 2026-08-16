# tester History

## Learnings

### 2026-08-16: Stack authority remains with the coordinator

During the #160 final-gate audit, an informational test verdict was incorrectly
used to direct a downstream rebase. Audit findings and audit acceptance are
informational only and never authorize stack movement. Only the coordinator may
issue final acceptance and downstream rebase or release directives.

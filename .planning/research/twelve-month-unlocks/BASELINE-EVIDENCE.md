# Phase 1 Baseline Verification Evidence

Revision: `cc14589`
Worktree: `C:\tmp\citadel-12-month-unlocks`
Captured: 2026-07-13

## Aggregate command receipt

Command:

```text
rtk node scripts/run-with-timeout.js 300 node scripts/test-all.js
```

Observed result:

- Wrapper exit code: `1`
- Wall time: `279.5 seconds`
- The aggregate suite reached its final summary.
- Every named check reported `PASS` except `Codex runtime`, which reported `FAIL`.
- The failure occurred before the Codex assertions could run because the restricted process could not create `hooks_src/test-fixture-plain-stop.js`.
- Exact error: `EPERM: operation not permitted, open 'C:\tmp\citadel-12-month-unlocks\hooks_src\test-fixture-plain-stop.js'`.
- The aggregate output ended with `Codex runtime check failed. Fix runtime adapter regressions before shipping.` because the runner correctly treats environment setup failure as a nonzero check.

The passing summary included hooks, security, runtime contracts and registry, skill lint, telemetry, evidence, installers, campaigns, policy, Claude runtime, Codex native and operational checks, dashboard data/web/performance/visual checks, release integrity, activation and cohort checks, acquisition history, golden path and matrix, benchmark, proof cohort, ecosystem compatibility, and product-proof reporting.

## Isolated classification command receipt

The exact failing check was rerun with permission to create and remove its temporary fixture:

```text
rtk node scripts/test-codex-runtime.js
```

Observed result:

- Exit code: `0`
- Wall time: `2 seconds`
- Output: `codex runtime tests passed`

## Classification

This is an environment-only aggregate failure, not a source regression:

1. The restricted run failed at `fs.writeFileSync` while creating the test fixture.
2. The same current source and same test passed when the fixture write was permitted.
3. No product files changed between the aggregate failure and isolated rerun.

Phase 1 therefore has a behaviorally clean baseline with a documented sandbox limitation. Final campaign verification must run the complete strict suite in an environment that permits all temporary fixtures.

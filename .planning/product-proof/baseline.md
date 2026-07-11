# Citadel 1.1 Baseline — Architecture Phase 0 / Campaign Phase 1

Captured 2026-07-10 in `C:\Users\gammo\Desktop\Citadel` for the **Operable, Observable, Proven** campaign. Verdicts mean:

- **proven** — the named current-state check passed with direct evidence;
- **partial** — useful evidence exists, but the milestone-level claim is not yet established;
- **missing** — no authoritative implementation or verification evidence was established in this baseline run.

## Baseline summary

| Area | Verdict | Current evidence |
|---|---|---|
| Git state | partial | Branch and untracked planning artifacts were observed; checkpoint creation was reported as blocked by `.git/index.lock` permission. |
| Strict suite | partial | Aggregate ran to completion without timing out, but failed with three reported problem areas. |
| Installer | proven | Focused installer unit tests pass. Cross-platform release installation remains unproven. |
| Codex runtime | proven | Focused runtime and native-integration checks pass. |
| Native integration | proven | Focused native-integration test passes. |
| Dashboard | partial | Core and web suites pass; stranger comprehension and complete operator-state coverage remain unmeasured. |
| Release | missing | Package declares `1.0.0`, but no repository tags were present and no versioned release-integrity flow was proven. |
| Activation | missing | No verified install-to-return funnel or activation measurement was established. |
| Benchmark | partial | Skill benchmark infrastructure exists, but no pinned bare-agent-versus-Citadel product benchmark was established. |
| Known managed-checkout failure | proven | The operational test reproducibly fails on protected source-tree writes while scratch-project generation/readiness succeeds. |

## Git state

**Verdict: partial.**

- Command: `rtk git status --short --branch`
- Exit status: `0`
- Observed command duration: `17.2s`
- Evidence at capture: `main...origin/main` with untracked `.planning/architecture-citadel-product-proof.md` and `.planning/campaigns/citadel-product-proof.md`.
- Campaign checkpoint context: the orchestrator reported that checkpoint creation failed because `.git/index.lock` could not be opened due permission. This baseline did not retry or mutate Git state; Archon permits `checkpoint-phase-N: none` and continuation after a failed checkpoint.
- Limitation: other campaign workers share the checkout, so this is a point-in-time status, not proof of a clean repository.

## Strict suite

**Verdict: partial (failed baseline).**

- Command: `rtk node scripts/run-with-timeout.js 300 node scripts/test-all.js --strict`
- Wrapper exit status exposed by the shell tool: `1`; child exit code recorded by `run-with-timeout`: `524448`
- Duration: `187.075s`
- Timed out: `false`
- Positive evidence: hook smoke `138 passed, 0 failed`; security `26 passed, 0 failed`; the aggregate tail reports dashboard, dashboard web, telemetry OTLP, state hygiene, permission audit, secrets lens, and no-op detector as `PASS`.
- Reported failures:
  1. strict skill lint treats the single advisory warning as failure: `skills/do/SKILL.md` body is 301 lines against a 300-line budget (`626 passed, 1 warned, 0 failed` structurally);
  2. AGENTS.md-only steward check failed;
  3. Codex operational improvement check failed.
- Limitation: the aggregate output was truncated by the execution transport. The focused Codex operational check below supplies direct failure evidence; the AGENTS.md-only steward failure was not rerun independently and remains missing precise focused evidence.

## Installer

**Verdict: proven for focused installer tests; partial for release readiness.**

- Command: `rtk node scripts/run-with-timeout.js 300 node scripts/test-installers.js`
- Exit status: `0`
- Duration: `1.899s`
- Evidence: `installer tests passed`.
- Boundary: this proves the repository's current installer unit contract. It does not prove clean installs on Windows, macOS, and Linux from a tagged, checksummed release.

## Codex runtime

**Verdict: proven for the focused runtime contract.**

- Command: `rtk node scripts/run-with-timeout.js 300 node scripts/test-codex-runtime.js`
- Exit status: `0`
- Duration: `2.382s`
- Evidence: `codex runtime tests passed`.
- Boundary: operational source-refresh behavior is assessed separately under Known managed-checkout failure.

## Native integration

**Verdict: proven for the focused integration contract.**

- Command: `rtk node scripts/run-with-timeout.js 300 node scripts/test-codex-native-integrations.js`
- Exit status: `0`
- Duration: `2.400s`
- Evidence: `codex native integration tests passed`.

## Dashboard

**Verdict: partial.**

Core dashboard:

- Command: `rtk node scripts/run-with-timeout.js 300 node scripts/test-dashboard.js`
- Exit status: `0`
- Duration: `17.453s`
- Evidence: `dashboard tests passed`.

Web dashboard:

- Command: `rtk node scripts/run-with-timeout.js 300 node scripts/test-dashboard-web.js`
- Exit status: `0`
- Duration: `4.404s`
- Evidence: all web checks pass, including empty and corrupt project handling, invalidation, `/api/overview` schema, handoff serving, static shell/CSS, traversal protection, 404s, and write-method rejection.

Current product evidence:

- `package.json` exposes `dashboard` and `dashboard:web` commands.
- `docs/DASHBOARD_SPEC.md`, `scripts/dashboard.js`, `scripts/dashboard-server.js`, and the dashboard test pair exist.
- Missing milestone evidence: no completed stranger-comprehension trial was run; no evidence shows 8/10 strangers can identify goal, status, blocker, and next action within 60 seconds; activation funnel state was not verified as a dashboard input.

## Release

**Verdict: missing.**

- Package inventory: `package.json` declares version `1.0.0` and repository `https://github.com/SethGammon/Citadel`.
- Command: `rtk git tag --sort=-version:refname`
- Exit status: `0`
- Observed command duration: `23.6s`
- Evidence: output was empty; no local tags were present.
- Search evidence found release integrity only as roadmap intent (`docs/ROADMAP.md` names versioned releases, checksums, and migration notes), not as a proven shipped workflow.
- Missing checks: no focused changelog, release workflow, archive determinism, checksum, migration, rollback, compatibility-matrix, or update-command test was completed before the baseline was frozen.

## Activation

**Verdict: missing.**

- Existing telemetry infrastructure and handoff/resume behavior were found by repository search, but that is not proof of a product activation funnel.
- No authoritative events were verified for installer completion, setup success, first routed task, first verified handoff, later-session resume, or week-two return.
- No privacy contract, local-first activation schema, opt-in export, funnel report, or retention gate was executed in this baseline.
- Required foundation: define stable local event semantics and a report that can distinguish discovery, installation, activation, and return without automatic remote collection.

## Benchmark

**Verdict: partial infrastructure, missing product proof.**

- Existing evidence: `scripts/skill-bench.js` and per-skill benchmark conventions are present; the strict suite exercises skill structure and reports 49 structurally valid skills.
- Missing evidence: no 8–12 task pinned corpus, identical bare/harnessed runner, raw trace package, human-intervention count, completion/recovery comparison, or orchestration-overhead calculation was verified.
- Therefore Citadel's comparative product-usefulness claim is not proven by the existing skill benchmark substrate.

## Known managed-checkout failure

**Verdict: proven and reproducible.**

- Command: `rtk node scripts/run-with-timeout.js 300 node scripts/test-codex-operational-improvements.js`
- Exit status: `1`
- Duration: `6.915s`
- Timed out: `false`
- Failure entry point: `testCodexInstallScript` at `scripts/test-codex-operational-improvements.js:90` invokes `scripts/codex-install.js` for a scratch destination.
- Protected source refresh fails with `EPERM: operation not permitted, open 'C:\Users\gammo\Desktop\Citadel\.codex\config.toml'` from `scripts/codex-compat.js`.
- Local marketplace refresh also fails with `EPERM: operation not permitted, open 'C:\Users\gammo\Desktop\Citadel\.agents\plugins\marketplace.json'` from `core/codex/native-integrations.js`.
- Crucial control evidence: in the same run, Codex artifacts were successfully generated into `F:\Temp\citadel-codex-install-X9gGph`, 49 skills and 155 script delegates were synced, and all 12 scratch-project readiness checks passed.
- Interpretation: the destination install/readiness path works, but the installer first treats its protected source plugin checkout as a writable generated-artifact target. Release/reliability work should make that source refresh hermetic, skippable when unchanged, or redirected to a writable staging area. Tests must not require writes to protected `.codex` or `.agents` source paths.

## Phase 0 scope lock

Until a trial or benchmark demonstrates a concrete missing capability, Citadel 1.1 should not add net-new skills. Phase 1 should prioritize:

1. hermetic managed-checkout behavior and a green strict suite;
2. deterministic, tagged release artifacts with checksums and migration/rollback guidance;
3. one supported update path and a tested runtime/OS compatibility matrix;
4. activation-event contracts that remain local-first and opt-in;
5. reusable evidence hooks for the golden path and comparative benchmark.

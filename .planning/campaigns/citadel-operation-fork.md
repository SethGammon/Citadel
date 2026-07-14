---
slug: citadel-operation-fork
status: active
orchestrator: archon
created: 2026-07-13
updated: 2026-07-13
reversibility: amber
---

# Campaign: Citadel Operation Fork

Direction: Ship one objective through comparable isolated Claude Code and Codex branches under one durable operation contract, then produce an honest evidence-backed comparison, safe operator selection, and redacted replay. Deliver the verified implementation through a protected pull request to `main` without publishing packages, tags, or hosted services.

## Success Contract

- One command creates a parent operation and at least two runtime branches from the same immutable objective, scope, policy, budget, workflow, and verifier contracts.
- Each branch executes in a contained worktree with durable state, independent recovery, idempotency boundaries, and no duplicated nonrepeatable effects.
- Comparisons use artifact-derived evidence, receipts, cost, duration, and diff metadata. Citadel never invents a winner when evidence is missing or incomparable.
- Mission Control shows the fork, branch states, evidence, comparison, confirmation, and selected landing action accessibly.
- A deterministic redacted replay proves the operation without exposing prompts, source, repository identity, paths, credentials, or signer material.
- Documentation, security review, browser QA, focused tests, and the full strict suite pass before protected delivery.

## Phases

| Phase | Title | Type | Status | validator_retries_remaining |
|---|---|---|---|---:|
| 1 | Product contract and architecture | research | complete | 3 |
| 2 | Fork contracts, worktrees, and runtime adapters | build | complete | 3 |
| 3 | Evidence comparison, selection, landing, and replay | build | complete | 3 |
| 4 | CLI journey and Mission Control experience | build | complete | 3 |
| 5 | Adversarial, recovery, security, and visual verification | verify | complete | 3 |
| 6 | Documentation, package integrity, and protected delivery | verify | in-progress | 3 |

## Phase End Conditions

| Phase | Condition type | Condition | Evidence |
|---|---|---|---|
| 1 | file_exists | `docs/OPERATION_FORK.md` defines the user contract, states, safety boundary, and non-goals | passed |
| 1 | command_passes | Baseline `npm run test:unlocks` and relevant existing strict checks pass or exact failures are recorded | passed |
| 2 | command_passes | Fork contract, containment, runtime parity, and recovery tests pass | passed |
| 2 | metric_threshold | Two runtime branches preserve 100 percent of the declared shared operation semantics | passed |
| 3 | command_passes | Comparison, unknown-state, selection, landing, and replay tests pass | passed |
| 3 | metric_threshold | Fault injection produces zero duplicated nonrepeatable effects across branch recovery | passed |
| 4 | command_passes | Packaged CLI and Mission Control interaction tests pass | passed |
| 4 | visual_verify | Real browser verifies desktop, mobile, keyboard, reduced-motion, confirmation, and unknown states | passed |
| 5 | command_passes | Security, privacy, path containment, tamper, race, and full Operation Fork suites pass | passed |
| 5 | command_passes | `node scripts/test-all.js --strict` passes | passed |
| 6 | command_passes | Documentation, release integrity, package boundary, and site checks pass | passed |
| 6 | manual | Public claims and delivery scope are reviewed against real evidence | passed |

## Decision Log

- 2026-07-13: The product primitive is an operation, not an agent session. Fork branches share one immutable parent contract and differ only by runtime execution and resulting evidence.
- 2026-07-13: The first release supports Claude Code and Codex adapters but remains executable through injected test adapters. It does not require either vendor binary for deterministic CI.
- 2026-07-13: A comparison may recommend a branch only when the shared verifier is comparable and its required evidence is complete. Ties and insufficient evidence remain explicit.
- 2026-07-13: Selection and landing are separate. Selection records operator intent; landing requires a fresh revision, containment, clean target, and explicit confirmation.
- 2026-07-13: The original checkout is dirty and remains untouched. Work starts from `origin/main` commit `c813983` in `C:\tmp\citadel-operation-fork`.
- 2026-07-13: No hosted Relay, remote execution service, npm publication, tag, or release is part of this campaign.

## Feature Ledger

- Runtime-neutral Operation Fork contract, durable store, lifecycle, comparison, replay, worktree, runtime, and orchestration modules built.
- `citadel fork` CLI supports start, resume, status, compare, select, landing plan/apply, and redacted replay export.
- Mission Control Forks view compares both branches and records selection without landing; the public site demonstrates verified and missing-receipt states.
- Version 1.3.0 metadata, README, changelog, CLI, dashboard, security, threat-model, roadmap, and release surfaces updated.
- Three focused Operation Fork suites, existing unlock tests, release integrity, browser QA, and the full strict repository suite pass.

## Exit Evidence

| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |
|---|---|---|---|---|---|---:|---|
| phase:1 | contract | doc_update | yes | `docs/OPERATION_FORK.md` | passed | 3 | complete |
| phase:2 | execution | test_result | yes | `node scripts/test-operation-fork.js` | passed | 3 | complete |
| phase:3 | decision | test_result | yes | `node scripts/test-operation-fork-decision.js` | passed | 3 | complete |
| phase:4 | experience | screenshot | yes | `output/playwright/operation-fork-comparison.png`; `output/playwright/operation-fork-mission-control.png` | passed | 3 | complete |
| phase:5 | strict | command_result | yes | `node scripts/test-all.js --strict` | passed | 3 | complete |
| phase:6 | delivery | pr | yes | protected pull request to `main` | pending | 3 | review, push, verify CI, and merge |

## Active Context

Phase 6 is active. The implementation, documentation, focused suites, strict suite, and browser QA pass. Next action: review the final diff, commit, open the protected pull request, verify CI on the exact head, and merge to `main`.

## Continuation State

- current_phase: 6
- current_substep: protected delivery
- worktree: `C:\tmp\citadel-operation-fork`
- branch: `codex/citadel-operation-fork`
- baseline_commit: `c813983f5213919bed77e3eb84e1ebf357450c1f`
- checkpoint-phase-1: contract and baseline passed
- checkpoint-phase-2: execution, isolation, signatures, and recovery passed
- checkpoint-phase-3: comparison, selection, landing, and replay passed
- checkpoint-phase-4: CLI, Mission Control, and browser QA passed
- checkpoint-phase-5: focused security and full strict suites passed
- files_modified: Operation Fork core, CLI, dashboard, site, documentation, metadata, proof assets, and tests
- blockers: none
- next_actions: review diff; commit; push; open PR; verify exact-head CI; merge to main

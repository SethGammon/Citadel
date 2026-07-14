---
slug: citadel-executor-profiles-live-proof
status: active
orchestrator: archon
created: 2026-07-13
updated: 2026-07-13
reversibility: amber
---

# Campaign: Citadel Executor Profiles and Live Proof

Direction: Turn Operation Fork from a dual-runtime primitive into a reproducible executor control plane. First freeze an acceptance contract, then use the merged Operation Fork implementation to send that real engineering objective through live Claude Code and Codex branches from one commit. Compare, select, and land from evidence. Harden explicit model and provider identity, usage and cost evidence, Mission Control, and redacted replay. Finish with a second explicit-model live proof and protected delivery to `main`.

## Success Contract

- Executor identity is explicit, strict, contract-digested, receipt-bound, and visible in Mission Control and replay.
- Claude Code and Codex accept explicit model selections without shell interpolation or hidden argument construction.
- Codex local providers are representable only through an allowlisted adapter contract. Arbitrary executable profiles are out of scope.
- `--runtimes claude,codex` remains backward compatible while `--executors` enables reproducible profiles.
- Runtime output may contribute model, token, and cost evidence only when parsed from declared machine-readable fields. Missing evidence remains `unknown`.
- One real engineering objective is executed by both authenticated vendor CLIs from the same frozen base, compared, selected, and landed without bypassing the Operation Fork boundaries.
- A second live operation proves explicit model identity end to end and produces a redacted public replay plus bounded proof report.
- Focused, adversarial, browser, strict local, and hosted cross-platform checks pass before merge.

## Phases

| Phase | Title | Type | Status | validator_retries_remaining |
|---|---|---|---|---:|
| 1 | Executor contract and frozen acceptance test | research | complete | 3 |
| 2 | Live Claude Code versus Codex implementation fork | build | in-progress | 3 |
| 3 | Evidence comparison, selection, landing, and independent review | wire | pending | 3 |
| 4 | Control-plane hardening and product integration | build | pending | 3 |
| 5 | Explicit-model live proof and public evidence | verify | pending | 3 |
| 6 | Strict verification and protected delivery | verify | pending | 3 |

## Phase End Conditions

| Phase | Condition type | Condition | Evidence |
|---|---|---|---|
| 1 | file_exists | `docs/EXECUTOR_PROFILES.md` defines schema, compatibility, trust boundaries, and non-goals | pending |
| 1 | command_passes | Frozen executor-profile acceptance test parses and fails only for missing implementation | pending |
| 2 | command_passes | Live `citadel fork start` completes authenticated Claude Code and Codex branches from the same base | pending |
| 2 | metric_threshold | Both live branches preserve 100 percent of the frozen parent contract fields | pending |
| 3 | command_passes | Comparison validates both live receipts and selection records no merge effect | pending |
| 3 | command_passes | Selected branch lands only through revision, clean-state, receipt, and confirmation gates | pending |
| 4 | command_passes | Executor contract, CLI, runtime parsing, replay, dashboard, and security suites pass | pending |
| 4 | visual_verify | Real browser verifies model identity, unknown telemetry, selection, and responsive states | pending |
| 5 | command_passes | Explicit Claude and Codex model profiles complete a second real operation and export a redacted replay | pending |
| 5 | metric_threshold | Public proof reports exact denominators and zero leaked prompts, source, local paths, or signer material | pending |
| 6 | command_passes | `node scripts/test-all.js --strict` passes | pending |
| 6 | command_passes | Final PR head passes every protected hosted check and merges to `main` | pending |

## Decision Log

- 2026-07-13: Executor identity is separate from runtime identity. A profile includes a stable ID, registered runtime, optional model, optional allowlisted provider, and adapter options.
- 2026-07-13: No arbitrary command profiles. Extensibility is provided through registered adapters so configuration cannot become remote code execution.
- 2026-07-13: The first live operation implements this milestone itself against a frozen acceptance test. The winning branch is still independently reviewed and hardened before trust.
- 2026-07-13: Live vendor output and deterministic fixture evidence remain separate evidence classes. Neither can relabel the other.
- 2026-07-13: The original checkout is dirty and remains untouched. Work starts from protected `main` commit `8bf574c` in `C:\tmp\citadel-executor-profiles`.
- 2026-07-13: Installed live runtimes are Claude Code 2.1.206 and Codex CLI 0.130.0. Both are authenticated. Current configured models are Claude `opus` and Codex `gpt-5.6-sol`.

## Feature Ledger

- Six-phase campaign and trust contract created.
- Phase 1 complete: strict executor-profile contract frozen against installed Claude Code and Codex CLI flags.
- Phase 1 complete: acceptance test parses and exits only with `EXECUTOR_PROFILES_NOT_IMPLEMENTED` until production support exists.
- Phase 1 validator: pass with both non-manual end conditions satisfied.

## Exit Evidence

| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |
|---|---|---|---|---|---|---:|---|
| phase:1 | contract | doc_update | yes | `docs/EXECUTOR_PROFILES.md` and `scripts/test-executor-profiles.js` | passed | 3 | none |
| phase:2 | live-build | operation_receipt | yes | first live Operation Fork record and signed branch receipts | pending | 3 | execute both authenticated runtimes |
| phase:3 | selected-build | decision_receipt | yes | comparison, selection, landing, and review record | pending | 3 | choose and land from evidence |
| phase:4 | integration | test_result | yes | focused suites plus Mission Control screenshots | pending | 3 | harden the selected implementation |
| phase:5 | live-proof | proof_bundle | yes | explicit-model replay and bounded proof report | pending | 3 | run and publish the real proof artifact |
| phase:6 | delivery | pr | yes | protected pull request to `main` | pending | 3 | verify exact head and merge |

## Active Context

Phase 2 is active. Phase 1 passed independent validation. Next action: commit the frozen red-test base, then run the same implementation objective through authenticated Claude Code and Codex branches from that revision.

## Continuation State

- current_phase: 2
- current_substep: commit frozen base and execute live implementation fork
- worktree: `C:\tmp\citadel-executor-profiles`
- branch: `codex/citadel-executor-profiles`
- baseline_commit: `8bf574c61e04744fc06845b2c8c1187684379acc`
- checkpoint-phase-1: stash@{0}
- files_modified: campaign file, `docs/EXECUTOR_PROFILES.md`, `scripts/test-executor-profiles.js`
- blockers: none
- next_actions: commit frozen acceptance base; create live workflow; execute both authenticated runtimes; preserve receipts and diffs

<!-- session-end: 2026-07-14T02:06:26.490Z -->

## Repair Tasks

- Resolved phase:1/contract: contract and red acceptance test passed independent validation.

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
- 2026-07-13: The first live fork is invalid evidence. Claude Code left its assigned worktree, checked out the campaign branch, and committed there. Cleanup then removed the fork store before the parent could write its receipt. Codex did not run. The implementation commit was recovered, but the run is recorded as failed rather than relabeled.
- 2026-07-13: Executor-profile trust is contract anchored. Schema 2 binds the signer public-key digest, issuer, execution receipt, signed observation digest, executor profile, and adapter contract. Mutable telemetry or a substituted fork-local key cannot manufacture trust.
- 2026-07-13: Agent branch ownership is a runtime postcondition. Citadel snapshots every assigned worktree and fails closed if an executor removes a worktree, changes its branch, or changes its HEAD outside the allowed task result.
- 2026-07-13: Codex CLI was upgraded to 0.144.3 so the configured `gpt-5.6-sol` model can be exercised. Legacy Codex keeps user configuration; explicit schema 2 profiles may override the model.
- 2026-07-13: The fresh live fork receives one bounded product objective: implement a deterministic `fork proof` report over the already redacted replay and freshly verified executor evidence. The frozen acceptance test requires exact fields, honest evidence counts, deterministic digests, CLI export, and no local path disclosure.
- 2026-07-14: The external dual-vendor run remains permission-gated because it sends the isolated worktree and relevant code context to authenticated Claude and OpenAI services. The rejected launch created no process or fork state. Local implementation and verification continue without weakening the live-proof requirement.
- 2026-07-14: Every branch result fact used by comparison, Mission Control, replay, or proof is bound into the signed observation envelope. Status, evidence summary, diff summary, duration, cost, and failure code cannot be edited independently of the verified receipt chain.
- 2026-07-14: Codex explicit model proof uses two runtime-authored records: stdout `thread.started` binds the thread ID, and that exact rollout's `turn_context.model` supplies the resolved model only when its working directory matches the assigned worktree. Bounded lookup, duplicate matches, symlinks, path mismatches, or missing fields remain unknown.
- 2026-07-14: The operator explicitly approved sending the isolated Citadel worktrees and relevant code context to authenticated Claude Code and OpenAI Codex for the bounded live proof.
- 2026-07-14: The fresh shared objective is a real remaining product slice: project the verified bounded proof summary into Mission Control and render exact receipt and model denominators. The immutable external verifier digest is `sha256:93e5b402bcff23b0280111d28667e8991526c0a033e6fc24307f1a434ffab75e` and fails against the shared base before either executor runs.
- 2026-07-14: The approved vendor launch was denied before process creation by the execution policy, which forbids exporting this private workspace to external vendor services even with operator approval. No Claude, Codex, worktree, or fork state was created. The campaign will not retry through an alternate command or indirect path.
- 2026-07-14: A real headless Edge session verified the local Mission Control Forks surface against a disposable signed fixture. The proof card rendered 2/2 verified receipts, two matched model observations, zero failures, zero unknowns, and the deterministic digest. The browser and localhost server were terminated immediately after capture.
- 2026-07-14: GitHub confirms PR #203 merged the executor-profile foundation to protected `main` at `21b68cf`. The old remote campaign branch was deleted. A clean delivery branch was created from that exact main commit, and only the three post-merge proof checkpoints were replayed so newer README, asset, screenshot, and worktree changes are preserved.

## Feature Ledger

- Six-phase campaign and trust contract created.
- Phase 1 complete: strict executor-profile contract frozen against installed Claude Code and Codex CLI flags.
- Phase 1 complete: acceptance test parses and exits only with `EXECUTOR_PROFILES_NOT_IMPLEMENTED` until production support exists.
- Phase 1 validator: pass with both non-manual end conditions satisfied.
- Phase 2 recovery: implementation candidate preserved from failed fork as commit `cdf2558`, then independently hardened against signer substitution, receipt and telemetry tampering, stale comparison, Windows npm shim execution, public replay leakage, and worktree escape.
- Full strict repository verification passes from the hardened candidate: every suite in `node scripts/test-all.js --strict` passed in 110.8 seconds.
- Phase 2 live-proof acceptance is frozen in `scripts/test-operation-fork-proof.js` and registered in the strict suite. It currently exits only with `OPERATION_FORK_PROOF_NOT_IMPLEMENTED`.
- Local recovery implementation: `fork proof` now produces a deterministic redacted report with exact branch, comparable, verified-receipt, and model-proof denominators. The frozen acceptance test passes.
- Evidence hardening: operation digest, run ID, receipt status, telemetry, and the complete branch result are rechecked against signed bindings before comparison or display. Adversarial receipt, telemetry, signer, and manifest edits fail closed.
- Mission Control audit: requested model, observed model, provider, model proof, receipt proof, cost, duration, and token states are projected from freshly verified evidence; interaction tests now pin the four identity and proof facts.
- Explicit-model readiness: current Codex exec JSONL usage parsing is covered, and local runtime-authored session fixtures prove model extraction is thread-bound, worktree-bound, public-safe, bounded, and ambiguity-safe without ingesting prompt content.
- Live proof preparation: the deleted campaign worktree was reconstructed from verified commit `add8b1f`; branch identity and cleanliness were rechecked before execution.
- Mission Control proof summary implemented locally against the immutable external verifier: the API exposes only digest plus bounded summary, the UI shows verified receipts over total branches and passed, failed, and unknown model counts, and the embedded replay remains excluded.
- Visual verification passed locally in Microsoft Edge. The registered artifact is `.planning/screenshots/citadel-executor-profiles-live-proof/mission-control-proof.png`; `codex-app-artifacts verify --require-artifacts` confirms the screenshot exists and is marked pass. Generated artifact ledgers are now ignored with the rest of ephemeral `.planning` runtime evidence.
- Clean delivery verification: the post-merge branch changes only eight intended files with 54 additions and seven deletions. Structured review passed with zero critical findings; its one stale-continuation warning was corrected. `node scripts/test-all.js --strict` passed on this exact working tree in 173.7 seconds.

## Exit Evidence

| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |
|---|---|---|---|---|---|---:|---|
| phase:1 | contract | doc_update | yes | `docs/EXECUTOR_PROFILES.md` and `scripts/test-executor-profiles.js` | passed | 3 | none |
| phase:2 | live-build | operation_receipt | yes | first live Operation Fork record and signed branch receipts | pending | 3 | execute both authenticated runtimes |
| phase:3 | selected-build | decision_receipt | yes | comparison, selection, landing, and review record | pending | 3 | choose and land from evidence |
| phase:4 | integration | test_result | yes | focused suites pass; local Mission Control screenshot verifies proof denominators, model identity, and zero unknowns | pending | 3 | repeat against the selected live implementation |
| phase:5 | live-proof | proof_bundle | yes | explicit-model replay and bounded proof report | pending | 3 | run and publish the real proof artifact |
| phase:6 | delivery | pr | yes | protected pull request to `main` | pending | 3 | verify exact head and merge |

## Active Context

Phase 2 remains active because authenticated dual-vendor execution is unproven. The external execution policy denied the approved run before launch. The clean Mission Control proof-summary slice passes focused, structured-review, strict, artifact, and real-browser verification. Next action: publish a truthful draft PR after local GitHub CLI authentication is restored. The live vendor proof remains an explicit blocked exit condition.

## Continuation State

- current_phase: 2
- current_substep: publish the verified clean post-merge Mission Control proof slice
- worktree: `C:\tmp\citadel-executor-proof-ui`
- branch: `codex/citadel-executor-proof-ui`
- baseline_commit: `21b68cf32de38c53a1fc6755204aebcc287b4262`
- checkpoint-phase-1: `d4d82d5`
- checkpoint-bootstrap: `e7d86a2`
- checkpoint-recovered-candidate: `cdf2558`
- checkpoint-post-merge-proof: `dd33967`
- files_modified: Mission Control proof projection and rendering, dashboard contract tests, Operation Fork documentation, artifact hygiene, and campaign state
- blockers: execution policy forbids exporting the private worktree to authenticated Claude Code and OpenAI Codex, even with operator approval; local `gh` authentication is stale and must be restored before push
- next_actions: commit this provenance correction; restore `gh` authentication; policy-check and push the clean branch; open a draft PR; keep phase 2 and live proof evidence pending

<!-- session-end: 2026-07-14T02:06:26.490Z -->

<!-- session-end: 2026-07-14T04:00:25.460Z -->

## Repair Tasks

- Resolved phase:1/contract: contract and red acceptance test passed independent validation.

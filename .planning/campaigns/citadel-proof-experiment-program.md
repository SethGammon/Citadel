---
version: 1
id: "95e45977-b0de-46b0-8ad5-267b09c55698"
status: complete
started: "2026-08-04T17:08:14.4310319Z"
completed_at: "2026-08-04T22:01:37.1734792Z"
direction: "Run every proposed Citadel proof experiment, act on valid findings, and reduce evidence-backed bloat without losing compatibility or reproducibility."
phase_count: 8
current_phase: 8
branch: "codex/proof-program-20260804"
worktree_status: active
---

# Campaign: Citadel Proof Experiment Program

Status: complete
Started: 2026-08-04T17:08:14.4310319Z
Direction: Run every proposed Citadel proof experiment, act on valid findings, and reduce evidence-backed bloat without losing compatibility or reproducibility.

## Claimed Scope

- `core/operations/`, `hooks_src/`, `core/policy/`, `core/governance/`
- `core/fleet/`, `core/product-proof/`, `core/deploy-steward/`
- `agents/`, `scripts/`, `benchmarks/`, `package.json`
- `README.md`, `docs/`, `.planning/research/`

## Phases

| # | Status | Type | Phase | Done When | Validator Retries Remaining |
|---|---|---|---|---|---:|
| 1 | complete | research | Freeze experiment contracts and bloat baseline | Manifest and baseline reports exist; all proposed experiments have controls, metrics, gates, and external-dependency classifications | 3 |
| 2 | complete | build | Run crash-recovery and safety-gate A/B experiments | Local A/B runners publish raw evidence and pass deterministic verification | 3 |
| 3 | complete | build | Build and run Citadel JudgeEval | Blinded fixture suite reports false-pass and false-block matrices for validator and arbiter paths | 3 |
| 4 | complete | build | Run Fleet isolation ablation | Serial and isolated-parallel arms run on matched fixtures with accepted-outcome, intervention, conflict, time, and cost evidence | 3 |
| 5 | complete | build | Run Real User Proof v2 | Local instrument and proxy run complete; external-owner and D7 gates are either evidenced or explicitly blocked without simulated humans | 3 |
| 6 | complete | build | Run deploy-steward paired experiment | Local paired simulator completes; public GitHub arm runs only after policy approval and publishes verifiable evidence | 3 |
| 7 | complete | prune | Act on bloat findings | Package experiment improves packed metric without breaking runtime/evidence gates; safe deprecations and temp-state decisions are recorded | 3 |
| 8 | complete | verify | Integrate, verify, and publish proof boundaries | Full strict suite and offline proof replay pass; README and evidence reports match actual results | 3 |

## Phase End Conditions

| Phase | Type | Check |
|---:|---|---|
| 1 | file_exists | `benchmarks/citadel-proof-experiments/experiment-manifest.json` |
| 1 | file_exists | `benchmarks/citadel-proof-experiments/bloat-baseline.json` |
| 1 | command_passes | `node scripts/experiment-contracts.js verify` |
| 2 | command_passes | `node scripts/experiment-operation-recovery.js verify` |
| 2 | command_passes | `node scripts/experiment-safety-gates.js verify` |
| 3 | command_passes | `node scripts/experiment-judge-eval.js verify` |
| 4 | command_passes | `node scripts/experiment-fleet-ablation.js verify` |
| 5 | command_passes | `node scripts/product-proof-trial.js report --root proof-trial-temp --experiment-manifest benchmarks/citadel-proof-experiments/experiment-manifest.json` |
| 5 | manual | Independent repository owners supply blinded task judgments and D7 records |
| 6 | command_passes | `node scripts/experiment-deploy-steward.js verify` |
| 6 | manual | Policy-approved disposable GitHub repositories complete the public arm |
| 7 | metric_threshold | `node scripts/experiment-package-bloat.js metric` reports packed bytes below the frozen baseline with both runtime and evidence profiles valid |
| 7 | command_passes | `node scripts/experiment-package-bloat.js verify` |
| 8 | command_passes | `node scripts/test-all.js --strict` |
| 8 | command_passes | `npm run grant:verify` |

## Exit Evidence

| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |
|---|---|---|---|---|---|---:|---|
| phase:1 | experiment-contracts | test_result | yes | `node scripts/experiment-contracts.js verify`; 4/4 tamper tests | passed | 3 | Phase Validator passed; freeze retained |
| phase:2 | recovery-safety-ab | test_result | yes | Recovery `c81d93...`; safety `e7d94c...`; independent validator pass | passed | 3 | Preserve narrow deterministic claim boundary |
| phase:3 | judge-eval | test_result | yes | 8-case sealed same-family proxy; independent validator pass | passed | 3 | Keep instrument-only; obtain external calibration before promotion |
| phase:4 | fleet-ablation | test_result | yes | Real 2-agent serial/parallel run; independent validator pass | passed | 3 | Keep single-suite result instrument-only |
| phase:5 | real-user-proof | test_result | yes | Manifest-bound empty external trial; independent validator pass | passed | 3 | Recruit real owners; retain 0-record result as blocked |
| phase:6 | deploy-steward | test_result | yes | 3x15 local simulator passed; three valid public 15+15 GitHub runs passed with counterbalanced order; one invalid run disclosed | passed | 3 | Seek independent-account replication; keep timing descriptive |
| phase:7 | package-bloat | command_result | yes | 9,678,793 to 9,123,375 packed bytes; 22,586,511 to 22,066,567 unpacked bytes; 1,954 to 1,888 files; result `730a92d6...` | passed | 0 | Preserve the scoped source/runtime boundary |
| phase:8 | strict-suite | test_result | yes | Elevated strict suite all PASS; offline replay 17/17; final Arbiter ACCEPT | passed | 3 | Local campaign complete |

## Feature Ledger

| Feature | Status | Phase | Notes |
|---|---|---:|---|
| Public proof framing and dead-anchor validation | complete | pre-campaign | Four-file isolated branch change; strict suite and 17 offline proof checks passed |
| Frozen seven-track experiment contract | complete | 1 | Phase Validator passed; pack baseline is 9,678,793 packed bytes across 1,954 files |
| Journaled recovery A/B | complete | 2 | Control duplicates 3; treatment 0; safe recovery 6/6; deterministic in-process faults only |
| Safety-gate precision A/B | complete | 2 | 12 matched decisions; TPR 1; FPR 0; canary 0; no exploit or cross-OS claim |
| Citadel JudgeEval instrument | complete | 3 | Control accuracy 0.625 vs acting-arbiter proxy 1.0; both false-accept 0; promotion blocked |
| Fleet worktree ablation | complete | 4 | Both arms accepted; 196.834s serial vs 154.023s isolated parallel; one internal suite only |
| Real User Proof v2 binding | complete | 5 | Frozen manifest receipt enforced; 0 scored records; utility false; preview suppressed and local |
| Deploy-steward paired simulator | complete | 6 | Treatment 0 races vs control 315 across 45 PRs; fake-provider boundary retained |
| Protected GitHub deploy-steward A/B | complete | 6 | Across three valid runs both arms merged 45/45 with exactly-once deployment records; controls 106 races and 421 interventions, stewards 0 and 0; invalid R2 disclosed |
| Lean self-contained npm profile | complete | 7 | 555,418 packed bytes removed (5.7385%); 66 files removed; live proof harness, experiment tests, and canonical contracts retained |
| Deprecated research-fleet redirect cleanup | complete | 7 | Two-release redirect and unused duplicate fixture removed; `/research --parallel` and operation-graph compatibility retained |

## Decision Log

- 2026-08-04: Preserve the dirty primary checkout and execute on `codex/proof-program-20260804` at live `main` `d3aae97`.
- 2026-08-04: Do not simulate humans, provider identity, subscription cash, GitHub branch protection, or external-owner judgments. These remain external gates.
- 2026-08-04: Treat package size as a multi-output optimization: lower packed bytes only counts if runtime smoke and offline evidence verification both pass.
- 2026-08-04: Do not delete `.planning/tmp/` until ownership and inactivity are proven; investigation is authorized, destructive cleanup is not inferred.
- 2026-08-04: Foreground campaign only. No unattended daemon or public infrastructure mutation before the applicable policy gate.
- 2026-08-04: Campaign telemetry helper is unavailable in this source checkout; campaign file and experiment reports remain authoritative.
- 2026-08-04: Phase 1 passed independent validation. The contract hash is `d1995b49cd4e02198889d418f3a78f1eadb64be17ab94f4866e9ac6e99e0dd27`; contract evidence is not outcome evidence.
- 2026-08-04: Phase 2 passed independent validation. Recovery proves deterministic in-process fault behavior, not process-kill or power-loss behavior. Safety proves decision-boundary precision, not execution containment or cross-OS portability.
- 2026-08-04: Phase 3 passed as an instrument, not a product claim. A one-trial same-family proxy reduced unknown verdicts from 0.50 to 0.125 and raised exact accuracy from 0.625 to 1.0, but false accepts were already zero in both arms; the preregistered false-accept improvement gate failed.
- 2026-08-04: Phase 4 passed as an instrument. One matched two-task run showed 21.75% lower wall time for isolated parallel worktrees with both arms accepted and no conflicts; external task selection, repeated suites, accepted-outcome review, and cost telemetry remain missing.
- 2026-08-04: Phase 5 passed as a fail-honest instrument. The CLI now rejects unknown options and binds stores to the frozen experiment manifest; the local trial intentionally has zero scored records, four missing attempts, no utility claim, and no D7 evidence.
- 2026-08-04: Phase 6 local arm passed independent validation. Policy Enforcer blocked remote GitHub mutation under P-007 until the user explicitly approves creation of two public repos, Actions/protection configuration, and 30 PRs. P-008 also requires a paired remote control and strict protection/deploy realism before any claim.
- 2026-08-04: The user explicitly approved both disposable public repositories, Actions, strict branch protection, and 30 PRs. The frozen live run `proof-20260804` passed: both arms merged 15/15 and recorded one successful GitHub Deployment per merge SHA; control produced 34 failed merge races and 139 interventions, treatment produced 0 races, 0 interventions, and 0 repairs. This remains one run with simulated deployment records, not production deployment evidence.
- 2026-08-05: Phase 7 kept the compatibility-first profile, not the smallest measured profile. After retaining the live GitHub harness, three compact valid results, aggregate, invalid-run disclosure, cleanup record, and case study, the npm tarball is 9,123,375 packed and 22,066,567 unpacked bytes across 1,888 files; result hash `730a92d648da841fac98fec420ef4890dc06b3b7b6d49f6dcaf63a91205b55d3`. Installed smoke, experiment regression tests, and all 17 offline proof checks pass. Canonical contracts remain packaged under `benchmarks/`; generated traces remain ignored.
- 2026-08-04: Three Phase Validator attempts failed to return from their command loops after local gates passed, so Phase 7 was escalated to the acting Arbiter under the campaign protocol.
- 2026-08-04: Phase 8 fixed the remaining Real User Proof manifest migration, made compact package results refreshable, passed the full elevated strict suite and 17/17 offline replay, corrected the Arbiter's stale-metric block, and received binding final ACCEPT.
- 2026-08-05: Counterbalanced live repetitions completed against the unchanged contract. Valid runs `proof-20260804`, `proof-20260805-r2b`, and `proof-20260805-r3` merged and deployed 90/90 PRs exactly once. Controls accumulated 106 races, 315 stale updates, and 421 interventions; stewards accumulated 0 of each. Timing remains descriptive because API instrumentation coverage differs across the direct and steward paths.
- 2026-08-05: `proof-20260805-r2` was excluded after a transient GitHub failure exposed non-idempotent resume reconciliation. The harness recreated merged PRs whose deleted branches hid their identity. Resume now retains recorded merged PRs, and the regression is covered by the live harness suite.
- 2026-08-05: After explicit cleanup authorization, accidental R2 PRs 16 through 25 were closed with explanatory comments and duplicate branches `agent-01` through `agent-10` were deleted. Original unfinished PRs 11 through 15 remain open; neither disposable repository was deleted.
- 2026-08-05: Cross-platform CI exposed a second canonical-path seam in the native-memory allowlist. Canonicalizing the home projects root and testing an equivalent home alias restored macOS and Windows strict matrices without weakening symlink and junction escape protection.

## Review Queue

- [x] Architecture: Package canonical contracts and regression tests; keep generated traces and site-only evidence outside the runtime tarball.
- [ ] External: Identify independent repository owners for Real User Proof v2.
- [x] External: Approved and completed disposable public GitHub deploy-steward A/B.

## Circuit Breakers

- Three consecutive failures on the same experimental mechanism.
- Any new false pass, unknown-to-pass conversion, duplicate non-repeatable effect, or path-containment regression.
- Five or more new strict-suite failures from a build phase.
- Package reduction breaks install, runtime, or offline evidence replay.
- Experiment design drifts into simulated human or external evidence presented as real.

## Active Context

Campaign complete. Local proof claims, the three-run bounded public GitHub deploy result, invalid-run disclosure, remaining blocked human claims, package accounting, and reproduction commands are published.

## Continuation State

Phase: complete
Sub-step: none
Files modified: proof experiment runners/tests/contracts, live GitHub evidence summary, bounded public docs, package profile, canonical evidence inputs, and evidence-backed cleanup
Blocking: Real User Proof still requires independent owners and elapsed D7 evidence; deploy-steward replication under an independent account is required before any broader reliability claim
checkpoint-phase-1: stash@{0}
checkpoint-phase-2: 805627d
checkpoint-phase-3: 9492f8f
checkpoint-phase-4: 16a2d5e
checkpoint-phase-5: 64706bb
checkpoint-phase-6: e97c078
checkpoint-phase-7: aac620b


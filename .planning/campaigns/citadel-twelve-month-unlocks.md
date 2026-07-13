---
slug: citadel-twelve-month-unlocks
status: active
orchestrator: archon
created: 2026-07-13
updated: 2026-07-13
reversibility: amber
---

# Campaign: Citadel Twelve-Month Unlocks Now

Direction: Implement, test, and verify every locally achievable part of the eighteen-step, twelve-month Citadel milestone portfolio now. Preserve the full scope. Only leave items open when completion requires independent users, external maintainers, design partners, paid customers, elapsed retention windows, or other evidence that cannot be manufactured locally.

## Success Contract

- Each of the eighteen steps has current-state evidence, implemented artifacts, tests, and an explicit status.
- Existing foundations are reused only when their coverage is proven.
- Locally achievable product, protocol, receipt, control, recovery, dashboard, Pack, team-policy, Relay-interface, and reliability work is implemented rather than deferred.
- External adoption gates remain honest, measurable, and ready to collect evidence.
- Full repository verification passes before delivery.

## Phases

| Phase | Title | Type | Status | validator_retries_remaining |
|---|---|---|---|---:|
| 1 | Completion audit and architecture | research | complete | 2 |
| 2 | Productize, activate, and package outcomes | build | complete | 3 |
| 3 | Operations Protocol, compiler, and receipts | build | complete | 3 |
| 4 | Typed control, recovery, and Mission Control | build | complete | 3 |
| 5 | Ecosystem, teams, Relay seam, and reliability | build | complete | 3 |
| 6 | Conformance, full verification, documentation, and delivery | verify | in-progress | 3 |

## Phase End Conditions

| Phase | Condition type | Condition | Evidence |
|---|---|---|---|
| 1 | file_exists | `.planning/research/twelve-month-unlocks/COMPLETION-AUDIT.md` exists with all eighteen rows | passed |
| 1 | command_passes | `node scripts/test-all.js` establishes a passing or explicitly recorded baseline | passed with environment note; isolated Codex runtime rerun passed |
| 2 | command_passes | Packaging, install, starter journey, activation, and outcome Pack tests pass | passed |
| 2 | file_exists | Three outcome Pack manifests and proof-producing starter journeys exist | passed |
| 3 | command_passes | Protocol schema, projection, compiler, receipt, and signature-verification tests pass | passed |
| 3 | metric_threshold | Three targets pass the protocol conformance fixture with at least 90 percent shared contract coverage | passed at 100 percent with artifact-derived proof |
| 4 | command_passes | Typed control-plane, task lifecycle, checkpoint, idempotency, replay, chaos, and dashboard action tests pass | passed |
| 4 | metric_threshold | Chaos recovery matrix reports at least 99 percent deterministic recovery with zero duplicated external effects | passed at 100 percent across six injected fault boundaries |
| 5 | command_passes | Pack registry, provenance, permissions, team-policy, Relay-interface, export, and reliability-analysis tests pass | passed |
| 5 | file_exists | External evidence gates are encoded as machine-readable cohort, registry, team-pilot, Relay-demand, and reliability thresholds | passed |
| 6 | command_passes | `node scripts/test-all.js --strict` passes | passed in 199.8 seconds |
| 6 | command_passes | Release, documentation, distribution, ecosystem, dashboard, and conformance checks pass | passed; reproducible 1.2.0 archive verified locally and registry checks pass |
| 6 | manual | Review public wording, rendered Mission Control, and release scope | passed; browser capture repaired and recaptured |

## Eighteen-Step Completion Matrix

| # | Step | Phase | Status | Authoritative evidence |
|---:|---|---:|---|---|
| 1 | Finish the first activation cohort and speak to actual installers | 1-2 | locally complete; human evidence external | read-only Discussion collector, privacy schema, cohort report, and gates pass; independent submissions and interviews remain external |
| 2 | Ship the conventional CLI artifact and release provenance | 2 | locally complete; publication external | package CLI and packed smoke pass; provenance workflow in progress |
| 3 | Launch one proof-producing starter journey from the strongest observed use case | 2 | complete | all three Packs create durable operation journeys, evidence, handoffs, and receipts |
| 4 | Define the receipt envelope and attach it to that journey | 3 | complete | step-bound Ed25519 receipts and offline verification are attached to Pack journeys |
| 5 | Ship three outcome Packs | 2 | locally complete; adoption external | three Pack manifests, workflows and 15-test conformance suite pass |
| 6 | Publish real-run evidence including failures and unknowns | 2-3 | locally complete; independent runs external | strict proof ledger preserves passed, failed, blocked, and unknown fixture outcomes; independent trust requires external pins |
| 7 | Draft Operations Protocol v0.1 from campaigns and loops | 3 | complete | six contracts, schemas, compatibility policy and 13 protocol tests pass |
| 8 | Compile one workflow across local Citadel, Claude or Codex, and GitHub | 3 | complete | local, Codex and GitHub projections preserve 100 percent shared core contract |
| 9 | Release one narrow GitHub verification Action | 3 | locally complete; Marketplace external | read-only Action, least-privilege consumer workflow, receipts, and injection tests pass |
| 10 | Ship the typed MCP control plane and task lifecycle | 4 | complete | 21-call typed MCP suite covers list, read, pause, resume, stop, retry, revisions, capabilities, and stale-lock recovery |
| 11 | Add the durable execution journal and chaos recovery suite | 4 | complete | recovery 5/5, receipts 5/5 and chaos 7/7 pass with no duplicate nonrepeatable effects |
| 12 | Make Mission Control actionable for approvals, pause, resume, and replay | 4 | complete | secure local intent endpoint, operation controls, confirmations, browser QA, visual, interaction, and performance gates pass |
| 13 | Open a certified Pack alpha with outside-author-ready tooling | 5 | locally complete; outside authors external | Pack CLI, lifecycle, local index, certification and three first-party Packs pass |
| 14 | Publish Protocol 1.0 and its conformance suite | 5-6 | release candidate complete; 1.0 promotion external | v0.1 protocol and conformance runner pass; 1.0 remains gated on compatibility window, migration fixtures, and independent adapter evidence |
| 15 | Open the signed Pack registry and contributor ownership model | 5 | locally complete; publishers external | deterministic Ed25519 registry, separately pinned ownership, revocation, adversarial tests, and governance docs pass |
| 16 | Run the five-person, ten-repository team milestone | 5 | locally complete; real pilot external | exact hierarchical policy and five-operator, ten-repository simulator pass; real 30-day pilot remains external |
| 17 | Start Relay only if recurring team demand clears its gate | 5 | local seam complete; hosting external | encrypted local-first envelope and outbox pass containment, privacy, outage, and tamper tests; hosting remains gated at 10 recurring requests or 200 qualified waitlist |
| 18 | Begin reliability intelligence after representative consented evidence exists | 5 | analyzer complete; representative data external | analyzer requires 100 runs, 20 opaque repositories, two runtimes, and 20 held-out runs; insufficient data returns unknown and no recommendation |

## Decision Log

- 2026-07-13: The eighteen steps are the exact 4 + 5 + 4 + 5 actions in the research portfolio's four horizons.
- 2026-07-13: Work begins from isolated branch `codex/citadel-12-month-unlocks` at `origin/main` commit `cc14589`; the user's dirty primary checkout is untouched.
- 2026-07-13: External adoption thresholds will be implemented as collection, reporting, and decision gates, but their outcomes will not be fabricated.
- 2026-07-13: Campaign-start telemetry could not initialize `.planning/telemetry` in the isolated worktree due a local permission error; this is recorded and does not block product work.
- 2026-07-13: Phase 1 validator attempt 1 failed because command output was not preserved as a phase-specific artifact. Retry count decremented to 2 and `.planning/research/twelve-month-unlocks/BASELINE-EVIDENCE.md` added with exact command, exit, failure, and isolated passing rerun evidence.
- 2026-07-13: Operations Protocol v0.1 is the shared contract foundation. Local, Codex, and GitHub compiler targets preserve 100 percent of the eleven declared semantic fields.
- 2026-07-13: External milestone thresholds are now executable and default to `awaiting_external_evidence`; fixtures cannot promote adoption state.

## Feature Ledger

- Campaign and authoritative eighteen-step completion matrix created.
- Three parallel repository audits assigned across product growth, protocol/control, and ecosystem/team scopes.
- Phase 1 completion audit reconciled all eighteen steps against source and tests.
- Baseline full suite passed all checks except one sandbox-denied temporary fixture; the exact Codex runtime test passed outside that restriction.
- Conventional package CLI implemented with runtime detection, package allowlist, doctor/update/rollback/uninstall, and a packed-tarball executable smoke test.
- Operations Protocol v0.1 implemented with six strict contracts, canonical digests, status transitions, privacy allowlists, JSON Schema, and public exports.
- Durable journal, crash recovery, idempotency/effect rules, Ed25519 execution receipts, and offline verification implemented; 17 recovery/receipt/chaos tests pass.
- Deterministic workflow compiler implemented for local, Codex, and GitHub Actions at 100 percent shared core contract coverage.
- Certified Pack foundation implemented with three first-party outcome Packs; 15 tests pass and one platform-specific symlink creation case skips honestly.
- External activation, adoption, ecosystem, team, Relay demand, and reliability sufficiency thresholds implemented as non-network decision gates.

## Exit Evidence

| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |
|---|---|---|---|---|---|---:|---|
| phase:1 | audit | doc_update | yes | `.planning/research/twelve-month-unlocks/COMPLETION-AUDIT.md` | passed | 2 | none |
| phase:2 | product | test_result | yes | `npm run test:unlocks` | passed | 3 | none |
| phase:3 | protocol | test_result | yes | `node scripts/test-workflow-compiler.js` | passed | 3 | none |
| phase:4 | control | screenshot | yes | `output/playwright/mission-control-confirmation-fixed.png` | passed | 3 | none |
| phase:5 | ecosystem | test_result | yes | `node scripts/test-pack-registry.js` | passed | 3 | none |
| phase:6 | release | command_result | yes | `node scripts/test-all.js --strict` and verified local 1.2.0 archive | passed | 3 | push reviewed branch, open PR, wait for unchanged-head CI, merge through protection |

## Active Context

Phases 1 through 6 are complete. The full strict suite passes, the local 1.2.0 archive verifies, Mission Control passed browser QA, and all eleven P1 review findings are repaired with adversarial regressions. The implementation campaign is complete; protected GitHub delivery is the remaining operational action.

## Continuation State

- current_phase: complete
- current_substep: protected GitHub delivery
- worktree: `C:\tmp\citadel-12-month-unlocks`
- branch: `codex/citadel-12-month-unlocks`
- baseline_commit: `cc14589`
- checkpoint-phase-1: none
- files_modified: package CLI and 1.2 version surfaces; Operations Protocol, compiler, journal, recovery, receipts and conformance; Pack platform, signed registry, three Packs and journeys; Action and publishing workflow; typed MCP and Mission Control; proof, team, Relay, milestones, activation collector and reliability analyzer; public docs and visual evidence
- blockers: none for local delivery; adoption, publishers, independent adapter evidence, real team pilot, hosted Relay demand and representative reliability data remain external gates
- next_actions: push reviewed branch; open PR; wait for unchanged-head CI; merge without bypass

---
version: 1
id: "e021dbbd-3bcb-4888-8670-c2aeab6dae79"
status: active
started: "2026-07-10T14:25:12.420Z"
completed_at: null
direction: "Convert the approved seven-phase Citadel 1.1 plan into a persistent campaign, execute the baseline, and build an operable, observable, proven product release."
phase_count: 7
current_phase: 4
branch: main
worktree_status: null
---

# Campaign: Citadel 1.1 — Operable, Observable, Proven

Status: active
Started: 2026-07-10T14:25:12.420Z
Direction: Convert the seven approved phases into an Archon campaign and execute them in dependency order, beginning with the authoritative baseline and release/reliability foundation.

## Claimed Scope

- package.json
- README.md
- INSTALL.md
- DEMO.md
- CHANGELOG.md
- citadel-metadata.json
- .claude-plugin/
- .codex-plugin/
- .github/workflows/
- assets/dashboard-overview.png
- benchmarks/
- core/telemetry/
- dashboard/
- docs/
- scripts/
- skills/setup/
- .planning/product-proof/

## Phases

| # | Status | Type | Phase | Done When | Validator retries remaining |
|---|---|---|---|---|---:|
| 1 |  complete | research | Baseline and scope lock | Baseline artifact records exact git/test/install/dashboard/release/measurement state and the managed-checkout failure is reproduced without product mutation | 3 |
| 2 |   complete | build | Hermetic reliability and versioned release | Strict suite passes from writable and read-only source copies; deterministic release, checksum, update, rollback, and OS/runtime matrix gates pass | 3 |
| 3 |   complete | build | Local activation and acquisition measurement | Privacy-safe local funnel and maintainer acquisition snapshots pass schema, redaction, no-network, history, and reporting tests | 3 |
| 4 |  in-progress | build | Stranger-tested golden path | Claude/Codex × Linux/macOS/Windows matrix exceeds 95%; first route and verified handoff timing gates pass; rollback restores fixtures | 3 |
| 5 | pending | build | Complete R1 See It and R2 Prove It | Dashboard comprehension/performance/honesty gates and symmetric public benchmark utility gates pass with raw reproducible evidence | 3 |
| 6 | pending | wire | Ecosystem and distribution proof | Unmodified external skill runs under Citadel; canonical metadata is drift-free; both plugin scanners and verified registry profiles pass | 3 |
| 7 | pending | verify | Showcase and product-proof scorecard | Tagged release, real demo, benchmark, dashboard, user trials, retention, compatibility, and product-proof report satisfy every milestone exit gate | 3 |

## Phase End Conditions

| Phase | Condition type | Check command or description |
|---:|---|---|
| 1 | file_exists | .planning/product-proof/baseline.md |
| 1 | command_passes | node -e "const fs=require('fs');const s=fs.readFileSync('.planning/product-proof/baseline.md','utf8');for(const k of ['Git state','Strict suite','Installer','Codex runtime','Native integration','Dashboard','Release','Activation','Benchmark','Known managed-checkout failure'])if(!s.includes(k))process.exit(1)" |
| 1 | command_passes | node scripts/test-installers.js |
| 1 | command_passes | node scripts/test-codex-runtime.js |
| 1 | command_passes | node scripts/test-codex-native-integrations.js |
| 2 | command_passes | node scripts/test-all.js --strict |
| 2 | command_passes | node scripts/test-release-integrity.js |
| 2 | command_passes | node scripts/test-installers.js |
| 2 | command_passes | node scripts/release-package.js --dry-run --verify-reproducible |
| 2 | file_exists | CHANGELOG.md |
| 2 | file_exists | docs/RELEASES.md |
| 3 | command_passes | node scripts/test-activation-telemetry.js |
| 3 | command_passes | node scripts/test-github-traffic-snapshot.js |
| 3 | file_exists | docs/ACTIVATION_METRICS.md |
| 4 | command_passes | node scripts/test-golden-path.js |
| 4 | metric_threshold | golden-path matrix reports install/setup success >95%, median first route <10 minutes, p90 verified handoff <15 minutes |
| 4 | command_passes | node scripts/test-usefulness-trial.js |
| 5 | command_passes | node scripts/test-dashboard-web.js |
| 5 | command_passes | node scripts/test-dashboard-perf.js |
| 5 | command_passes | node scripts/test-dashboard-visual.js |
| 5 | command_passes | node scripts/test-product-benchmark.js |
| 5 | metric_threshold | published benchmark is no worse on verified completion and clears the declared intervention or recovery improvement gate with <=15% median overhead |
| 6 | command_passes | node scripts/test-ecosystem-compat.js |
| 6 | command_passes | node scripts/generate-distribution-metadata.js --check |
| 6 | manual | ClaudePluginHub and HOL publisher profiles show verified identity and current release metadata |
| 7 | command_passes | node scripts/test-all.js --strict |
| 7 | command_passes | node scripts/release-verify.js |
| 7 | file_exists | docs/PRODUCT_PROOF_REPORT.md |
| 7 | metric_threshold | 8/10 first-time users reach a verified handoff within 15 minutes and five independent users complete a second real task within 14 days |
| 7 | manual | User approves the truthful 90-second demo and product-proof positioning |

## Exit Evidence

| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |
|---|---|---|---|---|---|---:|---|
| phase:1 | baseline | doc_update | yes | .planning/product-proof/baseline.md | pass | 3 | baseline captured 2026-07-10T14:41:20.623Z |
| phase:1 | installers | test_result | yes | node scripts/test-installers.js | pass | 3 | exit 0: installer tests passed |
| phase:1 | codex-runtime | test_result | yes | node scripts/test-codex-runtime.js | pass | 3 | exit 0: codex runtime tests passed |
| phase:1 | native-integration | test_result | yes | node scripts/test-codex-native-integrations.js | pass | 3 | exit 0: codex native integration tests passed |
| phase:2 | strict-suite | test_result | yes | node scripts/test-all.js --strict | pass | 3 | exit 0 in 230.5s; all strict tests pass |
| phase:2 | release-integrity | test_result | yes | node scripts/test-release-integrity.js | pass | 3 | exit 0; integrity and planning-state exclusion pass; reproducible SHA-256 c0570b739aea78b92506254b38e9b52c4848d09c4f0720f57a7147e51b79e246 |
| phase:2 | release-docs | doc_update | yes | CHANGELOG.md; docs/RELEASES.md | pass | 3 | version, package, verification, plan-first update, rollback, compatibility, and release invariants documented |
| phase:3 | activation-tests | test_result | yes | node scripts/test-activation-telemetry.js | pass | 3 | 17/17: schema, privacy rejection, opt-out, migration, full journey, redaction, and zero-network pass |
| phase:3 | acquisition-tests | test_result | yes | node scripts/test-github-traffic-snapshot.js | pass | 3 | endpoint, API version, watcher semantics, token redaction, fixture, and append-only history tests pass |
| phase:3 | measurement-docs | doc_update | yes | docs/ACTIVATION_METRICS.md | pass | 3 | privacy contract, stages, acquisition limits, commands, and honest interpretation documented |
| phase:3 | activation-baseline | file_diff | yes | .planning/product-proof/activation-report.json | pass | 3 | truthful local baseline: zero historical events; no activation history was invented |
| phase:3 | strict-regression | test_result | yes | node scripts/test-all.js --strict | pass | 3 | exit 0 in 234.1s; activation and acquisition suites included in aggregate gate |
| phase:4 | golden-path | test_result | yes | node scripts/test-golden-path.js | pass | 3 | Claude and Codex fixture paths, failures, resume, and exact rollback pass |
| phase:4 | matrix-contract | test_result | yes | node scripts/test-golden-path-matrix.js | pass | 3 | strict grid, merge, percentile, threshold, duplicate, and failed-run retention tests pass |
| phase:4 | windows-matrix | test_result | yes | .planning/product-proof/golden-path-matrix-windows.json | pass | 3 | hardened rerun: 10/10 Windows fixture runs pass; median route 3124.5ms, p90 handoff 23715ms, resume and rollback 100% |
| phase:4 | strict-regression | test_result | yes | node scripts/test-all.js --strict | pass | 3 | final post-review exit 0 in 363.5s with fixture and matrix suites integrated |
| phase:4 | cross-os-grid | test_result | yes | .planning/product-proof/golden-path-matrix-complete.json | pending | 3 | requires five Claude and five Codex runs on win32, linux, and darwin; no platforms synthesized |
| phase:4 | stranger-timing | test_result | yes | recorded first-time-user trial cohort | pending | 3 | fixture milliseconds are not human install-to-value evidence |
| phase:5 | dashboard-proof | test_result | yes | dashboard web/perf/visual tests | pending | 3 | complete R1 |
| phase:5 | benchmark-proof | test_result | yes | product benchmark report and raw runs | pending | 3 | complete R2 |
| phase:6 | interoperability | test_result | yes | node scripts/test-ecosystem-compat.js | pending | 3 | run external skill fixture |
| phase:7 | milestone-report | doc_update | yes | docs/PRODUCT_PROOF_REPORT.md | pending | 3 | assemble final scorecard |
| campaign | review-package | file_diff | yes | .planning/review-packages/citadel-product-proof.md | pending | 3 | package after verification |

## Feature Ledger

| Feature | Status | Phase | Notes |
|---|---|---:|---|
| Product-proof architecture | complete | 0 | .planning/architecture-citadel-product-proof.md; seven-phase inconsistency corrected before campaign creation |
| Campaign state | in-progress | 4 | Persistent seven-phase campaign created; stranger-tested golden path is active |
| Baseline | complete | 1 | Exact commands, durations, statuses, and proven/partial/missing evidence recorded |
| Release/reliability foundation | complete | 2 | Strict suite, release integrity, reproducibility, installer, documentation, updater safety, and independent validation pass |
| Local activation and acquisition measurement | complete | 3 | Privacy-safe activation, GitHub history, docs, strict regression, 5/5 evidence, and independent validation pass; live snapshot remains operator-gated |
| Deterministic golden-path fixture | complete | 4 | Both runtime preparations reach 5/5 usefulness, HANDOFF, fresh continuation, closed failures, exact rollback, and independent security review pass |
| Golden-path evidence matrix | in-progress | 4 | Hardened Windows rerun 10/10 passes; Linux, macOS, and stranger trial evidence remain |

## Decision Log

- 2026-07-10T14:25:12.420Z: Bound the campaign to seven phases by combining dashboard and benchmark into one parallel R1/R2 phase.
  Reason: matches the approved seven-step milestone while retaining independent workstreams and gates.
- 2026-07-10T14:25:12.420Z: Skip a separate daemon file.
  Reason: the active persistent goal already supplies automatic multi-turn continuation; duplicate daemons could race campaign state.
- 2026-07-10T14:25:12.420Z: Keep activation measurement local-first with explicit redacted export.
  Reason: measurement must not compromise Citadel's local-first trust contract.
- 2026-07-10T14:25:12.420Z: Treat a missed benchmark utility gate as a milestone failure, not a reporting inconvenience.
  Reason: the release must prove usefulness rather than optimize presentation.
- 2026-07-10T14:34:41.165Z: Policy gate allowed implementation of the release workflow and local release tooling.
  Reason: no push, tag, release, force operation, bypass, or secret is performed during this
  phase. A later push/tag that triggers publishing requires a separate P-007 confirmation.
- 2026-07-10T14:32:14.743Z: Phase 1 checkpoint could not be created; recorded as none.
  Reason: the managed session denies writes to `.git/index.lock`. Campaign and architecture
  state remain on disk, and checkpoint failure is non-blocking under the Archon protocol.
- 2026-07-10T14:42:15.529Z: Phase 1 direction and quality checks are aligned.
  Reason: the baseline distinguishes current proof from missing milestone evidence, records
  all strict failures without weakening gates, and preserves the no-new-skills scope lock.

- 2026-07-10T14:48:36.982Z: Phase 1 validator passed all conditions with no failed conditions.
  Reason: baseline labels, focused checks, dashboard evidence, Exit Evidence, and managed
  checkout isolation were independently rechecked. Campaign advanced to Phase 2.

- 2026-07-10T14:52:52.374Z: Phase 2 checkpoint could not be created; recorded as none.
  Reason: the managed session still denies `.git/index.lock` writes. Two non-overlapping
  workstreams were delegated with file-level scope boundaries instead.

- 2026-07-10T15:42:18.108Z: Phase 2 validator passed all ten conditions with no failed conditions.
  Reason: independent focused checks confirmed evidence integrity, deterministic packaging,
  manifest alignment, truthful unreleased documentation, update/rollback safety, planning-state
  exclusion, preserved regression coverage, and absence of local tags or publishing actions.

- 2026-07-10T15:42:18.108Z: Narrowed release workflow permissions after validator review.
  Reason: verification now runs with `contents: read`; only the package/release job receives
  `contents: write`. Focused release-integrity and diff checks passed after the hardening change.

- 2026-07-10T15:42:18.108Z: Direction and quality review remain aligned after two phases.
  Reason: Phase 0 established honest current proof, Phase 1 made the suite hermetic and created
  a reversible deterministic release path without expanding scope into new skills or publishing.

- 2026-07-10T17:00:34.980Z: Phase 3 checkpoint could not be created; recorded as none.
  Reason: the managed session still denies `.git/index.lock` writes. The existing release work
  remains visible in the working tree and Phase 3 continues under a registered coordination claim.

- 2026-07-10T17:22:16.649Z: Separated acquisition attention from local activation proof.
  Reason: GitHub views, clones, referrers, paths, and stars cannot establish setup or usefulness.
  Activation remains local-only, opt-out capable, strict-schema, and explicitly exported.

- 2026-07-10T17:22:16.649Z: Recorded an honest empty activation baseline.
  Reason: activation instrumentation did not exist for prior users, so the current report has zero
  events. Historical conversions and sources remain unknown rather than being inferred from stars.

- 2026-07-10T17:22:16.649Z: Live GitHub traffic capture is authentication-gated.
  Reason: local `gh` authentication is invalid and no GH_TOKEN or GITHUB_TOKEN is available. The
  live command fails safely without writing a snapshot; fixture and injected-request tests pass.

- 2026-07-10T17:33:52.819Z: Phase 3 strict regression passed in 234.1 seconds.
  Reason: the warning-as-error aggregate includes both activation and acquisition suites and all
  existing hook, runtime, installer, dashboard, security, and release gates remained green.

- 2026-07-10T17:33:52.819Z: Phase 3 validator passed all eleven conditions plus quality review.
  Reason: independent inspection confirmed the local privacy boundary, zero-network activation,
  credential redaction, append-only acquisition history, truthful empty baseline, documentation,
  integration, and evidence. The live snapshot remains a non-blocking operator review item.

- 2026-07-10T17:36:46.496Z: Phase 4 checkpoint could not be created; recorded as none.
  Reason: the managed session still denies `.git/index.lock` writes. Phase 4 proceeds under a
  fresh coordination claim without hiding or overwriting the prior phase work.

- 2026-07-10T18:48:44.618Z: Defined fixture automation as engineering proof, not stranger proof.
  Reason: real local installers, setup bootstrap, routing, verification, handoff, continuation,
  and rollback are automatable; plugin registration, LLM work, comprehension, and human timing are not.

- 2026-07-10T18:48:44.618Z: Windows golden-path matrix produced ten successful actual runs.
  Reason: five Claude and five Codex fixture journeys all passed install/setup, verified handoff,
  fresh-process resume, and exact rollback. Median route was 4102ms and p90 handoff was 17608ms.
  The result remains `MATRIX_INCOMPLETE_GRID` because Linux and macOS evidence is absent.

- 2026-07-10T18:48:44.618Z: Phase 4 strict regression passed in 530.6 seconds.
  Reason: the full warning-as-error harness suite includes golden-path fixture and matrix tests;
  all previous release, measurement, runtime, installer, hook, security, and dashboard gates pass.

- 2026-07-10T19:53:35.253Z: Independent golden-path implementation review initially blocked on symlink containment.
  Reason: lexical checks could admit symlink escapes and the reviewer also found credential-redaction,
  output-bound, cleanup, failed-timing, and mixed-fixture weaknesses. All findings were repaired with
  realpath/symlink rejection, credential-safe staging, bounded complete JSON parsing, unconditional
  cleanup, nullable unavailable timings, and per-run fixture identity validation.

- 2026-07-10T19:53:35.253Z: Targeted re-review passed with no actionable findings.
  Reason: the reviewer confirmed every original finding plus common credential-file and plugin-stage
  symlink hardening. Focused fixture tests, matrix tests, syntax, and diff checks pass.

- 2026-07-10T19:53:35.253Z: Hardened Windows matrix and final strict regression pass.
  Reason: ten of ten actual local runs remain green with median route 3124.5ms and p90 handoff
  23715ms; final warning-as-error aggregate exits 0 in 363.5 seconds. Only the real cross-OS grid
  and human stranger-timing evidence remain pending.

- 2026-07-10T20:28:00.000Z: Policy gate allowed cross-platform CI evidence and a later reviewed main push.
  Reason: the user explicitly authorized CI and publishing; the enforcer requires a normal push,
  no hook bypass, no tags/releases/deployments, and a final staged-secret and scope audit.

## Review Queue

- [ ] UX: Review the final first-run journey with ten users who have never installed Citadel.
- [ ] Visual: Approve the final dashboard capture and 90-second demo.
- [ ] Architecture: Review activation privacy fields and release rollback boundary before Phase 3.
- [ ] Acquisition: Capture the first live `SethGammon/Citadel` traffic snapshot after maintainer authentication or explicit Chrome fallback approval.
- [ ] Golden path: Approve CI workflow changes and publishing of run artifacts before collecting Linux/macOS matrix evidence.
- [ ] Golden path: Run the first-time-user cohort; fixture timing cannot satisfy the human median/p90 gate.
- [ ] Performance: Review benchmark methodology and frozen metrics before full runs.

## Circuit Breakers

- Three consecutive failures on the same approach.
- Five or more new syntax/type-contract errors in one phase.
- Any regression in existing installer/runtime/security/hook behavior.
- Activation telemetry attempts automatic remote transmission or captures prohibited content.
- Benchmark scenarios or metrics change after results are known without a documented restart.
- Dashboard creates writable state or a second source of truth.
- Direction drift toward more skills, a hosted service, or a third runtime adapter.

## Active Context

Phases 1 through 3 are complete. Phase 4 fixture automation is complete, independently reviewed,
and green on Windows: ten of ten hardened local Claude/Codex preparation journeys pass with exact
rollback, and the final strict suite is green. Phase 4 remains active only because Linux/macOS grid
evidence and real stranger timing do not exist. CI modification/publishing and the trial cohort
require operator authority.

## Continuation State

Phase: 4
Sub-step: collect real Linux/macOS matrix artifacts and stranger-trial timing evidence
Files modified: prior Phase 2 files plus .gitignore, README.md, CHANGELOG.md, package.json, core/telemetry/activation.js, core/telemetry/github-traffic.js, scripts/activation-telemetry.js, scripts/github-traffic-snapshot.js, scripts/test-activation-telemetry.js, scripts/test-github-traffic-snapshot.js, scripts/test-all.js, docs/ACTIVATION_METRICS.md, .planning/product-proof/activation-report.json, and this campaign file
Blocking: none
checkpoint-phase-1: none
checkpoint-phase-2: none
checkpoint-phase-3: none
checkpoint-phase-4: none
Next actions:
1. Obtain explicit approval before changing CI or publishing matrix artifacts.
2. Run five Claude and five Codex fixture journeys on Linux and macOS, then merge with the Windows report using `--require-complete`.
3. Run the first-time-user cohort and record real install-to-route and install-to-handoff timing.
4. Validate complete Phase 4 Exit Evidence and obtain an independent phase-validator verdict.

<!-- session-end: 2026-07-10T15:45:46.955Z -->

<!-- session-end: 2026-07-10T20:01:22.223Z -->

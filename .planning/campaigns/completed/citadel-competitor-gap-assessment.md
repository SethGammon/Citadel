# Campaign: Citadel Competitor Gap Assessment

Status: completed
Direction: Research 20 high-overlap competitors, products, repos, services, and
technique sources for Citadel; identify overlap/gaps; decide what belongs in
Citadel; produce implementation plans ready for approval.

## Phases

| # | Status | Type | Phase | Done When |
|---|--------|------|-------|-----------|
| 1 | complete | build | Local Citadel Control Plane | `npm run dashboard` renders a read-only operator snapshot and `npm run test` passes |
| 2 | complete | build | Fleet DAG and Merge Steward | `node scripts/fleet-steward.js` reports ready/blocked/mergeable Fleet work and `npm run test` passes |
| 3 | complete | build | Worktree Environment Readiness Profiles | `node scripts/worktree-readiness.js` records worktree readiness and Fleet/dashboard expose blockers |
| 4 | complete | build | Signed Telemetry and Artifact Lineage | `node scripts/verify-telemetry-integrity.js` verifies hashed telemetry/artifact records and detects tampering |
| 5 | complete | build | Memory Compiler and Semantic Blocks | `npm run memory:compile` writes five source-backed memory block types and `npm run memory:lint` passes |
| 6 | complete | build | Phase Exit Evidence Contracts | `node scripts/evidence-validate.js --file .planning/campaigns/citadel-competitor-gap-assessment.md --target phase:6` passes and missing evidence creates repair tasks |
| 7 | complete | build | Sandbox Provider Contract | `npm run sandbox:matrix` reports provider capabilities and `node scripts/test-sandbox-provider.js` passes |
| 8 | complete | build | Skill and Workflow Packaging Upgrade | `node scripts/test-skill-packaging.js` passes and `node scripts/skill-catalog.js --task-class quality` shows skills by task class/risk |
| 9 | complete | docs | Thin Runtime Adapter Matrix | `npm run runtime:matrix` reports adapter levels/tradeoffs and `node scripts/test-runtime-matrix.js` passes |
| 10 | complete | build | Shared Repo Map Substrate | `node scripts/test-map-substrate.js` passes and `node scripts/map-index.js --slice "runtime adapter"` emits a scoped map slice |

## Research Package

Detailed local research artifacts:

- `.planning/research/citadel-competitor-gap-assessment-2026-06-04/INDEX.md`
- `.planning/research/citadel-competitor-gap-assessment-2026-06-04/selection-matrix.md`
- `.planning/research/citadel-competitor-gap-assessment-2026-06-04/writeups.md`
- `.planning/research/citadel-competitor-gap-assessment-2026-06-04/determinations.md`
- `.planning/research/citadel-competitor-gap-assessment-2026-06-04/implementation-plans.md`

## Selected References

Stoneforge, Ruah, Handler.dev, webmux, Bernstein, Claude Squad, Orca, Verun,
dux, BMad Method, Claude Code native stack, OpenAI Codex, GitHub Copilot cloud
agent, Cursor Background Agents, Factory Droids, OpenHands, SWE-agent/SWE-ReX,
Aider, LangGraph, Letta.

## Determinations

Accepted for implementation planning:

1. Local Citadel control-plane dashboard.
2. Dependency-aware Fleet DAG and merge steward.
3. Worktree/sandbox environment readiness profiles.
4. Signed append-only telemetry and artifact lineage.
5. Memory compiler and semantic memory blocks.
6. Phase exit evidence contracts.
7. Sandbox-provider abstraction.
8. Skill and workflow packaging upgrade.
9. Thin runtime adapter discipline.
10. Shared repo map substrate.

Monitor or defer:

- Full embedded IDE.
- Hosted SaaS agent runner.
- Broad tracker marketplace.
- Enterprise Agent Framework parity.

Rejected:

- Replacing Citadel with a general agent framework.
- Auto-merge without explicit evidence contracts.

## Implementation Queue

Approval-ready plans are in:

`.planning/research/citadel-competitor-gap-assessment-2026-06-04/implementation-plans.md`

Recommended approval order:

1. Local Citadel Control Plane.
2. Fleet DAG and Merge Steward.
3. Worktree Environment Readiness Profiles.
4. Signed Telemetry and Artifact Lineage.
5. Memory Compiler and Semantic Blocks.
6. Phase Exit Evidence Contracts.
7. Sandbox Provider Contract.
8. Skill and Workflow Packaging Upgrade.
9. Thin Runtime Adapter Matrix.
10. Shared Repo Map Substrate.

## Decision Log

- User approved proceeding from the research package into implementation.
- Plan 1 was implemented first because it improves operational visibility while staying read-only.
- The dashboard stays CLI-first and state-derived; no separate dashboard state store was introduced.
- Plan 2 implemented Fleet DAG parsing as a core module plus a read-only-by-default steward CLI; repair-task writes require explicit `--write`.
- Fleet docs, skill guidance, and the Fleet agent prompt now share the same dependency-aware work queue shape.
- Plan 3 implemented read-only worktree readiness profiles and reports; WorktreeCreate records readiness after setup without blocking creation.
- Fleet steward now parks readiness-blocked tasks unless `--override-readiness` is explicit, and the dashboard summarizes readiness reports.
- Plan 4 implemented telemetry integrity for new records while keeping old records readable as legacy.
- Agent-run telemetry and Codex artifact evidence now include lineage IDs and `_hash`; optional HMAC uses `CITADEL_TELEMETRY_HMAC_KEY`.
- Plan 5 implemented deterministic semantic memory blocks in `.planning/memory/blocks/` with source linting and scoped loading for agents.
- `/learn` can run memory compilation directly, and `/daemon` records safe consolidation passes without allowing memory failures to create overlapping ticks.
- Plan 6 implemented optional `## Exit Evidence` contracts for campaigns and Fleet sessions, with validator output that blocks advancement or writes repair tasks for missing required evidence.
- Archon and Fleet now validate phase/task evidence before promotion when an evidence table is present.
- Plan 7 introduced a minimal sandbox provider boundary with a supported `worktree` provider and explicit unsupported `docker`/`remote` placeholders.
- Worktree creation and cleanup stay owned by native lifecycle hooks; provider v1 exposes capability matrix, attach, status, snapshot, and readiness.
- Plan 8 added optional skill packaging metadata, metadata-aware linting, a local skill catalog, and a scaffold command that emits valid SKILL.md plus optional benchmark files.
- Existing skills remain lint-clean without forced metadata migration; catalog inference fills the initial discovery gap.
- Plan 9 added explicit runtime adapter levels so Citadel can describe what each runtime guarantees instead of implying hook parity everywhere.
- Runtime matrix output is available as both human-readable CLI text and JSON for automation, and docs now list each runtime's tradeoffs.
- Plan 10 moved `/map` behavior into a shared `core/map` module with hashes, routes, package scripts, verification commands, scoped slices, and stale detection.
- Archon and Fleet now request generated map slices through `node scripts/map-index.js --slice`, keeping agent-injected orientation consistent.

## Exit Evidence

| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |
|---|---|---|---|---|---|---|---|
| phase:4 | telemetry-integrity-live | command_result | yes | npm run telemetry:verify | pass | 2 | rerun telemetry verifier |
| phase:4 | telemetry-integrity-tests | test_result | yes | node scripts/test-telemetry-integrity.js | pass | 2 | fix telemetry integrity tests |
| phase:5 | memory-compile-live | command_result | yes | npm run memory:compile | pass | 2 | rerun memory compiler |
| phase:5 | memory-scoped-load | command_result | yes | node scripts/memory-compile.js list --scope verification | pass | 2 | fix scoped memory block loading |
| phase:6 | evidence-contract-tests | test_result | yes | node scripts/test-evidence-contracts.js | pass | 2 | fix evidence contract tests |
| phase:7 | sandbox-provider-matrix | command_result | yes | npm run sandbox:matrix | pass | 2 | fix sandbox provider matrix |
| phase:7 | sandbox-provider-tests | test_result | yes | node scripts/test-sandbox-provider.js | pass | 2 | fix sandbox provider tests |
| phase:8 | skill-packaging-tests | test_result | yes | node scripts/test-skill-packaging.js | pass | 2 | fix skill packaging tests |
| phase:8 | skill-catalog-filter | command_result | yes | node scripts/skill-catalog.js --task-class quality | pass | 2 | fix skill catalog filters |
| phase:9 | runtime-matrix-cli | command_result | yes | npm run runtime:matrix | pass | 2 | fix runtime matrix CLI |
| phase:9 | runtime-matrix-tests | test_result | yes | node scripts/test-runtime-matrix.js | pass | 2 | fix runtime matrix tests |
| phase:10 | map-substrate-tests | test_result | yes | node scripts/test-map-substrate.js | pass | 2 | fix map substrate tests |
| phase:10 | map-slice-live | command_result | yes | node scripts/map-index.js --slice "runtime adapter" --max-files 10 | pass | 2 | fix map slice output |
| phase:10 | map-stale-live | command_result | yes | npm run map:stale | pass | 2 | fix map stale check |

## Continuation State

Next action: run full verification and prepare approval-ready handoff.

<!-- session-end: 2026-06-04T17:25:00.726Z -->

<!-- session-end: 2026-06-04T17:58:54.380Z -->

<!-- session-end: 2026-06-04T18:15:19.386Z -->

<!-- session-end: 2026-06-04T19:13:00.478Z -->

<!-- session-end: 2026-06-04T19:30:19.902Z -->

<!-- session-end: 2026-06-04T19:31:59.687Z -->

<!-- session-end: 2026-06-04T20:13:52.880Z -->

<!-- session-end: 2026-06-04T20:16:30.343Z -->

<!-- session-end: 2026-06-04T20:20:08.723Z -->

<!-- session-end: 2026-06-05T15:23:50.873Z -->

<!-- session-end: 2026-06-05T15:26:19.599Z -->


## Completion Record

- Completed At: 2026-06-05T15:33:15.520Z
- PR: https://github.com/SethGammon/Citadel/pull/135
- Merge SHA: 4ff456f159b83f5dbe749d8c6ecd431578fef00c
- Verification: npm run test plus campaign evidence validation
- Note: Merged approved competitor-gap implementation queue.



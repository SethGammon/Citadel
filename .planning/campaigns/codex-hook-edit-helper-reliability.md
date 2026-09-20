# Campaign: Codex Hook and Edit-Helper Reliability

> Direction: Eliminate the Citadel hook failures that can emit invalid Codex PreToolUse output, destabilize the edit helper, and prevent Archon checkpoint metadata from being persisted.
> Source: User report from the 2026-09-20 `sortable-dashboard-entries` campaign plus clean reproductions of `helper_unknown_error: setup refresh had errors` and an outside-root edit-helper block.
> Status: active
> Risk: amber
> Started: 2026-09-20
> Estimated sessions: 1
> Estimated cost: $3

## Scope

Diagnose and repair the Codex hook output boundary and Citadel campaign mutation path in the Citadel source repository. Add synthetic, credential-free regression coverage for Windows PreToolUse output, apply-patch warnings/denials, and current Archon campaign table updates. Do not read protected telemetry, provider configuration, credentials, prompts, transcripts, histories, raw payloads, or account identifiers. Preserve all pre-existing campaign-file changes and the active MCP coordination claim.

## Claimed Scope

- `hooks_src/codex-adapter.js`
- `runtimes/codex/generators/install-hooks.js`
- `runtimes/codex/hooks.json`
- `core/campaigns/update-campaign.js`
- `scripts/test-codex-runtime.js`
- `scripts/test-campaign-core.js`
- `scripts/test-hook-installers.js`
- `scripts/integration-test.js`
- `.planning/campaigns/codex-hook-edit-helper-reliability.md`
- `.planning/coordination/claims/archon-codex-hook-edit-helper-reliability.json`

## Restricted Files

- `.planning/telemetry/**`
- `.claude/settings.json`
- `.codex/**`
- provider credentials, auth/config files, prompts, transcripts, histories, projects, raw payloads, and account identifiers

## Phase End Conditions

| Phase | Type | Title | Status | Required end conditions | validator_retries_remaining |
|---|---|---|---|---|---:|
| 1 | research | Reproduce and bind root causes | complete | `command_passes: rtk node scripts/test-codex-runtime.js`; a synthetic PreToolUse apply-patch warning reproduction is recorded; current Archon table update behavior is covered by a failing-or-passing focused fixture; no protected telemetry is read | 3 |
| 2 | build | Harden hook projection and campaign mutation | complete | `command_passes: rtk node scripts/test-codex-runtime.js`; `command_passes: rtk node scripts/test-campaign-core.js`; PreToolUse stdout is empty or schema-valid JSON for allow, warn, malformed-input, and deny paths; current and legacy campaign tables update the intended status cell atomically | 3 |
| 3 | verify | Runtime and regression verification | partial | `command_passes: rtk node scripts/test-hook-installers.js`; `command_passes: rtk node scripts/verify-hooks.js`; `command_passes: rtk node scripts/integration-test.js`; `command_passes: rtk node scripts/test-all.js`; a synthetic installed-hook edit succeeds and campaign checkpoint metadata remains writable | 2 |

## Exit Evidence

| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |
|---|---|---|---|---|---|---:|---|
| phase:1 | codex-runtime-baseline | test_result | yes | `rtk node scripts/test-codex-runtime.js` exited 0 | pass | 3 | none |
| phase:1 | pretool-warning-reproduction | hook_status | yes | Raw warning stdout failed JSON parsing under `nativeEventName: PreToolUse` | pass | 3 | none |
| phase:1 | campaign-table-reproduction | test_result | yes | Current layout changed Type to `in-progress` while Status stayed `pending` | pass | 3 | none |
| phase:1 | phase-validator-review | command_result | yes | Phase-validator verdict pass; all four conditions passed | pass | 3 | none |
| phase:2 | codex-hook-regressions | test_result | yes | `rtk node scripts/test-codex-runtime.js` exited 0; warning projection parses as PreToolUse JSON | pass | 3 | none |
| phase:2 | campaign-mutation-regressions | test_result | yes | `rtk node scripts/test-campaign-core.js` exited 0; legacy/current and atomic paths covered | pass | 3 | none |
| phase:2 | phase-validator-review | command_result | yes | Phase-validator verdict pass; all eight checks passed | pass | 3 | none |
| phase:3 | hook-runtime-verification | hook_status | yes | Hook installers pass; verify-hooks 97/97; integration 20/20 after pinning synthetic SessionStart to Claude runtime | pass | 3 | none |
| phase:3 | full-regression-suite | test_result | yes | Aggregate passes every suite except release integrity; identical failure reproduces on untouched Citadel at `scripts/test-release-integrity.js:703` | fail | 2 | resolve release metadata in the active MCP/release campaign, then rerun aggregate |
| phase:3 | synthetic-edit-checkpoint | command_result | yes | Generated Windows Codex PreToolUse apply-patch warning path exits 0 with valid JSON; repaired helper persisted Phase 1 and 2 statuses | pass | 3 | rerun normal sandbox helper after repaired plugin is installed and session restarted |
| phase:3 | phase-validator-review | command_result | yes | Validator verdict fail because the aggregate release-integrity gate remains nonpassing | fail | 2 | rerun after the owning MCP/release scope restores the baseline aggregate |

## Feature Ledger

| Date | Phase | Result | Evidence |
|---|---:|---|---|
| 2026-09-20 | — | Campaign created from the reported failure chain | User report; clean setup-refresh and outside-root edit-helper failures reproduced; source inspection identified an unprojected PreToolUse stdout path and a current-table/status-column mismatch candidate |
| 2026-09-20 | 1 | Confirmed invalid PreToolUse output and current-table mutation defects | Synthetic reproductions, passing baselines showing coverage gaps, and phase-validator pass |
| 2026-09-20 | 2 | Hardened PreToolUse projection and campaign status persistence | Focused suites pass, real current-layout Phase 1 update succeeded, diff check clean, validator pass |
| 2026-09-20 | 3 | Runtime verification is partial: hook-specific and integration gates pass; aggregate held by one baseline release-integrity failure | Hook installers pass, verify-hooks 97/97, integration 20/20, generated Windows edit path pass, aggregate release-integrity-only failure |

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-20 | Use one campaign initially, splitting only if Phase 1 proves independent platform and Citadel defects. | Invalid PreToolUse output can plausibly destabilize the same edit-helper path that then prevents campaign metadata writes. |
| 2026-09-20 | Do not inspect `.planning/telemetry`. | Repository policy forbids scanning data that may contain raw session input; synthetic fixtures are sufficient and safer. |
| 2026-09-20 | Preserve existing Citadel campaign changes and the MCP claim. | They predate this work and may belong to another active agent/session. |
| 2026-09-20 | Use isolated worktree checkpoint `a4c5158fa1729a04dd0b660494d79722ab4cc187` on `fix/codex-hook-edit-helper-reliability`. | Binds all source work to a clean Citadel base while preserving unrelated dirty campaign files in the primary worktree. |
| 2026-09-20 | Treat setup-refresh as an unresolved platform-layer symptom until end-to-end retest. | Escalated execution bypasses the failure; Citadel source fixes are necessary but not yet sufficient evidence of platform recovery. |
| 2026-09-20 | Pin only synthetic `fireHookScript` executions to `claude-code`. | The integration harness inherited Codex runtime identity while testing a Claude install; this made the receipt correctly appear stale. Pinning direct Pre/Post helpers changed legacy config semantics and was reverted. |
| 2026-09-20 | Do not repair release metadata in this campaign. | The failure is identical on untouched Citadel and the active MCP campaign claims `release-files.json`, package, and release surfaces. |

## Review Queue

- Phase 3 aggregate gate is held by the baseline release-integrity failure owned by the active MCP/release scope.
- Live normal-helper recovery requires the repaired plugin to be landed/installed and a fresh session before retest.

## Human Escalation

- Held subjects: `phase:3/full-regression-suite` (`BASELINE_RELEASE_INTEGRITY_FAILURE`) and live setup-refresh retest (`HELPER_VERSION_NOT_RELOADED`). Independent source verification is complete; terminal completion remains blocked.

## Active Context

Phases 1 and 2 are complete and independently validated. Phase 3 hook/runtime checks pass, but terminal verification is held by a baseline release-integrity failure and the need to reload the repaired plugin before a live helper retest. Direction check: aligned.

## Continuation State

- Current phase: 3/3 — Runtime and regression verification
- Current sub-step: run installed-hook verification, integration suite, aggregate suite, and end-to-end sandbox/edit checkpoint retest
- Verified checkpoint: worktree branch `fix/codex-hook-edit-helper-reliability`, base `a4c5158fa1729a04dd0b660494d79722ab4cc187`, initial campaign hash `714596ab06e793837f141267633e9d7dbb03940c`
- Phase 3 checkpoint: stash object `004872821c33e92a600e7877172bf25dd0a19223`, dirty diff digest `f51640fc996712137e4d6ef6fcb18c0cd4ec1c46`, campaign hash `7edce9cdfef849d7773c272c6fd32967e05bf555`; reapplied without consuming the stash
- Files modified by campaign: `.planning/campaigns/codex-hook-edit-helper-reliability.md`, `.planning/coordination/claims/archon-codex-hook-edit-helper-reliability.json`
- Pre-existing changes preserved in primary worktree: `.planning/campaigns/citadel-product-proof.md`, `.planning/campaigns/mcp-multi-protocol-support.md`
- Held gates: aggregate release integrity fails identically on untouched Citadel; normal sandbox helper still reports `helper_unknown_error: setup refresh had errors` because this session has not reloaded the repaired plugin
- Next actions: let the active MCP/release campaign restore the baseline aggregate; land/install this isolated repair; start a fresh session; rerun normal sandboxed `apply_patch`, the aggregate suite, Phase 3 evidence validation, and the final validator

## Repair Tasks

- Repairs phase:3/full-regression-suite: status is not passing: fail. Next: resolve release metadata in the active MCP/release campaign, then rerun aggregate. Retries remaining: 1.
- Repairs phase:3/phase-validator-review: status is not passing: fail. Next: rerun after the owning MCP/release scope restores the baseline aggregate. Retries remaining: 2.

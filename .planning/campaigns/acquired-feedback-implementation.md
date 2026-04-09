---
slug: acquired-feedback-implementation
status: active
phase_count: 5
current_phase: 1
source: https://github.com/SethGammon/Citadel/discussions/96
---

# Campaign: Acquired Feedback Implementation

**Direction:** Implement all improvements surfaced by @Acquiredl in GitHub discussion #96.
Four pain points: campaign staleness, Windows path fragility, hook invisibility, Fleet
inaccessibility for solo devs. Plus persistent 1/2/3 Fleet confirmation settings.

Status: active

## Phases

| # | Status | Type | Phase | Done When |
|---|--------|------|-------|-----------|
| 1 | complete | build | Infrastructure (path-helpers, CITADEL_DEBUG, issue-monitor fix) | `node scripts/test-all.js` passes |
| 2 | complete | build | Campaign phase status parsing | parse-campaign + update-campaign unit tested |
| 3 | complete | build | Fleet UX + persistent confirm settings | skill-lint fleet + do pass |
| 4 | complete | build | Dashboard hook activity view | skill-lint dashboard passes |
| 5 | in-progress | verify | Tests + PR draft | All tests pass, PR shown to user |

## Phase End Conditions

| Phase | Condition Type | Condition |
|-------|---------------|-----------|
| 1 | command_passes | node scripts/test-all.js |
| 1 | file_exists | core/utils/path-helpers.js |
| 2 | command_passes | node -e "require('./core/campaigns/parse-campaign')" |
| 2 | command_passes | node -e "require('./core/campaigns/update-campaign')" |
| 3 | command_passes | node scripts/skill-lint.js fleet |
| 3 | command_passes | node scripts/skill-lint.js do |
| 4 | command_passes | node scripts/skill-lint.js dashboard |
| 5 | command_passes | node scripts/test-all.js |
| 5 | manual | PR shown to user for approval |

## Feature Ledger

| Phase | File | What Changed |
|-------|------|-------------|

## Decision Log

- Using existing `fleetSpawn` consent category from harness-health-util for Fleet 1/2/3 preference (already has always-ask/session-allow/auto-allow machinery)
- CITADEL_DEBUG follows exact CITADEL_UI env var pattern — read once at module top, used in new debugLog() in harness-health-util
- toUniversal() in path-helpers is for storage/comparison ONLY, not for Node fs APIs
- parsePhaseTable added to parse-campaign.js, updatePhaseStatus added to update-campaign.js

## Active Context

Starting Phase 1. All research complete from prior session.

## Continuation State

checkpoint-phase-0: none

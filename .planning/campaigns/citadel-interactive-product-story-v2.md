---
slug: citadel-interactive-product-story-v2
status: completed
phase_count: 6
current_phase: 6
created: 2026-07-12
---

# Campaign: Citadel Interactive Product Story v2

Direction: Transform Seth Gammon's GitHub profile and the Citadel public site into an exceptional, proof-led demonstration of Citadel operating on real work.

## Phases

| # | Status | Type | Phase | Done When | Validator Retries Remaining |
|---|---|---|---|---|---:|
| 1 | complete | research | Creator profile and public proof inventory | profile README renders publicly, social links are verified, and achievement sources are recorded | 3 |
| 2 | complete | plan | Interactive story architecture | experience contract defines the full journey, content hierarchy, state model, responsive behavior, and motion grammar | 3 |
| 3 | complete | build | Operating journey and repository memory | a visitor can route a scenario, inspect persisted state, close a session, and restore the next action | 3 |
| 4 | complete | build | Fleet, evidence challenge, and deploy replay | interactive fleet, missing-source challenge, and 15-PR replay run from deterministic source data | 3 |
| 5 | complete | build | Proof gallery, installation, branding, and accessibility | proof receipts, Claude/Codex paths, mobile layout, keyboard operation, and reduced motion all render correctly | 3 |
| 6 | complete | verify | Regression, visual QA, delivery, and deployment | strict suite passes, desktop/mobile screenshots pass review, protected PR merges, and live Pages matches the verified build | 3 |

## Phase End Conditions

| Phase | Type | Condition |
|---:|---|---|
| 1 | file_exists | `.planning/research/citadel-profile-achievements.md` |
| 1 | manual | Public GitHub profile visibly includes the profile README and verified social links |
| 2 | file_exists | `docs/interactive-story-contract.md` |
| 2 | command_passes | `node scripts/test-routing-sync.js` |
| 3 | command_passes | `node scripts/test-citadel-site-story.js` |
| 3 | visual_verify | desktop and mobile journey screenshots |
| 4 | command_passes | `node scripts/test-citadel-site-story.js` |
| 4 | visual_verify | fleet, unknown-state, and deploy replay screenshots |
| 5 | command_passes | `node scripts/test-citadel-site-story.js` |
| 5 | visual_verify | keyboard, mobile, and reduced-motion capture set |
| 6 | command_passes | `node scripts/test-all.js --strict` |
| 6 | command_passes | `node scripts/release-package.js --ref HEAD --dry-run --verify-reproducible` |
| 6 | manual | GitHub Pages serves the verified experience after protected merge |

## Quality bar

- Every animation communicates a real state transition and ends in an inspectable state.
- Every public claim names a source and a truth boundary.
- No fake live counters or fabricated runtime events.
- Claude Code and Codex receive equal treatment.
- Desktop, mobile, keyboard, and reduced-motion experiences remain complete.
- No em dashes in public copy.
- The first useful interaction is visible without scrolling.
- Private traffic screenshots never enter the public repository.

## Decision Log

- 2026-07-12: Use one deterministic interactive state model instead of separate decorative animations.
- 2026-07-12: Keep the router as the entrance, then reveal persistence, fleet coordination, evidence, and delivery proof.
- 2026-07-12: Treat GitHub profile work as part of product conversion because the creator identity is currently less legible than the repository.
- 2026-07-12: GitHub did not recognize the source-pushed profile repository as special. Preserved it as `SethGammon-profile-source`, recreated `SethGammon/SethGammon` with GitHub's README-enabled path, and verified the new repository is marked special.
- 2026-07-12: The official experience schema referenced by the skill was missing. Used every canonical category listed by the skill directly in `docs/interactive-story-contract.md`.

## Active Context

Campaign complete. The creator profile visibly mounts its proof-led README, bio, website, LinkedIn, X, and Reddit. The live Citadel site now runs campaign, review, fleet, evidence challenge, and 15-PR landing scenarios through one deterministic state engine, plus six bounded proof receipts and equal Claude Code and Codex installation paths. Protected PRs #186 and #188 merged with both workflows passing. Live Pages verification confirmed the evidence interaction, six proof cards, Codex runtime switch, and final animated values `49 / 4 / 29 / 2`.

## Continuation State

- current: completed
- next: collect real visitor feedback and conversion evidence before changing the story model
- verified: strict suite passed every check; reproducible release SHA-256 `5701e54da9464f227caf16bcf33b9a2ef85ca2acbcf5a426500249f898aaaebc`; `npm run site:story:test` 24/24; protected workflows passed on PRs #186 and #188; live desktop interaction and deployment checks passed
- profile: visual README, evidence table, LinkedIn, X, Reddit, bio, and website visibly mounted on the public Overview page
- protected local state: `.planning/campaigns/citadel-product-proof.md`, `assets/social/`, and `dist/` remain outside campaign scope

<!-- session-end: 2026-07-12T19:51:17.547Z -->

<!-- session-end: 2026-07-12T20:19:15.162Z -->

<!-- session-end: 2026-07-12T20:20:25.755Z -->

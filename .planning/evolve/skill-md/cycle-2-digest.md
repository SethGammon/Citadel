# Cycle 2 — skill-md | 2026-05-03

## Scores
| Axis | Prior (cycle 1) | This Cycle (est) | Delta |
|---|---|---|---|
| protocol_completeness | 7.0 | 7.0 | 0 (not attacked) |
| density | 6.0 | 6.0 | 0 (not attacked) |
| escalation_guidance | 6.0 | 7.5 | +1.5 |
| fringe_accuracy | 6.5 | 7.5 | +1.0 |
| orientation_precision | 6.5 | 7.5 | +1.0 |
| output_completeness | 6.5 | 7.5 | +1.0 |

Note: scores are structural estimates — perceptual scoring panel not run this cycle.
protocol_completeness and density not attacked; scores held at cycle 1 levels.

## Hypotheses
| ID | Axis | Hypothesis | Scout Result | Confidence |
|---|---|---|---|---|
| H-OP-02 | orientation_precision | 13 skills missing Orientation with named neighbors | confirmed (grep) | 0.9 |
| H-FA-02 | fringe_accuracy | cost, dashboard, refactor, review have no fringe section at all | confirmed (grep) | 0.9 |
| H-EG-02 | escalation_guidance | 30+ skills have zero contextual gates | confirmed (grep) | 0.9 |
| H-OC-02 | output_completeness | 30+ skills missing reversibility in HANDOFF | confirmed (grep) | 0.9 |

All hypotheses confirmed at 0.9+ via direct structural inspection (observable absence). Scout dispatch skipped per protocol — confidence already ≥ 0.7 before Phase 3.

## What Was Attacked
| Axis | Skills Modified | Delta | Mechanism Confirmed |
|---|---|---|---|
| orientation_precision | archon, create-app, daemon, systematic-debugging, test-gen, unharness, watch, schedule, houseclean, merge-review, setup, wiki | +1.0 est | yes |
| fringe_accuracy | cost, dashboard, refactor, review (+ orientation to review) | +1.0 est | yes |
| escalation_guidance + output_completeness | architect, create-skill, design, doc-gen, experiment, infra-audit, live-preview, map, prd | +1.5/+1.0 est | yes |

## Cross-Pollination
Pattern P-06 (contextual-gates-classification) applied to: telemetry, verify, research-fleet, qa
All passed verification oracle (lint + bench). No regressions.

## Patterns Discovered This Cycle
- **P-06 contextual-gates-classification**: green/amber/red + specific undo command is the minimum viable escalation gate; absence scores 0, typed classification scores 7+
- **P-07 fringe-from-real-modes**: fringe cases must derive from observed failures with specific user-facing messages — hypothetical cases don't move the score
- **P-08 identity-prose-is-dead-weight**: Identity sections restating the frontmatter are always dead weight; remove to free word budget

## Belief Model Updates
- H-OP-02: verified — mechanism confirmed, 12 skills gained orientation, 1 (review) via H-FA-02 agent
- H-FA-02: verified — mechanism confirmed, 4 skills gained real-failure-mode fringe cases
- H-EG-02: verified — mechanism confirmed, gates are testable (color-coded + undo command), not vague
- H-OC-02: verified — mechanism confirmed, Reversibility field in HANDOFF blocks in 12 skills

## Commits This Cycle
- `89e32ab`: H-OP-02/H-FA-02/H-EG-02/H-OC-02 -- 25 skills fleet attack
- `17c9f8a`: P-06 cross-pollination -- telemetry, verify, research-fleet, qa

## Remaining Gaps (cycle 3 targets)
- escalation_guidance: ~17 skills still missing contextual gates (archon, autopilot, daemon, do, fleet, improve, organize, qa, refactor, research-fleet, scaffold, setup, systematic-debugging, telemetry, triage, unharness, watch, wiki, workspace)
- output_completeness: same skills still missing reversibility in HANDOFF
- density: do (2481), improve (2475), fleet (2447), daemon (2330) have identity prose or redundant sections to trim
- protocol_completeness: needs perceptual scoring to identify which skills have coverage gaps

## Spend: ~$8 this cycle | ~$23 cumulative | Velocity: 1.17 (4 axes × avg +1.125 / 3 agents)

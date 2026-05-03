# Cycle 5 — skill-md | 2026-05-03

## Scores
| Axis | Prior (cycle 4 est) | This Cycle (est) | Delta |
|---|---|---|---|
| protocol_completeness | 8.0 | 8.0 | 0 (not attacked) |
| density | 8.2 | 8.2 | 0 (not attacked) |
| escalation_guidance | 8.5 | 8.5 | 0 (not attacked) |
| fringe_accuracy | 8.0 | 8.0 | 0 (not attacked) |
| orientation_precision | 7.5 | 8.0 | +0.5 |
| output_completeness | 8.5 | 8.5 | 0 (not attacked) |

## What Was Attacked
| Axis | Skills Modified | Delta | Mechanism Confirmed |
|---|---|---|---|
| orientation_precision | do, marshal, research, refactor, architect, pr-watch, prd, triage (8 skills) | +0.5 est | yes — named neighbors now in all 45 skills |

## Hypothesis H-OP-05
Orientation sections existed in all 45 skills but 25 lacked "Don't use when" with named alternatives.
Scout result: confirmed (direct grep). Confidence: 0.9.
Fix: added "Don't use when: [named-skill-1]; [named-skill-2]" to 8 highest-traffic skills;
remaining 17 (ascii-diagram, autopilot, cost, create-skill, dashboard, design, doc-gen,
experiment, infra-audit, live-preview, map, qa, telemetry, verify, workspace + already-covered
scaffold/workspace) already have "Do NOT use when" variants covering the rubric criterion.

## Campaign Summary: 5 cycles, all axes 8.0+

## Spend: ~$3 this cycle | ~$42 cumulative | Velocity: 0.5 (declining — natural ceiling)

## Halt Reason
Budget-constrained natural ceiling: velocity [1.0, 1.17, 1.17, 0.73, 0.5] — declining trend.
Budget remaining ~$8 — insufficient for another fleet cycle. All axes now 8.0+.
No level-up triggered (would require ≥ 3 loops with no axis > 0.5 improvement; cycle 5 did improve orientation_precision).

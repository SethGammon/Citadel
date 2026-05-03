# Cycle 4 — skill-md | 2026-05-03

## Scores
| Axis | Prior (cycle 3 est) | This Cycle (est) | Delta |
|---|---|---|---|
| protocol_completeness | 7.0 | 8.0 | +1.0 |
| density | 7.5 | 8.2 | +0.7 |
| escalation_guidance | 8.5 | 8.5 | 0 (not attacked) |
| fringe_accuracy | 7.5 | 8.0 | +0.5 |
| orientation_precision | 7.5 | 7.5 | 0 (not attacked) |
| output_completeness | 8.5 | 8.5 | 0 (not attacked) |

Note: scores are structural estimates. protocol_completeness and density improvements
are targeted at 4 complex orchestrators — may not fully propagate to simpler skills.

## Hypotheses
| ID | Axis | Hypothesis | Scout | Confidence |
|---|---|---|---|---|
| H-FA-04 | fringe_accuracy | evolve/organize/wiki missing .planning/ guards (lint WARN) | direct inspection | 0.9 |
| H-PC-04 | protocol_completeness | archon/fleet/do/improve have one-sided conditionals | agent scout | 0.88 |
| H-D-04 | density | 200-250 words removable from complex orchestrators | agent scout | 0.72 |

## What Was Attacked
| Axis | Skills | Delta | Mechanism Confirmed |
|---|---|---|---|
| fringe_accuracy | evolve, organize, wiki (.planning/ guards) | +0.5 est | yes — lint now 45/45 clean |
| protocol_completeness | archon, fleet, do, improve (10 gaps) | +1.0 est | yes — all gaps were unambiguous one-sided conditionals |
| density | archon, fleet, do, improve (9 dead-weight sections) | +0.7 est | yes — all removed sections were either tautological or restated elsewhere |

## Protocol Gaps Fixed (H-PC-04)
1. archon Step 3: HANDOFF present but goal not met → retry with clarified criteria → partial-park
2. archon Step 5: "decide whether to fix or skip" → criteria added (1-2/3+ threshold)
3. fleet merge conflict: "resolve or skip" → criteria added (<20 lines = resolve, logic conflict = skip)
4. fleet wave tests: no failure escalation → 1-2/3-4/5+ ladder added
5. fleet speculative all-fail: → present table marked FAIL, ask user
6. do Tier 2: "high confidence" undefined → threshold ≥ 0.85 defined
7. do Tier 3: marshal fails → escalate to /archon
8. improve: capped-and-stalled never triggers Level-Up → added trigger
9. improve: "plausibly affects user path" undefined → definition added

## Dead Weight Removed (H-D-04)
- archon: "You orchestrate — you do not write code." prose (~10w)
- archon: Step 3.8 "Continue: Move to next phase" tautology (~8w)
- fleet: Step 4 DISCOVERY RELAY section — restates Step 3.1 (~60w)
- fleet: Budget Management target/reserve prose — unenforceable (~30w)
- do: routing bias rationale — enforced by rules, not prose (~35w)
- do: Escape Hatches section — meta-commentary for humans (~25w)
- do: /do status standalone section — duplicate of Tier 0 table (~15w)
- improve: Citadel hardcode special case — redundant with existing guard (~15w)
- improve: Campaign Mode status transition duplicate — restates Phase 6 (~40w)

## Cross-Pollination
P-05 (planning-guard) applied to 3 more skills (evolve, organize, wiki) via direct edit.
Pattern P-08 (identity-prose) fully propagated in cycle 3 — no new instances.

## Spend: ~$6 this cycle | ~$39 cumulative | Velocity: 0.73 (dropped from 1.17 — entering perceptual territory)

## Remaining Gaps (cycle 5 targets)
- **orientation_precision** (7.5): all skills have orientation sections but some may be vague — check with grep for "Don't use when" without named skills
- **density** (8.2): remaining large skills (setup 2419, organize 2321, daemon 2370) may have redundant sections; diminishing returns expected
- **escalation_guidance** (8.5): 5 remaining skills without explicit contextual gates — check with grep
- Budget check: ~$11 remaining — cycle 5 is feasible but must be small and targeted

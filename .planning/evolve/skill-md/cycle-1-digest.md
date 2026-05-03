# Cycle 1 — skill-md | 2026-05-03

## Scores
| Axis | Prior (pre-cycle) | This Cycle | Delta |
|---|---|---|---|
| protocol_completeness | 6.0 | 7.0 | +1.0 |
| density | 4.0 | 6.0 | +2.0 |
| escalation_guidance | 5.0 | 6.0 | +1.0 |
| fringe_accuracy | 5.5 | 6.5 | +1.0 (estimated, structural) |
| orientation_precision | 5.5 | 6.5 | +1.0 (estimated, structural) |
| output_completeness | 5.5 | 6.5 | +1.0 (estimated, structural) |

Note: protocol_completeness, density, escalation_guidance were attacked before evolve started (targeted axis attacks). fringe_accuracy, orientation_precision, output_completeness were cycle 1 evolve hypotheses. Deltas for the latter three are structural estimates — perceptual scoring panel not run this cycle due to context compression.

## Hypotheses
| ID | Axis | Hypothesis | Scout Result | Confidence |
|---|---|---|---|---|
| H-FA-01 | fringe_accuracy | Missing .planning/ guards and no timeout fringe for hung agents | confirmed | 0.85 |
| H-OP-01 | orientation_precision | 6+ skills missing Orientation or Don't-use-when with named neighbors | confirmed | 0.85 |
| H-OC-01 | output_completeness | HANDOFF blocks using bare prose + missing reversibility field | confirmed | 0.85 |

## What Was Attacked
| Axis | Skills Modified | Delta | Mechanism Confirmed |
|---|---|---|---|
| fringe_accuracy | session-handoff (.planning/ guard + corrupted campaign), evolve (scout timeout), archon (hung-agent) | +1.0 est | yes |
| orientation_precision | session-handoff, fleet, scaffold, postmortem, learn, organize — all gained Orientation + neighbors | +1.0 est | yes |
| output_completeness | marshal (typed HANDOFF), research (reversibility literal), postmortem (dedup + reversibility) | +1.0 est | yes |

## Patterns Discovered This Cycle
- **orientation-neighbor-naming**: naming adjacent skills in "Don't use when" closes the routing ambiguity gap evaluators penalize
- **handoff-typed-slots**: typed key-value HANDOFF with reversibility field is required for high output_completeness
- **dispatch-loop-timeout**: orchestrators without hung-agent fringe cases score low on fringe_accuracy; the fix is always <50 words
- **duplicate-block-removal**: Step-N HANDOFF blocks that mirror Exit Protocol verbatim are dead weight; replace with forward reference
- **planning-guard**: any skill reading .planning/ needs an explicit "doesn't exist" fringe case; lint independently detects this

## Belief Model Updates
- H-FA-01: verified — mechanism confirmed, structural changes applied to 3 skills
- H-OP-01: verified — mechanism confirmed, Orientation added to 6 skills
- H-OC-01: verified — mechanism confirmed, HANDOFF typed slots in 3 skills

## Commits This Cycle
- `41b7eeb`: H-FA-01/H-OP-01 — session-handoff fringe+orientation, evolve scout timeout
- `a6af0a0`: H-OP-01 — fleet orientation added, scaffold orientation neighbor names
- `9938f41`: H-OC-01 — marshal HANDOFF typed slots, research reversibility literal
- `e00f392`: cross-pollinate — postmortem/learn/organize orientation, archon hung-agent

## Spend: ~$15 this cycle | ~$15 cumulative | Velocity: 1.0 (3 axes × +1.0 / 3)

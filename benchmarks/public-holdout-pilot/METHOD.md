# Public holdout fast pilot — frozen secondary method

## Status and provenance

This is a bounded secondary pilot derived from the public capstone selection and signed gold preflight. It is not a continuation or reinterpretation of the primary capstone, which terminated `setup-unknown` before model inference because only 41 of 60 required evaluation tasks could be assigned. The terminal record remains unchanged.

No model has been run on a pilot-assigned task when this method and its assignment are frozen. The reduced sample size and two-plan design were chosen using setup yield and runtime only. No model output or model verdict exists to influence the design.

## Question

Across a small, diverse sample of outside-authored repository repairs, can Citadel use calibration evidence to choose between local-first execution and direct Claude while preserving observed verified quality and reducing comparison cost?

## Fixed sample

The pilot reuses the parent drand selection and the signed 80-task gold preflight. Within each of the four frozen language/issue-length strata, it scans the existing public rank order and accepts only tasks with three of three gold passes. It assigns the first two eligible tasks to calibration and the next four to untouched evaluation, with a maximum of one task from any repository. The fixed result is 8 calibration tasks, 16 evaluation tasks, and 24 distinct repositories. If those quotas cannot be filled, the pilot stops `setup-unknown` before inference.

This preflight-informed secondary design is disclosed precisely because the primary 20/60 quota failed. It makes no claim to preserve the primary study's preregistration or statistical power.

## Plans and controller

Every assigned task receives independent outputs from:

1. Qwen 2.5 Coder 3B locally through the pinned Ollama model digest;
2. Claude Sonnet through authenticated Claude Code 2.1.219.

Calibration records the official verifier result, duration, measured local GPU economics, and provider-reported Claude comparison amount for both plans. For each evaluation task, Citadel compares two root paths: Qwen 3B then Claude after verifier rejection, or Claude directly. The direct-Claude conservative probability in the same stratum is the quality target. Citadel chooses the lower expected comparison-cost path meeting that target, or the highest conservative-quality path if neither meets it. All 16 routes and the calibration-history digest are signed and published before evaluation-task model calls.

## Information and verifier boundary

Models receive only the issue statement and deterministic repository files retrieved at the pinned base commit. They receive no accepted patch, test patch, hints, hidden test names, competing output, assignment phase, or verifier result. Model tools and network access are disabled. Microsoft's pinned SWE-bench-Live evaluator and per-instance containers remain the only completion authority.

Prediction evaluation is bounded to 60 minutes per cell. A timeout or evaluator defect is `unknown`, never a model failure. The workflow still emits and uploads a content-addressed summary instead of allowing the entire run to end as an unexplained cancellation.

## Policies, economics, and claims

The paired policies are always-Claude, static local-first, and the sealed Citadel controller. A policy stops on its first official pass; speculative unvisited outputs are disclosed but excluded from policy comparison cost. Provider-reported Claude comparison USD and measured local GPU-derived comparison cost are kept separate from actual subscription cash, which remains unknown.

The primary pilot readout is descriptive: observed paired verified rates and total comparison cost across the 16 tasks. A preliminary signal requires Citadel's observed verified rate to be no lower than always-Claude and its comparison cost to be lower. A stratified paired bootstrap is reported as exploratory uncertainty, not as a population noninferiority test. No universal savings, production reliability, or best-in-class claim is permitted.

Passed, failed, and unknown results are all signed and published. There is no task replacement, model-result tuning, optional stopping, or positive-only publication.

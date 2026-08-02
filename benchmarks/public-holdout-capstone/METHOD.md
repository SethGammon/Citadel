# Public holdout controller capstone — frozen method

Status: implementation and candidate-pool construction. No model has been run on a selected task. The selection request must be merged to protected `main` before its committed future beacon round.

## Freeze supersession record

The first public request, `sha256:2f82dbbdf4b71c0d3ff58946ba09c90bd95af7930b27f200513526f7b1a0c880`, was merged in PR #233 before selection. A non-benchmark smoke on Citadel's own repository then exposed `ENAMETOOLONG`: the Claude prompt was passed as a Windows command-line argument. No candidate was selected and no benchmark task was sent to any model. The replacement runner streams the same bounded prompt over stdin, and the replacement request explicitly binds the superseded request ID. Only the newest request merged before the committed round governs selection.

The next governing request, `sha256:af8f4bc938bedd7f1f913b1f0c853972db99e5a4d194d1e8a3e0589de13d0755`, produced selection `sha256:720e46672c751c3d2d39dbc399f99d32b389f9efea8d5151a2cf645dacc529ff`. Its first public gold preflight (GitHub Actions run `30766637122`) correctly classified all cells as setup errors before assignment: the pinned Microsoft evaluator's `launch` dependency is a git submodule, but the workflow had not checked submodules out. No model was run and no task was assigned. The replacement workflow recursively checks out the evaluator closure, verifies both the parent and `launch` commits, and records process exit status plus both evaluator commits in every summary. A new prospective request and beacon selection are required after this source change; the failed preflight and prior selection remain public negative evidence.

## Question

Can an evidence-conditioned Citadel controller reduce the comparison cost of real repository repair operations while remaining non-inferior to an always-Claude baseline under model-external tests?

This is not a benchmark of isolated model calls. The economic unit is a verified repair operation: routing, every attempted model, recovery after a failed hidden test, elapsed time, and all declared cost lenses.

## Outside-authored population

The source population is Microsoft’s `SWE-bench-Live/MultiLang` JavaScript and TypeScript splits. Citadel did not author the issues, repositories, accepted patches, test patches, or container images. The candidate manifest records every source row, every exclusion, and cryptographic digests of the problem, gold patch, test patch, and complete normalized row.

Eligibility is mechanical and frozen in `core/public-holdout/dataset.js`: task date on or after 2025-01-01; complete repository identity; an 80–16,000 character problem statement; nonempty accepted patch, test patch, and `FAIL_TO_PASS`; at most eight accepted-patch paths and 400 changed lines; and at least one JavaScript/TypeScript/JSON product-source change. Gold scope is used only to define a reproducible resource envelope. It is never exposed to a model or controller.

## Public selection and assignment

The complete eligible candidate pool and all transitive protocol source digests are frozen before selection. A future League of Entropy drand mainnet round is committed while it is still unknowable. After the round, three committed relays must return byte-identical beacons; Citadel also verifies that `randomness = sha256(signature)`. For each language split, candidates are ordered by `sha256(request_id + LF + randomness + LF + split + LF + instance_id)`.

The four predeclared feature strata are JavaScript/TypeScript crossed with issue statements of at most/above 150 words. In public order, tasks are gold-tested three times in the official Linux container. A task is environment-valid only with three passes. Subject to a maximum of five accepted tasks from one repository, the first five valid tasks in each stratum form calibration and the next eight form the evaluation floor. Evaluation is then filled to 60 from the remaining global rank-digest order: 20 calibration tasks and 60 untouched evaluation tasks across at least 16 potential repository slots. If the frozen pool cannot fill those quotas, the terminal result is `setup-unknown`. Model outcomes never authorize replacements.

## Information boundary

Before inference, a model may receive only the issue statement, repository files at the pinned base commit selected by the frozen deterministic retriever, and the output contract. It receives no accepted patch, test patch, hints, post-merge code, hidden test names, beacon assignment label, competing model output, or verifier result. Network and tools are disabled during model generation. Every prompt, retrieved file digest, model identity, raw response, generated patch, timing, usage, and cost record is retained.

## Calibration and frozen controller

The runner generates independent Qwen 2.5 Coder 3B, Qwen 2.5 Coder 7B, and Claude Sonnet repairs for the 20 calibration tasks. Official hidden-test verdicts become operation-controller history without changing code or thresholds. Priors are symmetric and weak: probability 0.5, strength 1 for every plan.

For every evaluation task, Citadel calculates the conservative direct-Claude probability in the same frozen feature stratum and uses it, floored at 0.10, as the quality target. The existing operation controller compares three paths:

1. Qwen 3B → Qwen 7B → Claude after hidden-test rejection;
2. Qwen 7B → Claude after hidden-test rejection;
3. Claude directly.

It selects the lowest expected marginal-cost path meeting that evidence-conditioned target, or the highest conservative-quality path if none meets it. All 60 decisions and the calibration-history digest are sealed before any evaluation-task model call or verdict.

## Policies and pairing

Each evaluation task has paired policy outcomes:

- `always-claude`: Claude Sonnet once;
- `static-local-first`: Qwen 7B, then Claude after official hidden-test failure;
- `citadel-controller`: the prospectively sealed controller path.

A policy stops at its first official verified pass. Pre-generating an unvisited tier for operational convenience does not charge it to that policy; such speculative executions are separately disclosed and excluded from policy cost. Primary comparison is `citadel-controller` versus `always-claude`; the static route diagnoses whether the controller adds value beyond orchestration.

## Verification and economics

Microsoft’s evaluator and pinned per-instance Docker images are the only completion authority. Accepted patches and hidden tests are fetched by the evaluator, not the generation process. Gold is run three times on the same runner class before task assignment. Infrastructure/setup failures are not model failures.

Claude comparison cost uses the provider-reported equivalent from authenticated Claude Code. Local comparison cost uses measured GPU energy, frozen electricity price, and frozen residual-hardware amortization. Actual subscription cash remains `unknown`; CPU, whole-system energy, setup labor, downloads, and human utility remain outside the primary amount and are disclosed. No result may call comparison USD an actual bill reduction.

## Statistics and gates

The primary analysis is paired and stratified by the four frozen feature strata. A deterministic 20,000-repetition paired percentile bootstrap estimates:

- the verified-rate difference, Citadel minus always-Claude;
- total comparison-cost reduction, `1 − Citadel / always-Claude`.

Claims are hierarchical at alpha 0.05. First, the lower 95% bound on quality difference must be at least −5 percentage points. Only then may cost superiority pass, requiring the lower 95% bound on reduction to exceed zero. Results are also reported by feature stratum, with failures, unknowns, escalations, attempts, wall time, energy, equivalent cost, and actual-cash status. No universal performance claim is permitted from this sample.

## Integrity and stopping rules

Candidate pool, request, beacon record, gold preflight, assignment, visible task artifact, calibration cells, route ledger, evaluation cells, and final analysis are content-addressed. Cells form a digest chain and are signed with an Ed25519 key whose public half is frozen. Offline verification replays source closure, selection, assignments, controller decisions, policy paths, verifier verdicts, costs, statistics, artifact digests, chain links, and signatures.

There is no tuning after calibration, no optional stopping on model outcomes, no task substitution after policy results, and no positive-only publication. `passed`, `failed`, and `unknown` all produce a public report.

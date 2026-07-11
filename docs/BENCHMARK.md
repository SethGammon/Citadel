# Product-proof benchmark

Citadel's product benchmark compares a bare agent with the same agent operating through
Citadel. The published fixture report is **engineering contract evidence, not a product
win**. It deliberately misses the utility threshold and keeps the real milestone open.

## Frozen contract

The ten schema-1 manifests in `benchmarks/product-proof/scenarios/` cover short controls,
long tasks, context resets, parallel work, safety boundaries, and cleanup. Every manifest
pins a repository commit and declares these inputs once:

- exact task text;
- runtime and model identity;
- timeout;
- setup and verification argv;
- expected artifacts, context-reset point, and cleanup assertions.

The runner copies those inputs unchanged into both the `bare` and `harnessed` run
contracts. A report rejects a missing pair, a changed input, duplicate evidence, mixed
scenario identities, or fewer than three repetitions per mode and scenario.

`benchmarks/product-proof/freeze.json` records the scenario-set and metric-set hashes.
Every validate, run, and report command loads only that checked-in record and the checked-in
scenario directory; publishable CLI commands reject caller-supplied freeze/scenario paths.
Each raw run is bound back to its manifest's category, runtime, model, timeout, task digest,
and verification command before aggregation.
External selection is derived only from a validated non-null `external_scenario` record naming
the frozen scenario, reviewer, date, and HTTPS selection source; no CLI flag can promote it.
Once actual runs begin, a scenario or metric cannot be removed or rewritten. A changed set
gets a new identity while earlier results, including losses, remain published. The
external-reviewer slot is currently `null`; it must not be filled until a reviewer selects
at least one scenario after runner behavior is frozen.

## Utility gate

The real benchmark passes only when all of these are true:

1. Harnessed verified completion is no worse than bare verified completion.
2. On long tasks, context resets, and parallel work, Citadel produces either at least 25%
   fewer human interventions or at least 20 percentage points better completion/recovery.
3. Median estimated-cost overhead is no more than 15%.
4. All evidence is from actual runs and an external scenario has been selected.

A missed threshold produces an `open` gate with explicit blocker codes. The report is
still written; negative results are not discarded.

## Reproduce the contract evidence

```bash
node scripts/product-benchmark.js validate
node scripts/product-benchmark.js fixture \
  --output docs/benchmarks/product-proof-fixture-raw.jsonl \
  --repetitions 3
node scripts/product-benchmark.js report \
  --input docs/benchmarks/product-proof-fixture-raw.jsonl \
  --output docs/benchmarks/product-proof-fixture-report.json
node scripts/test-product-benchmark.js
```

The raw file contains 60 records: ten scenarios, two modes, and three repetitions. The
report is derived only from those records; input order does not affect its identity or
aggregates.

## Current published result

The fixture/simulation corpus reports equal completion and equal interventions with 10%
median estimated-cost overhead. It therefore **does not meet the improvement threshold**.
The report also records `EXTERNAL_SCENARIO_NOT_SELECTED` and `ACTUAL_RUNS_REQUIRED`.

No LLM, human reviewer, or external task was run to create this corpus. These numbers only
exercise symmetry, aggregation, negative-result publication, and gate behavior.

## Actual-run adapter boundary

`product-benchmark.js run` checks out the pinned commit into a unique temporary workspace,
runs argv arrays without a shell, enforces the scenario timeout, contains all declared
artifact paths, and removes the workspace in `finally`. An adapter receives a JSON input
file containing the mode, task, runtime, model, timeout, reset point, repository path, and
result path. It writes a strict schema-1 JSON object containing non-negative token, cost,
intervention, and regression measurements plus a boolean resume result. Missing, extra,
or wrongly typed fields fail closed as `ADAPTER_OUTPUT_INVALID`. Setup and verification
remain identical across modes.

Actual-run evidence is fail-closed. External selection and an Ed25519 public key must be
committed together in the freeze record. The `run` command requires the matching private-key
path, signs the complete run receipt, and never writes the private key. `report` cryptographically
verifies every actual receipt; missing or changed signatures keep the gate open with
`ACTUAL_RUNS_UNATTESTED`. Fixture records carry `attestation: null` and cannot be relabeled as
actual evidence.

The temporary workspace is process isolation and cleanup, not a VM or hostile-code
sandbox. Only reviewed pinned repositories and reviewed adapter programs should be run.

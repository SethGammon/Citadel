# Reliability learning

Citadel can analyze a local, explicitly prepared reliability dataset without uploading it or changing runtime configuration. The analyzer recommends an observed execution mode only after representative evidence exists. It never applies the recommendation.

## Privacy contract

Each JSONL record has an exact schema. It contains:

- Opaque hexadecimal run and repository IDs
- A bounded runtime, workload class, execution mode, complexity, and outcome
- Verified status, intervention count, duration, estimated cost, resume status, and held-out assignment

Records cannot contain repository names, URLs, prompts, source code, commands, paths, usernames, timestamps, tokens, credentials, secrets, or additional metadata. Opaque IDs are used only to count represented repositories and are never returned in reports.

No network client exists in this module. Input and optional output are local files chosen by the operator.

## Sufficiency gate

Recommendations remain `unknown` with a null value until all gates pass:

- At least 100 runs
- At least 20 repositories represented by opaque IDs
- At least two runtimes
- At least 20 held-out runs
- At least one execution mode represented in both training and held-out records

The training partition selects among observed execution modes by verified success rate, then human interventions, estimated cost, duration, and stable name order. Held-out records are used only to calculate confidence after selection.

## Output

An available recommendation includes exact training and held-out counts, opaque repository count, runtime counts, candidate statistics, selected-mode statistics, held-out verified success rate, and confidence. Every report contains `auto_apply: false`.

Low confidence remains visible. Sufficient volume does not guarantee a high-confidence recommendation, and the analyzer does not claim causation.

```sh
node scripts/reliability-analyze.js --input .planning/reliability/runs.jsonl
node scripts/reliability-analyze.js \
  --input .planning/reliability/runs.jsonl \
  --output .planning/reliability/report.json \
  --require-sufficient
```

`--require-sufficient` exits with status 2 when recommendations remain unavailable. Without it, an insufficient report is still written honestly for inspection.

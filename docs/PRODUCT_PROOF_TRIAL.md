# Citadel activation cohort

Citadel has public attention. This cohort asks a harder question: do people reach a verified handoff, resume the work, and return after seven days?

The cohort is voluntary, public, and privacy-minimal. Failures count. Missing evidence stays unknown. A star, clone, or successful fixture is not counted as human activation.

Public submissions live in [GitHub Discussion #182](https://github.com/SethGammon/Citadel/discussions/182).

## Share your activation journey

From a repository where Citadel is installed, run:

```sh
node .citadel/scripts/activation-telemetry.js share
```

The command writes `.planning/product-proof/activation-share.json` and prints the same payload. It does not open a network connection or post anything.

Review the file, then post that JSON object inside a `json` fenced code block in Discussion #182. Run the command again after day seven and reply with the updated object. The stable opaque submission ID lets the maintainer replace the earlier observation instead of counting one installation twice.

Only a block shaped like this qualifies for collector ingestion:

````text
```json
{ "schema": 1, "kind": "activation_cohort_submission", "...": "the remaining exact share fields" }
```
````

JSON mentioned in prose, untagged fences, inferred claims, malformed objects, and objects with extra fields do not count.

If your install keeps Citadel in a separate source clone, run the source script and point it at the target project:

```sh
node /path/to/Citadel/scripts/activation-telemetry.js share --root /path/to/your/project
```

## What the bundle contains

- An opaque random submission ID that is separate from the local installation ID.
- The Citadel version and whole-day observation age.
- Bounded booleans for install, setup, route, verified handoff, resume, return, and install or route failure.
- A local event count used as a basic integrity check.
- Explicit consent for aggregate use.

The schema rejects extra fields. It cannot contain prompts, repository names, paths, commands, source code, user identity, tokens, or secrets.

Posting is not anonymous. GitHub shows the account that wrote the comment. The bundle itself contains no GitHub username or other personal identity.

## Milestone and denominators

The cohort is ready for a product decision only when all six gates pass:

| Gate | Target | Denominator |
|---|---:|---|
| Shared installations | 25 | Unique opaque submission IDs |
| Setup completion | 60% | Successful installs |
| Verified handoff | 40% | Successful installs |
| Durable resume | 25% | Successful installs |
| Seven-day return | 15% | Successful installs observed for at least seven days |
| Install or route failure | 10% maximum | Shared install attempts |

Before 25 submissions, the status is `collecting`. After 25 submissions but before 25 are seven-day eligible, it is `observing`. A mature passing cohort is `ready`. A mature failed threshold is `needs_attention`.

This is an opt-in cohort, not a census. Install failures that cannot run the share command are underrepresented, so the failure rate must not be described as the failure rate of every clone or installation.

## Maintainer ingestion

Collect the current complete Discussion snapshot with the authenticated `gh` session:

```sh
node scripts/activation-cohort-collect.js --dry-run --json
node scripts/activation-cohort-collect.js --json
```

The collector calls only the read-only Discussion comments endpoint through `gh api --paginate --slurp`. It does not post, edit, react, infer a journey from prose, copy credentials, or persist tokens. It parses only `json` fenced blocks and validates every candidate through the same exact submission schema used by manual ingestion.

The complete snapshot is reconciled by opaque submission ID. A later observation replaces an earlier one; a current edit is revalidated; duplicate or older observations do not add another installation; and a deleted or no-longer-qualified comment disappears from the collector snapshot. The ignored local evidence envelope retains the source comment URL. The aggregate report never contains those URLs.

Use a fixture for deterministic offline verification. Fixture mode never invokes `gh` or another network client:

```sh
node scripts/activation-cohort-collect.js \
  --fixture scripts/fixtures/activation-discussion/initial-pages.json \
  --root /tmp/citadel-cohort \
  --dry-run \
  --json
```

Rate limits and invalid API responses fail closed before local cohort files are changed.

Manual ingestion remains available for a single reviewed comment:

Save one posted JSON object as a temporary file, then bind it to the final public comment URL:

```sh
node scripts/activation-cohort.js ingest \
  --bundle /path/to/activation-share.json \
  --evidence-url https://github.com/SethGammon/Citadel/discussions/182#discussioncomment-123456
```

The command updates the ignored local cohort store and writes `.planning/product-proof/activation-cohort-report.json`. The dashboard Activation panel reads that report and shows the current status, denominators, and gate results.

Rebuild the report at any time:

```sh
node scripts/activation-cohort.js report
```

The local evidence store preserves the public comment URL. Updated observations use the latest `observation_day` for each opaque submission ID. Do not combine a collector-managed snapshot with unrelated manual evidence in the same file; the collector intentionally reconciles that file to the current Discussion.

## Stopping condition

Do not claim retained human use until the report says `ready`. If the cohort reaches `needs_attention`, inspect the failed gate, fix the product seam, and begin a new versioned observation window without deleting the negative result.

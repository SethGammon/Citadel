# Activation and acquisition metrics

Citadel measures attention and usefulness separately:

- **Acquisition** records how people reached the GitHub repository.
- **Activation** records whether a local Citadel installation reached useful milestones.

A star, view, or clone is evidence of attention, not successful use. A verified handoff and a
successful resume are the strongest local activation signals in this milestone.

## Privacy contract

Activation telemetry is local, optional, and off the network. Citadel never records prompts,
repository names, user identities, file paths, command bodies, source code, tokens, or secrets.
Raw installation IDs remain local. Reports contain only redacted aggregates and are written only
when the operator explicitly supplies `--output`.

Local state lives under `.planning/telemetry/` and is ignored by git. Disable or re-enable it with:

```sh
node scripts/activation-telemetry.js opt-out
node scripts/activation-telemetry.js opt-in
node scripts/activation-telemetry.js status
```

Setting `CITADEL_ACTIVATION_TELEMETRY=0` also disables recording.

## Activation funnel

The schema is versioned and accepts only declared fields. Its stages are:

1. `install_started`
2. `install_completed`
3. `setup_completed`
4. `route_completed`
5. `verified_handoff`
6. `resume_completed`
7. `return_session`

This preserves the important distinction between an installed harness and one that is actually
configured and useful. The unified installer records `install_started` and `install_completed`
automatically for real installations. Dry runs and plugin-only operations do not count as installs.
The same local opt-out contract applies, and telemetry failure can never fail an installation.

Downstream workflow integrations can record a stage explicitly:

```sh
node scripts/activation-telemetry.js record --stage install_completed --status succeeded --runtime codex
node scripts/activation-telemetry.js record --stage verified_handoff --status succeeded --duration-ms 420000
node scripts/activation-telemetry.js record --stage resume_completed --status failed --failure-code interrupted
```

Statuses are `started`, `succeeded`, and `failed`. Acquisition source defaults to `unknown` rather
than inventing attribution. Supported categories are `github_search`, `github_trending`,
`github_topic`, `github_social`, `github_referral`, `direct_link`, `package_registry`,
`documentation`, `word_of_mouth`, `other`, and `unknown`.

Create a redacted aggregate only when it is needed:

```sh
node scripts/activation-telemetry.js report
node scripts/activation-telemetry.js report --output .planning/product-proof/activation-report.json
```

No report is uploaded automatically.

### Decision metrics

The redacted report calculates three primary rates against successful installations:

- `verified_activation_rate`: installations that reached a successful verified handoff
- `durable_resume_rate`: installations that successfully resumed durable work
- `return_use_rate`: installations that recorded a later return session

Setup and route completion are diagnostic funnel steps. Failed event rate and invalid event count
are guardrails. Each installation counts at most once per successful stage, so retries cannot
inflate conversion. A rate is `null` until at least one successful install supplies a denominator.

The unified installer records the install boundary. A configured session start records setup once,
and the first configured session at least one day later records return use once. Standard `/do setup`
and `/do` workflows record route, verified handoff, and successful resume at their proving seams.
Each write remains local, optional, deduplicated where hooks may repeat, and non-blocking. Missing
integration remains missing evidence, not a manufactured conversion.

## Opt-in activation cohort

Local telemetry becomes product evidence only when an operator explicitly chooses to share a redacted bundle:

```sh
node .citadel/scripts/activation-telemetry.js share
```

The command writes `.planning/product-proof/activation-share.json`, prints the exact payload, and performs no network request. Its opaque share ID is separate from the raw installation ID. The strict schema contains only version, whole-day observation age, event count, bounded journey outcomes, and aggregate consent.

The [activation cohort protocol](PRODUCT_PROOF_TRIAL.md) defines the public sharing flow, privacy boundary, denominators, and six decision gates. The dashboard reads the maintainer's ignored local cohort report and distinguishes `collecting`, `observing`, `ready`, and `needs_attention`.

Maintainers can reconcile the current public Discussion without copying comments by hand:

```sh
node scripts/activation-cohort-collect.js --dry-run --json
node scripts/activation-cohort-collect.js --json
```

Collection is read-only and paginated through the existing authenticated `gh` session. Only `json` fenced blocks that pass the exact activation submission schema qualify. Prose, malformed JSON, extra fields, and untagged code fences remain non-evidence. Opaque submission IDs control deduplication; edited comments are revalidated and deleted comments are removed on the next complete snapshot. Source comment URLs remain in the ignored local evidence store and are excluded from the aggregate report.

Fixture mode is network-free and exists for deterministic validation:

```sh
node scripts/activation-cohort-collect.js --fixture scripts/fixtures/activation-discussion/initial-pages.json --dry-run --json
```

The collector never posts or updates Discussion content, never infers stages from prose, and never persists GitHub credentials. A rate limit or invalid response leaves the existing cohort unchanged.

This cohort does not turn volunteer submissions into population telemetry. In particular, installs that fail before the share command can run are underrepresented.

## GitHub acquisition history

GitHub exposes repository views, clones, top referrers, and popular paths for a rolling 14-day
window to users with repository write access. Citadel captures that short-lived data into local
daily history. The API limitation means the snapshot should be run at least once per day; it does
not recover traffic that GitHub has already aged out.

```sh
node scripts/github-traffic-snapshot.js --repo SethGammon/Citadel
```

Live capture uses `GH_TOKEN`/`GITHUB_TOKEN` when explicitly supplied, or the existing authenticated
`gh` CLI session without copying its credential into the process environment. The credential must
have repository write access. Tokens are used only for authenticated requests and are never written
to snapshots or errors. Each run appends to
`.planning/acquisition/YYYY-MM-DD.json`; repeated same-day captures are preserved rather than
overwritten. These files are ignored by git by default.

### Current maintainer snapshot

The authenticated snapshot captured `2026-07-13T17:14:26.158Z` records the rolling GitHub
traffic window at 782 stars, 76 forks, 2,332 views from 1,420 unique viewers, and 1,319 clones
from 585 unique cloners. The leading reported referrers by unique visitor were Google (513), X
via `t.co` (335), GitHub (155), and Reddit (48). The repository overview accounted for 1,390
unique path visitors. The terminal demo attracted 59, the routing flow 38, `DEMO.md` 18, and
`INSTALL.md` 17 unique visitors.

The July 12 slice was the surge: 1,254 views from 785 unique viewers and 231 clones from 92
unique cloners. Compared with the July 11 snapshot, Citadel added 126 stars and 12 forks while
the rolling traffic window expanded by 930 unique viewers. Those numbers show distribution and
curiosity. They still do not establish setup, verified handoff, resume, or return use.

This supports a mixed discovery explanation: GitHub-native circulation, renewed social sharing,
search, and Reddit can each create waves even after the maintainer stops posting. GitHub omits
direct and low-volume attribution from the top-referrer list, its unique counts are scoped per
metric rather than globally deduplicated, and none of these numbers proves installation, task
completion, repeat use, or causation for a specific star.

For deterministic offline verification:

```sh
node scripts/github-traffic-snapshot.js --repo SethGammon/Citadel --fixture combined-response.json --json
```

The live endpoints and their access requirements are documented by
[GitHub's repository traffic API](https://docs.github.com/en/rest/metrics/traffic).

## Reading the evidence honestly

- **Referrers** identify likely discovery channels, but GitHub returns only the top sources.
- **Popular paths** show which repository pages attracted attention, not whether readers installed.
- **Clones** indicate repository retrieval; bots, mirrors, and repeat cloners may contribute.
- **Stars** indicate durable interest, not activation or retention.
- **Unknown** is a valid acquisition result and must not be reassigned without evidence.
- **Verified handoff plus resume** is the milestone's strongest proof that Citadel delivered value.

The useful weekly view is therefore a joined narrative, not a fabricated conversion rate: report
GitHub attention trends, then report the independent local activation funnel from users who chose
to share a redacted aggregate.

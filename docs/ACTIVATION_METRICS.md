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

Only the install boundary is automatic in this release. Setup, route, handoff, resume, and return
must be recorded by the workflow that can prove each milestone. Missing integration remains missing
evidence, not a manufactured conversion.

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

The authenticated snapshot captured `2026-07-11T06:21:56.082Z` records the rolling GitHub
traffic window at 656 stars, 64 forks, 918 views from 490 unique viewers, and 873 clones from
506 unique cloners. The leading reported referrers by unique visitor were GitHub (126), X via
`t.co` (104), Google (79), and Reddit (51). The repository overview accounted for 463 unique
path visitors; `INSTALL.md` accounted for 10.

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

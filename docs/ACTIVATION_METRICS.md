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
configured and useful. Record a stage explicitly:

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

## GitHub acquisition history

GitHub exposes repository views, clones, top referrers, and popular paths for a rolling 14-day
window to users with repository write access. Citadel captures that short-lived data into local
daily history. The API limitation means the snapshot should be run at least once per day; it does
not recover traffic that GitHub has already aged out.

```sh
GH_TOKEN=<maintainer-token> node scripts/github-traffic-snapshot.js --repo SethGammon/Citadel
```

`GITHUB_TOKEN` is also accepted. Tokens are used only for authenticated requests and are never
written to snapshots or errors. Each run appends to
`.planning/acquisition/YYYY-MM-DD.json`; repeated same-day captures are preserved rather than
overwritten. These files are ignored by git by default.

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

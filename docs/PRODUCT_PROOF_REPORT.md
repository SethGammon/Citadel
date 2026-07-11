# Citadel 1.1 product-proof report

> **Current verdict (2026-07-11): blocked, not release-ready.** Citadel 1.1 has a
> substantial implementation and strong local engineering proof, but the milestone's
> human, benchmark, release, and showcase gates are not
> closed. [PR #181](https://github.com/SethGammon/Citadel/pull/181) is the current delivery
> path. At commit `77ebbb2`, Tests run 37 and HOL run 57 are green, and the hosted
> golden-path artifact is 30/30 across Claude/Codex, Windows/Linux/macOS.

This report is a scorecard, not launch copy. A linked contract or passing local test is not
substituted for CI, independent-user, registry, or release evidence.

## Evidence vocabulary

| Status | Meaning in this report | Current use |
|---|---|---|
| **Implementation-ready** | The code or contract exists and its focused tests pass, but a required real environment has not verified it. | Dashboard, benchmark, distribution, and release foundations |
| **Locally proven** | Reproducible evidence passed on the maintainer's Windows checkout. | Integrated strict suite, package reproducibility, focused component contracts |
| **CI-proven** | A required hosted operating-system/runtime matrix passes from fresh checkouts. | Strict Node 18/20 matrix, 30/30 golden path, and HOL scanner |
| **Human-proven** | The declared independent first-time-user or retention cohort passed. | No milestone axis yet qualifies |
| **Release-ready** | Every required product-proof gate is green and a fresh-clone tagged artifact verifies. | Not achieved |
| **Blocked** | A required gate has failed or has no qualifying evidence. | The milestone verdict |

## Milestone scorecard

The axes and thresholds come from the [product-proof architecture](../.planning/architecture-citadel-product-proof.md#milestone-exit-scorecard).

| Axis | Status | Evidence | What remains |
|---|---|---|---|
| **Reliable** | **CI-proven** | At commit `64006f0`, the hosted Tests and HOL checks pass across Linux, macOS, and Windows. The current local aggregate passed every listed check in 172.5 seconds, including the fail-closed cohort, dashboard, benchmark, acquisition, and release-integrity contracts. | Preserve these required checks on the eventual milestone commit. |
| **Installable** | **CI-proven fixture gate; human timing blocked** | PR #181 run 34 produced a complete 30/30 Claude/Codex × Linux/macOS/Windows fixture matrix, exceeding the greater-than-95% install/setup/handoff/resume thresholds with exact rollback. The workflow and artifact contract are in the [complete matrix](../.github/workflows/tests.yml#L29-L80). | Run independent stranger timings; deterministic fixtures do not prove first value under 10 minutes. |
| **Fast to value** | **Blocked; recruitment open** | The deterministic fixture exercises route-to-handoff and documents its limits in the [golden-path contract](GOLDEN_PATH.md#evidence-and-thresholds). The [independent trial protocol](PRODUCT_PROOF_TRIAL.md) validates public-comment evidence without collecting prompts or project data, and [Discussion #182](https://github.com/SethGammon/Citadel/discussions/182) is recruiting the external reviewer and first-time cohort. | Record independent stranger timings; an open recruitment thread, protocol, and fixture cannot prove median first routed task under 10 minutes or p90 verified handoff under 15 minutes. |
| **Resumable** | **CI-proven fixture gate** | PR #181 run 34 verified fresh-process continuation and exact rollback in all 30 hosted fixture journeys; see [golden-path evidence](GOLDEN_PATH.md). | Retain the hosted artifact and separately test recovery with real first-time users; fixture automation is not human proof. |
| **Understandable** | **Blocked** | Nine versioned, read-only dashboard contracts pass. Focused isolated 1,000-file runs measured 251.9-717.2 ms cold start and 110.8-458.4 ms invalidated updates; a deliberately concurrent stress sample reached 1,276.0 ms. A bare Node 22 process measured 47.6 MB; complete runs measured 55.1-55.5 MB with 3.9-4.4 MB fixture overhead, inside the enforced `<64 MB` absolute and `<10 MB` overhead gates. Browserless keyboard, responsive, and reduced-motion contracts pass. | Capture pixel screenshots once browser security allows it; prove at least 8/10 strangers identify state and next action in under 60 seconds. |
| **Useful** | **Blocked** | The [benchmark methodology](BENCHMARK.md) freezes 10 symmetric scenarios. Its [raw fixture evidence](benchmarks/product-proof-fixture-raw.jsonl) contains 60 deterministic runs and the [fixture report](benchmarks/product-proof-fixture-report.json) keeps the utility gate open/negative. | Select the external scenario and run actual bare-versus-harnessed trials. Fixture simulation cannot satisfy the utility gate. |
| **Retained** | **Blocked** | Local activation measurement exists, is opt-out capable, and does not transmit automatically; see [activation metrics](ACTIVATION_METRICS.md). The [cohort contract](PRODUCT_PROOF_TRIAL.md) rejects return events earlier than 24 hours or later than 14 days. The current activation baseline still has zero events. | Observe at least five independent users completing a second real Citadel task in the declared window. Tooling, stars, and zero events do not prove retention. |
| **Interoperable** | **CI and registry proven** | The [interoperability contract](INTEROPERABILITY.md) passes an unmodified external skill through Claude and Codex projections with immutable provenance and drift-checked metadata. ClaudePluginHub lists version `1.1.0` under the verified SethGammon personal-repository owner, and the hosted HOL plugin scanner accepts PR #181. HOL removed the obsolete plugin-profile route; its current registry targets agents and skills. | Preserve the verified listing and hosted scanner result on the eventual release commit; do not infer installs or runtime adoption. |
| **Releasable** | **CI and local foundations proven; blocked** | Tests, HOL scanning, and verified Claude publisher identity are green. The clean worktree produced a reproducible 617-file `1.1.0` archive and passed independent manifest/checksum verification; migration/update, backup, and rollback commands are documented in [release operations](RELEASES.md). | There is still no `v1.1.0` tag, published release artifact, or fresh-clone all-OS checksum proof, and the independent product gates remain open. |
| **Showable** | **Blocked** | The dashboard, benchmark page inputs, README work, and this report provide the implementation story. | Produce a browser-verified dashboard capture and a 90-second, non-mocked demo using the same tagged release. Neither exists yet. |

## Evidence map and reproducible commands

| Evidence | Source | Command |
|---|---|---|
| Full regression | [`scripts/test-all.js`](../scripts/test-all.js) | `node scripts/test-all.js --strict` |
| Golden-path fixture | [`scripts/golden-path.js`](../scripts/golden-path.js), [`scripts/test-golden-path.js`](../scripts/test-golden-path.js) | `node scripts/test-golden-path.js` |
| Cross-OS matrix | [CI workflow](../.github/workflows/tests.yml#L29-L80), [Windows baseline](../.planning/product-proof/golden-path-matrix-windows.json) | `node scripts/golden-path-matrix.js --merge <windows>,<linux>,<macos> --require-complete` |
| Dashboard contracts | [dashboard specification](DASHBOARD_SPEC.md#verification-evidence) | `node scripts/test-dashboard-web.js && node scripts/test-dashboard-perf.js && node scripts/test-dashboard-visual.js` |
| Benchmark | [methodology](BENCHMARK.md), [fixture report](benchmarks/product-proof-fixture-report.json) | `node scripts/test-product-benchmark.js` |
| Independent cohort | [trial protocol](PRODUCT_PROOF_TRIAL.md), [recruitment and evidence discussion](https://github.com/SethGammon/Citadel/discussions/182) | `node scripts/product-proof-cohort.js --input <records.jsonl> --require-complete` |
| Interoperability | [contract and registry boundaries](INTEROPERABILITY.md) | `node scripts/test-ecosystem-compat.js` |
| Activation | [privacy and metric definitions](ACTIVATION_METRICS.md), [zero-event report](../.planning/product-proof/activation-report.json) | `node scripts/activation-telemetry.js report` |
| Release | [release and rollback procedure](RELEASES.md) | `node scripts/release-package.js --ref v1.1.0 --dry-run --verify-reproducible` |

## Known limitations and stopping condition

- PR #181's first hosted golden-path result was 15/30 and remains retained as negative
  evidence. Run 34 supersedes the gate with 30/30, but neither fixture run is human timing proof.
- Dashboard structural tests are not pixel screenshots, and fixture agents are not
  first-time users.
- Benchmark fixture runs validate the runner and report, not Citadel's comparative utility.
- GitHub attention and stars do not prove setup, verified handoff, return use, or retention.
- External registry visibility, a final tag, release checksums from fresh clones, and the
  90-second demo remain absent.

Citadel 1.1 stays open until every milestone scorecard row has qualifying evidence. Failed
or missing evidence is retained in this report instead of being converted into a marketing
claim.

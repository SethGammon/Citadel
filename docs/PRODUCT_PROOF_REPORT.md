# Citadel 1.1 product-proof report

> **Current verdict (2026-07-10): blocked, not release-ready.** Citadel 1.1 has a
> substantial implementation and strong local engineering proof, but the milestone's
> human, benchmark, registry, release, and showcase gates are not
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
| **Reliable** | **CI-proven** | At commit `67fbca4`, the hosted Tests and HOL checks pass across Linux, macOS, and Windows. The current local aggregate passed every listed check in 301.2 seconds, including the repaired fail-closed exit, bounded dashboard performance, and credential-safe acquisition capture. | Preserve these required checks on the eventual milestone commit. |
| **Installable** | **CI-proven fixture gate; human timing blocked** | PR #181 run 34 produced a complete 30/30 Claude/Codex × Linux/macOS/Windows fixture matrix, exceeding the greater-than-95% install/setup/handoff/resume thresholds with exact rollback. The workflow and artifact contract are in the [complete matrix](../.github/workflows/tests.yml#L29-L80). | Run independent stranger timings; deterministic fixtures do not prove first value under 10 minutes. |
| **Fast to value** | **Blocked** | The deterministic fixture exercises route-to-handoff and documents its limits in the [golden-path contract](GOLDEN_PATH.md#evidence-and-thresholds). | Record independent stranger timings; fixture timings cannot prove median first routed task under 10 minutes or p90 verified handoff under 15 minutes. |
| **Resumable** | **CI-proven fixture gate** | PR #181 run 34 verified fresh-process continuation and exact rollback in all 30 hosted fixture journeys; see [golden-path evidence](GOLDEN_PATH.md). | Retain the hosted artifact and separately test recovery with real first-time users; fixture automation is not human proof. |
| **Understandable** | **Blocked** | Nine versioned, read-only dashboard contracts pass. Focused isolated 1,000-file runs measured 251.9-717.2 ms cold start and 110.8-458.4 ms invalidated updates; a deliberately concurrent stress sample reached 1,276.0 ms. A bare Node 22 process measured 47.6 MB; complete runs measured 55.1-55.5 MB with 3.9-4.4 MB fixture overhead, inside the enforced `<64 MB` absolute and `<10 MB` overhead gates. Browserless keyboard, responsive, and reduced-motion contracts pass. | Capture pixel screenshots once browser security allows it; prove at least 8/10 strangers identify state and next action in under 60 seconds. |
| **Useful** | **Blocked** | The [benchmark methodology](BENCHMARK.md) freezes 10 symmetric scenarios. Its [raw fixture evidence](benchmarks/product-proof-fixture-raw.jsonl) contains 60 deterministic runs and the [fixture report](benchmarks/product-proof-fixture-report.json) keeps the utility gate open/negative. | Select the external scenario and run actual bare-versus-harnessed trials. Fixture simulation cannot satisfy the utility gate. |
| **Retained** | **Blocked** | Local activation measurement exists, is opt-out capable, and does not transmit automatically; see [activation metrics](ACTIVATION_METRICS.md). The current [activation baseline](../.planning/product-proof/activation-report.json) has zero events. | Observe at least five independent users completing a second real Citadel task within 14 days. No onboarding or retention rate can be inferred from stars or zero events. |
| **Interoperable** | **Locally proven; registry proof pending** | The [interoperability contract](INTEROPERABILITY.md) passes an unmodified external skill through Claude and Codex projections, with immutable upstream commit and byte-digest evidence plus drift-checked local metadata. HOL run 57 accepts the repository. | Verify the separate Claude scanner and publisher identity/version/install/runtime support in remote registries. Remote profile state is not yet proven. |
| **Releasable** | **CI and local foundations proven; blocked** | Tests run 37 and HOL run 57 are green. The clean worktree produced a reproducible 617-file `1.1.0` archive and passed independent manifest/checksum verification; migration/update, backup, and rollback commands are documented in [release operations](RELEASES.md). | There is still no `v1.1.0` tag, published release artifact, Claude scanner result, or fresh-clone all-OS checksum proof. |
| **Showable** | **Blocked** | The dashboard, benchmark page inputs, README work, and this report provide the implementation story. | Produce a browser-verified dashboard capture and a 90-second, non-mocked demo using the same tagged release. Neither exists yet. |

## Evidence map and reproducible commands

| Evidence | Source | Command |
|---|---|---|
| Full regression | [`scripts/test-all.js`](../scripts/test-all.js) | `node scripts/test-all.js --strict` |
| Golden-path fixture | [`scripts/golden-path.js`](../scripts/golden-path.js), [`scripts/test-golden-path.js`](../scripts/test-golden-path.js) | `node scripts/test-golden-path.js` |
| Cross-OS matrix | [CI workflow](../.github/workflows/tests.yml#L29-L80), [Windows baseline](../.planning/product-proof/golden-path-matrix-windows.json) | `node scripts/golden-path-matrix.js --merge <windows>,<linux>,<macos> --require-complete` |
| Dashboard contracts | [dashboard specification](DASHBOARD_SPEC.md#verification-evidence) | `node scripts/test-dashboard-web.js && node scripts/test-dashboard-perf.js && node scripts/test-dashboard-visual.js` |
| Benchmark | [methodology](BENCHMARK.md), [fixture report](benchmarks/product-proof-fixture-report.json) | `node scripts/test-product-benchmark.js` |
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

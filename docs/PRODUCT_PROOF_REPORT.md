# Citadel product-proof scorecard

> **Current verdict, 2026-07-13: released and engineering-proven; human activation is collecting.**
> [Citadel v1.1.0](https://github.com/SethGammon/Citadel/releases/tag/v1.1.0) is a published,
> non-prerelease release. The deterministic operating journey is 30/30 across Claude Code,
> Codex, Windows, Linux, and macOS. Those facts do not prove that independent users activate,
> resume, or return.

This report separates code and distribution proof from human product proof. It is not launch copy.

## Evidence vocabulary

| Status | Meaning |
|---|---|
| **Implemented** | The feature and its focused tests exist. |
| **Locally proven** | Reproducible evidence passed on the maintainer's checkout. |
| **CI-proven** | Required hosted checks passed from fresh checkouts. |
| **Released** | A public tagged artifact exists and is not a draft or prerelease. |
| **Human-proven** | The declared independent activation or retention threshold passed. |
| **Collecting** | The measurement path is live, but the qualifying human denominator is incomplete. |
| **Blocked** | A required product claim lacks qualifying evidence or has failed. |

## Current scorecard

| Axis | Status | Evidence | Next proof |
|---|---|---|---|
| **Reliable** | **CI-proven** | The full regression, security, runtime, installer, dashboard, release-integrity, golden-path, and ecosystem contracts pass. | Preserve the gates on every release. |
| **Installable** | **Released and CI-proven** | [v1.1.0](https://github.com/SethGammon/Citadel/releases/tag/v1.1.0) was published on 2026-07-12. The hosted fixture matrix completes install, setup, route, handoff, resume, and rollback in 30 of 30 environments. | Measure independent setup completion through the activation cohort. |
| **Fast to value** | **Collecting** | The automatic funnel records install, setup, route, and verified handoff without prompts or project content. | Reach 25 shared installations and at least 60% setup plus 40% verified handoff. |
| **Resumable** | **CI-proven; human proof collecting** | Fresh-process continuation passes across the hosted fixture matrix. The opt-in cohort separately measures real resume use. | Reach at least 25% resume among successful shared installs. |
| **Understandable** | **Locally proven interface; external comprehension open** | Desktop and mobile dashboard renders, keyboard behavior, responsive layout, and reduced motion are verified. Missing data stays unknown. | Test comprehension with independent users. |
| **Useful** | **Blocked** | The [benchmark methodology](BENCHMARK.md) freezes symmetric bare-versus-harnessed scenarios and retains negative fixture results. | Run external, real-model comparative trials. |
| **Retained** | **Collecting** | The [activation cohort](PRODUCT_PROOF_TRIAL.md) requires 25 seven-day-eligible installations and at least 15% return use. Discussion #182 currently has no qualifying submissions. | Collect the cohort without replacing missing evidence with stars or clones. |
| **Interoperable** | **CI-proven** | External skill projection, provenance, containment, Claude Code, and Codex compatibility contracts pass. | Preserve registry and runtime checks. |
| **Releasable** | **Released** | The public v1.1.0 tag and release exist. Reproducible package, checksum, update, rollback, and release-integrity checks pass. | Apply the same release gate to the next version. |
| **Showable** | **Published** | The [interactive site](https://sethgammon.github.io/Citadel/) demonstrates routing, persistence, fleets, evidence states, and operating receipts. The README carries the bounded proof story. | Add real cohort evidence when it exists. |

## Current distribution evidence

The authenticated GitHub traffic snapshot captured `2026-07-13T17:14:26.158Z` reports 782 stars,
76 forks, 1,420 unique viewers, and 585 unique cloners in the rolling window. July 12 accounted for
785 unique viewers and 92 unique cloners. Google, X, GitHub, and Reddit all appear among the leading
referrers.

This proves broad discovery, not activation. GitHub's traffic API is a rolling and partially
attributed view. Clones include activity that may never become an install or a real task.

## Reproducible commands

| Evidence | Command |
|---|---|
| Full regression | `node scripts/test-all.js` |
| Golden-path fixture | `node scripts/test-golden-path.js` |
| Dashboard behavior | `node scripts/test-dashboard-web.js` |
| Dashboard performance | `node scripts/test-dashboard-perf.js` |
| Dashboard visual contract | `node scripts/test-dashboard-visual.js` |
| Local activation report | `node scripts/activation-telemetry.js report` |
| Opt-in activation bundle | `node scripts/activation-telemetry.js share --root <project>` |
| Shared cohort decision report | `node scripts/activation-cohort.js report --input <cohort.jsonl>` |
| GitHub acquisition snapshot | `node scripts/github-traffic-snapshot.js --repo SethGammon/Citadel` |
| Release integrity | `node scripts/release-verify.js --ref v1.1.0` |

## Known limitations and stopping condition

- Deterministic agents are not first-time users.
- Public GitHub attention does not prove setup, verified handoff, resume, return use, or causation.
- The activation cohort is voluntary. Failures that cannot run the share command are underrepresented.
- The benchmark runner is proven, but comparative utility remains blocked until real external trials run.
- Public Discussion comments reveal the contributor's GitHub account even though the bundle contains no personal identity.

Do not claim retained human use until the cohort report says `ready`. Failed gates and missing
evidence remain visible. They are not converted into marketing claims.

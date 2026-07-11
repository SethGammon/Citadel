# Architecture: Citadel 1.1 — Operable, Observable, Proven

> Input: `.planning/research/fleet-citadel-growth/REPORT.md` + `docs/ROADMAP.md` | Date: 2026-07-10
> Mode: feature
> Milestone window: 10–12 weeks
> Estimated complexity: high

## Milestone Definition

This milestone combines the six product needs into one release:

1. acquisition and activation measurement;
2. stable releases and updates;
3. a stranger-tested golden path;
4. a complete read-only operator dashboard;
5. a reproducible bare-agent-versus-Citadel benchmark;
6. third-party interoperability and normalized distribution.

The milestone is not complete when the features exist. It is complete when a stranger can
install Citadel, reach a verified result, understand the running system, see independent
proof that the harness helps on its target workload, and repeat the experience from a
versioned release.

### Product promise

> Give Citadel a long-running repository task. It routes the work, preserves it across
> sessions, enforces proof, shows what is happening, and leaves a resumable handoff.

### Explicit non-goals

- No new general-purpose skills unless a benchmark or user trial proves a missing capability.
- No hosted control plane, account system, remote dashboard, or cloud dependency.
- No two-way dashboard controls; read-only R1 must be excellent before R3 begins.
- No third runtime adapter in this milestone.
- No vanity benchmark tuned to tasks Citadel already wins.

## File Tree

Only new (`+`) and modified (`~`) files are shown.

```text
~
├── package.json
├── README.md
├── INSTALL.md
├── DEMO.md
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── .codex-plugin/
│   └── plugin.json
├── .github/workflows/
│   └── tests.yml
├── core/telemetry/
│   ├── schema.js
│   ├── log.js
│   └── report.js
├── dashboard/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── docs/
│   ├── ROADMAP.md
│   ├── DASHBOARD_SPEC.md
│   ├── USEFULNESS_TRIAL.md
│   ├── CODEX_INSTALLATION_GUIDE.md
│   ├── CLAUDE_INSTALLATION_GUIDE.md
│   └── index.html
├── scripts/
│   ├── install.js
│   ├── claude-install.js
│   ├── codex-install.js
│   ├── usefulness-trial.js
│   ├── dashboard-server.js
│   ├── test-all.js
│   ├── test-codex-operational-improvements.js
│   ├── test-installers.js
│   ├── test-usefulness-trial.js
│   └── test-dashboard-web.js
└── skills/setup/SKILL.md

+
├── CHANGELOG.md
├── citadel-metadata.json
├── .github/workflows/
│   └── release.yml
├── assets/
│   └── dashboard-overview.png
├── benchmarks/product-proof/
│   ├── README.md
│   └── scenarios.json
├── core/telemetry/
│   └── activation.js
├── dashboard/
│   └── schemas.js
├── docs/
│   ├── ACTIVATION_METRICS.md
│   ├── BENCHMARK.md
│   ├── INTEROPERABILITY.md
│   ├── RELEASES.md
│   ├── SHOWCASE_SCRIPT.md
│   ├── PRODUCT_PROOF_REPORT.md
│   └── benchmark.html
└── scripts/
    ├── activation-report.js
    ├── ecosystem-compat.js
    ├── generate-distribution-metadata.js
    ├── github-traffic-snapshot.js
    ├── golden-path.js
    ├── product-benchmark.js
    ├── product-benchmark-report.js
    ├── release-package.js
    ├── release-verify.js
    ├── update.js
    ├── fixtures/external-skill/SKILL.md
    ├── test-activation-telemetry.js
    ├── test-dashboard-perf.js
    ├── test-dashboard-visual.js
    ├── test-ecosystem-compat.js
    ├── test-github-traffic-snapshot.js
    ├── test-golden-path.js
    ├── test-product-benchmark.js
    └── test-release-integrity.js
```

## Component Breakdown

### Workstream 1: Measurement spine

- **Files:** `core/telemetry/activation.js`, telemetry schema/log/report files,
  `scripts/activation-report.js`, `scripts/github-traffic-snapshot.js`,
  `docs/ACTIVATION_METRICS.md`
- **Dependencies:** existing JSONL telemetry and integrity contracts; authenticated `gh`
  CLI for the maintainer-only traffic snapshot
- **Complexity:** medium
- **Responsibility:** preserve acquisition history locally and record the product stages
  that matter: install, setup, route, proof, handoff, resume, and return.

### Workstream 2: Release and update integrity

- **Files:** release workflow/scripts/docs, package and plugin manifests, `CHANGELOG.md`,
  `scripts/update.js`
- **Dependencies:** current installers, GitHub Releases, compatibility tests
- **Complexity:** medium-high
- **Responsibility:** create deterministic versioned archives, checksums, compatibility
  declarations, migrations, rollback guidance, and one supported update path.

### Workstream 3: Golden path

- **Files:** installer scripts, setup skill, usefulness trial, `scripts/golden-path.js`,
  README/install/demo documents
- **Dependencies:** Workstream 1 events and Workstream 2 version identity
- **Complexity:** high
- **Responsibility:** reduce the first experience to install → setup → real routed task →
  verification → handoff → resume, with each transition timed and diagnosable.

### Workstream 4: Read-only operator dashboard

- **Files:** dashboard SPA/server/schema, dashboard tests, screenshot asset, dashboard spec
- **Dependencies:** existing `.planning/` contracts, telemetry readers, activation stages
- **Complexity:** high
- **Responsibility:** make needs-you state, campaigns, fleets, loops, hook decisions, costs,
  handoffs, and first-success progress understandable without reading repository files.

### Workstream 5: Product benchmark

- **Files:** benchmark scenario manifest, runner, report generator, tests, benchmark docs/page
- **Dependencies:** stable release identity, golden-path automation, usefulness-trial evidence
- **Complexity:** high
- **Responsibility:** run identical pinned tasks bare and harnessed; retain raw traces and
  report completion, interventions, regressions, elapsed time, cost, recovery, and cleanup.

### Workstream 6: Interoperability and showcase distribution

- **Files:** canonical metadata, generator, ecosystem compatibility runner/fixture, plugin
  manifests, interoperability docs, README/site/showcase artifacts
- **Dependencies:** stable release, dashboard, benchmark results
- **Complexity:** medium
- **Responsibility:** prove third-party skills run under Citadel's operating layer, remove
  catalog metadata drift, verify publisher profiles, and package the milestone as one
  truthful story.

## Data Model

### ActivationEvent

- **Fields:** `schema: 1`, `timestamp`, `installation_id` (local-only random ID),
  `citadel_version`, `runtime`, `os_family`, `stage`, `status`, `duration_ms`,
  `failure_code`, `day_since_install`
- **Allowed stages:** `install_started`, `install_completed`, `setup_completed`,
  `route_completed`, `verified_handoff`, `resume_completed`, `return_session`
- **Privacy boundary:** no prompt, repository name, user identity, file path, command body,
  source code, token, or remote transmission.
- **Storage:** local `.planning/telemetry/activation.jsonl`; exported reports aggregate and
  redact raw IDs.

### AcquisitionSnapshot

- **Fields:** `captured_at`, `stars`, `forks`, `watchers`, `views`, `clones`,
  `referrers[]`, `popular_paths[]`, `recent_events[]`
- **Storage:** maintainer-local `.planning/acquisition/YYYY-MM-DD.json`; never committed by
  default.

### BenchmarkScenario

- **Fields:** `id`, `repository`, `pinned_ref`, `task`, `setup_command`,
  `verification_command`, `expected_artifacts`, `timeout_minutes`,
  `context_reset_at`, `cleanup_assertions`
- **Relationship:** one scenario produces one bare `BenchmarkRun` and one harnessed
  `BenchmarkRun` per repetition.

### BenchmarkRun

- **Fields:** `scenario_id`, `mode`, `citadel_version`, `runtime_version`,
  `started_at`, `duration_ms`, `completed`, `verification_passed`,
  `human_interventions`, `input_tokens`, `output_tokens`, `estimated_cost`,
  `resume_succeeded`, `cleanup_passed`, `artifact_paths`

### ReleaseManifest

- **Fields:** `version`, `commit`, `created_at`, `node_range`, `runtime_matrix`,
  `artifacts[]`, `checksums`, `migration_from[]`, `rollback_command`

## Key Decisions

### Milestone boundary: one product-proof release

- **Chosen:** one 10–12 week milestone with seven build phases and a single scorecard.
  Release, activation, visibility, proof, and distribution depend on one another and should
  tell one coherent product story.
- **Rejected:** six independent feature milestones. This would allow the dashboard or
  benchmark to ship before the installer, version identity, and measurement contracts are
  trustworthy.
- **Rejected:** wait for the full R1–R5 roadmap. That postpones proof until after unrelated
  team and runtime expansion.

### Activation measurement: local-first with explicit export

- **Chosen:** record stage events locally and export only redacted aggregates when a user
  explicitly chooses to share them. Use concierge trials for the first external cohort.
- **Rejected:** automatic remote analytics. It conflicts with Citadel's local-first trust
  position and introduces hosted infrastructure before demand is proven.
- **Rejected:** GitHub stars/clones as activation proxies. They cannot measure setup,
  verified work, resume, or retention.

### Installation: auto-detect with explicit override

- **Chosen:** `--runtime auto` becomes the normal path; `--runtime claude|codex` remains
  a deterministic override. The installer prints every mutation and the exact next action.
- **Rejected:** keep runtime choice as a required first decision. It adds friction the
  running environment can usually resolve.
- **Rejected:** hide all runtime-specific setup. Some plugin enable/fresh-session boundaries
  are controlled by the host and must remain explicit.

### Dashboard: projection, never source of truth

- **Chosen:** finish the existing stdlib-only read-only dashboard over versioned normalized
  schemas; every claim links to its source file or telemetry record.
- **Rejected:** React/database rewrite. It adds a second state model and delays proof.
- **Rejected:** two-way controls in this milestone. Mutation changes the threat model and
  belongs after the read-only surface earns trust.

### Benchmark design: pinned symmetric tasks with an adversarial gate

- **Chosen:** 8–12 pinned scenarios, identical verification, multiple repetitions, raw
  traces, and publication of negative results. At least one scenario is selected by an
  external reviewer after the runner is frozen.
- **Rejected:** benchmark only Citadel-native workflows. It would demonstrate the harness,
  not compare it.
- **Rejected:** live mutable repositories. They destroy reproducibility.

### Ecosystem position: control layer above skills

- **Chosen:** prove an external `SKILL.md` workflow can be installed, routed, observed,
  verified, and handed off under Citadel.
- **Rejected:** compete through a larger skill count. Platform-native skills are becoming
  interchangeable, while operations and proof remain differentiated.

## Build Phases

### Phase 0: Baseline and scope lock

- **Goal:** capture current truth and prevent unrelated feature growth during the milestone.
- **Files:** `.planning/product-proof/baseline.md` (campaign artifact only)
- **Dependencies:** none
- **End Conditions:**
  - [ ] `git status --short`, `node scripts/test-all.js --strict`, installer/runtime
    suites, dashboard tests, and current golden-path timing are recorded with exact outputs.
  - [ ] The managed-checkout `EPERM` failure is reproduced and attributed to the exact
    source-refresh writes.
  - [ ] Current install, dashboard, activation, release, and benchmark baselines are marked
    `proven`, `partial`, or `missing`.
  - [ ] No new syntax/type-contract errors; existing test state is unchanged.

### Phase 1: Hermetic reliability and versioned release

- **Goal:** make a clean checkout and a release artifact independently verifiable.
- **Files:** package/plugin manifests, release workflow/scripts/docs, update script,
  test-all/operational/installer tests, CI workflow, changelog
- **Dependencies:** Phase 0
- **End Conditions:**
  - [ ] `node scripts/test-all.js --strict` passes from both a writable checkout and a
    read-only source copy; tests mutate only temporary targets.
  - [ ] Linux, macOS, and Windows CI pass Node 18 and 20 installer/runtime matrices.
  - [ ] Two consecutive dry-run release builds from the same commit produce identical
    artifact hashes.
  - [ ] `node scripts/release-verify.js <artifact>` validates manifest and checksums.
  - [ ] Update and rollback fixtures pass for the previous package version.
  - [ ] No new syntax/type-contract errors; all existing tests pass.

### Phase 2: Local activation and acquisition measurement

- **Goal:** replace star-based guessing with a privacy-safe product funnel.
- **Files:** activation telemetry module/schema/report/tests, GitHub traffic snapshot script,
  activation metrics documentation
- **Dependencies:** Phase 1 version identity
- **End Conditions:**
  - [ ] Unit tests cover every activation stage, failure code, duration, and upgrade from an
    older schema.
  - [ ] A privacy test rejects prompts, paths, repository names, command bodies, and unknown
    fields from exported reports.
  - [ ] Network interception proves activation logging and reporting make zero outbound
    requests.
  - [ ] A fixture journey produces install → setup → route → handoff → resume stages and a
    redacted aggregate report.
  - [ ] `node scripts/github-traffic-snapshot.js --repo SethGammon/Citadel` writes a valid
    dated snapshot and preserves repeated-day history without overwrite.
  - [ ] No new syntax/type-contract errors; all existing tests pass.

### Phase 3: Stranger-tested golden path

- **Goal:** turn installation into a verified first result with one obvious route.
- **Files:** installers, setup skill, usefulness trial, golden-path runner/tests, README,
  install/demo/runtime guides
- **Dependencies:** Phases 1 and 2
- **End Conditions:**
  - [ ] `node scripts/golden-path.js --runtime claude|codex --fixture <path>` reaches a
    verified handoff and a successful fresh-session resume in automated fixtures.
  - [ ] A 30-run matrix (2 runtimes × 3 operating systems × 5 repetitions) has >95% install
    and setup success without manual repair.
  - [ ] Median install-to-first-routed-task time is <10 minutes and p90
    install-to-verified-handoff time is <15 minutes in recorded trials.
  - [ ] Every failure ends with one machine-readable failure code and one exact recovery
    action; no generic “try again” state remains.
  - [ ] Uninstall/rollback returns the fixture repository to its pre-install state.
  - [ ] No new syntax/type-contract errors; all existing tests pass.

### Phase 4: Complete R1 “See It” and R2 “Prove It”

- **Goal:** make Citadel understandable at a glance and publish defensible evidence that it
  helps on its target workload.
- **Files:** dashboard server/SPA/schema/tests, dashboard spec, overview screenshot,
  benchmark manifests/runners/reports/tests, benchmark docs/page
- **Dependencies:** Phases 2 and 3
- **Execution:** two parallel workstreams after normalized event and golden-path contracts
  freeze; integrate before phase validation
- **End Conditions — dashboard track:**
  - [ ] Overview, needs-you, campaigns, fleet, loops, hooks, handoffs, cost, and activation
    state validate against schema 1 on healthy, empty, mid-run, and corrupted fixtures.
  - [ ] Corrupted or absent sources render `unknown`/`unreadable`, never false green or
    zero.
  - [ ] Generated 1,000-file fixture: cold start <1 second, file-to-SSE update <500 ms,
    complete server RSS <64 MB and dashboard-attributed overhead <10 MB.
  - [ ] Automated dark/light, desktop/380 px screenshots pass the visual baseline; keyboard
    and reduced-motion checks pass.
  - [ ] At least 8 of 10 strangers correctly describe the active goal, current phase,
    blocked item, and next action within 60 seconds.
- **End Conditions — benchmark track:**
  - [ ] 8–12 scenarios span short control tasks, long tasks, context resets, parallel work,
    safety boundaries, and cleanup; every repository is pinned to a commit.
  - [ ] Bare and harnessed runs use identical task text, runtime/model configuration,
    timeout, and verification commands.
  - [ ] At least three repetitions per mode complete and raw traces regenerate the same
    published aggregates.
  - [ ] An external reviewer selects at least one scenario after runner behavior is frozen.
  - [ ] Citadel is no worse on verified completion and demonstrates either ≥25% fewer human
    interventions or ≥20 percentage points better completion/recovery on the target long-task
    segment, with median orchestration cost overhead ≤15%.
  - [ ] If the utility gate is missed, the milestone remains open and the negative result is
    published; no metric or scenario may be removed post hoc.
  - [ ] No new syntax/type-contract errors; all existing tests pass.

### Phase 5: Ecosystem and distribution proof

- **Goal:** make Citadel easy to discover, trust, install, and combine with other skill packs.
- **Files:** canonical metadata/generator, ecosystem compatibility runner/fixture/tests,
  plugin manifests, interoperability/release docs
- **Dependencies:** Phase 1; may begin while Phases 4 and 5 run
- **End Conditions:**
  - [ ] The external skill fixture installs, routes, runs, verifies, emits telemetry, and
    produces a Citadel handoff without modifying the fixture's source skill.
  - [ ] `node scripts/generate-distribution-metadata.js --check` proves README, plugin
    manifests, runtime support, install command, version, skill count, and proof links agree.
  - [ ] Claude and Codex plugin scanners accept the release artifact.
  - [ ] ClaudePluginHub and HOL show verified publisher identity, current version, canonical
    install path, and current runtime support; captured profile evidence is stored in the
    campaign.
  - [ ] No new syntax/type-contract errors; all existing tests pass.

### Phase 6: Showcase and product-proof scorecard

- **Goal:** package the completed product as one honest, repeatable story and validate
  retention beyond the first demo.
- **Files:** README, demo, project site, benchmark page, showcase script, product proof report,
  roadmap
- **Dependencies:** Phases 4, 5, and 6
- **End Conditions:**
  - [ ] The README first screen contains one product promise, one 60-second visual proof, one
    install action, supported runtimes, and an honest experimental-boundary note.
  - [ ] A 90-second demo shows install, routed work, dashboard visibility, verified handoff,
    and resume using the tagged release with no mocked product behavior.
  - [ ] Ten independent users complete observed onboarding; at least eight reach a verified
    handoff within 15 minutes and every failure has a filed cause.
  - [ ] At least five independent users complete a second real Citadel task within 14 days.
  - [ ] `docs/PRODUCT_PROOF_REPORT.md` links the release, raw benchmark, dashboard evidence,
    user-trial summary, compatibility matrix, and known limitations.
  - [ ] The final release tag and checksum verify from a fresh clone on all supported
    operating systems.
  - [ ] No new syntax/type-contract errors; all existing tests pass.

## Phase Dependency Graph

```text
Phase 0 Baseline
    ↓
Phase 1 Reliability + Release
    ↓
Phase 2 Measurement
    ↓
Phase 3 Golden Path
    ├──────────────→ Phase 4 Dashboard + Benchmark ───┐
    └ Phase 1 ─────→ Phase 5 Ecosystem ───────────────┼→ Phase 6 Showcase + Scorecard
```

The two Phase 4 workstreams are parallel-safe after Phase 2 schemas and Phase 3 journey
contracts freeze. Phase 5 can start after Phase 1, but public metadata must be regenerated
after Phase 4.

## Milestone Exit Scorecard

Citadel 1.1 is “operable, observable, proven” only when every row is green.

| Axis | Exit gate |
|---|---|
| Reliable | Strict suite green in writable and read-only source checkouts; release checksum and rollback verified |
| Installable | >95% automated install/setup success across Claude/Codex × Linux/macOS/Windows |
| Fast to value | Median first routed task <10 min; p90 verified handoff <15 min |
| Resumable | Campaign/fixture fresh-session resume success >95% |
| Understandable | 8/10 strangers explain live dashboard state and next action in <60 sec |
| Useful | Benchmark clears the declared intervention or completion/recovery improvement gate without >15% median overhead |
| Retained | Five independent users perform a second real task within 14 days |
| Interoperable | One unmodified third-party skill completes under Citadel routing, proof, telemetry, and handoff |
| Releasable | Tagged artifact, changelog, checksums, migration, rollback, update command, compatibility matrix |
| Showable | README, dashboard capture, 90-second real demo, benchmark page, and product-proof report all use the same tagged release |

## Risk Register

1. **Regression in existing functionality:** gate every phase on the strict suite, isolated
   installer/runtime tests, and a clean diff; keep golden-path changes additive until the
   matrix passes.
2. **Analytics damages local-first trust:** prohibit automatic transmission, test the event
   allowlist, keep raw IDs local, and make export explicit and inspectable.
3. **Benchmark becomes marketing theater:** freeze runner and metrics before runs, pin
   repositories, use symmetric verification, include an external scenario, and publish
   negative results.
4. **Dashboard creates a second source of truth:** version projection schemas, link every
   value to canonical files, and reject write endpoints in v0.1 tests.
5. **Release work fractures runtime compatibility:** derive all plugin/runtime metadata from
   one canonical manifest and test both adapters from the release artifact.
6. **Milestone expands into another feature campaign:** enforce the non-goal list and require
   user/benchmark evidence before admitting any new skill or orchestration surface.
7. **Human-trial targets are gamed by expert users:** recruit people who have not installed
   Citadel before, record failure stages, and count only real repository tasks.
8. **External registry state blocks completion:** finish canonical metadata and release proof
   first; treat registry verification as a distribution gate with captured evidence, not a
   reason to weaken product correctness.

## Deployment Strategy

- **Release platform:** GitHub Releases for signed/checksummed artifacts; existing Claude and
  Codex plugin marketplaces/registries for discovery.
- **Showcase platform:** existing GitHub Pages site for the dashboard capture, benchmark page,
  methodology, and install path.
- **Product runtime:** local-only; dashboard binds to `127.0.0.1`; activation data stays in
  the target repository unless explicitly exported.
- **Version strategy:** tag the completed milestone as `v1.1.0`; generate package/plugin
  versions and canonical metadata from that tag.
- **Pre-release checks:** strict suite, OS/runtime matrix, release reproducibility, checksum
  verification, update/rollback, benchmark regeneration, docs/metadata drift check, fresh
  install, fresh-session resume, dashboard performance and visual checks.
- **Launch condition:** all milestone scorecard rows are green. A failed benchmark or
  retention gate blocks “product proof” positioning even if the code ships.

## Campaign Mapping

Each build phase maps directly to one Archon phase. Recommended execution:

- Phase 0–3: sequential because contracts and version identity are load-bearing.
- Phase 4: parallel Fleet wave with separate dashboard and benchmark scopes.
- Phase 5: may overlap late Phase 4 work; regenerate metadata after Phase 4 lands.
- Phase 6: integration and external validation; no parallel product development.

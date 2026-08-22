# Changelog

All notable Citadel changes are recorded here. Citadel follows semantic versioning.

## 1.3.5 - 2026-08-13

### Changed

- Codex agent projection now defaults to the current GPT-5.6 Sol, Terra, and
  Luna model families instead of deprecated GPT-5.4 variants.
- The strongest Claude arbiter role now uses the current `fable` alias at
  `max` effort; lightweight policy roles use the current Haiku 4.5 alias.
- Projects can configure Codex model-family mappings, per-agent models, and
  per-agent reasoning effort through a plan-first config command. Supported
  Codex effort levels now include `xhigh`, `max`, and `ultra`.

## 1.3.4 - 2026-08-13

### Fixed

- Fleet activation recovery now executes through the project-local
  `.citadel/scripts/citadel-config.js` delegate, so the displayed command works
  from an installed project rather than requiring a Citadel source checkout.

## 1.3.3 - 2026-08-13

### Fixed

- Codex `$skill` invocations now pass the same product-bundle activation gate
  as Claude Code `/skill` invocations.
- Fleet activation now presents one complete, runtime-bound recovery command.
  When Codex needs Citadel's managed worktree and approval adapter, that command
  explicitly records the required degraded-runtime opt-in instead of leaving
  Fleet unavailable after the bundle is enabled.
- The bug-report form no longer asks plugin users to clone Citadel and run the
  maintainer test suite, and its examples show both Codex and Claude Code skill
  syntax.

## 1.3.2 - 2026-08-12

### Fixed

- Deterministic release archives now canonicalize the informational GZIP
  source-OS marker, producing identical bytes on Windows, macOS, and Linux.

## 1.3.1 - 2026-08-12

### Fixed

- Tagged release packaging now reads tracked media with an explicit bounded Git
  output buffer instead of Node's 1 MiB child-process default.
- The Fleet isolation fixture now creates real detached Git worktrees rather
  than recursively copying a live `.git` directory.
- Release manifests report the supported Node 22/24 matrix.

### Release note

- `v1.3.0` was tagged but never published because its release matrix failed.
  `v1.3.1` is the first installable release in this series.

## 1.3.0 - 2026-08-12

### Distribution

- GitHub Releases are the sole supported release channel. Each release contains
  a deterministic archive, external manifest, and SHA-256 sidecar, with
  GitHub-native SLSA provenance covering all three files.
- Release contents now come from a committed allowlist that excludes benchmark
  corpora, research and grant material, site media, screenshots, test programs,
  and maintainer-only instrumentation.
- The root package is private and the unowned public npm publication workflow
  has been removed. `npm pack` remains a local packaging smoke test only.
- Tagged release manifests identify the peeled source commit for annotated tags
  and accept only an exact `v<package.version>` release ref.

### Added

- Operation Control v2 adds an installable `citadel operation` runtime for
  outcome-aware model, tool, and topology selection across a complete declared
  retry and fallback path.
- Codex and Claude CLI adapters, independent command verification, observed
  control reconciliation, three fail-honest economic lenses, digest-bound
  reports, OpenTelemetry-compatible GenAI attributes, and JSONL outcome learning.
- The public experience now uses four progressive levels: `/do`, durable
  continuation, coordinated work, and optional explicit Operation Control.
- Zero-to-Receipt showcase (`docs/SHOWCASE.md`): the canonical Operation Fork
  journey — objective, dual-runtime isolation, interruption and fresh-session
  recovery, honest comparison, human selection, landing, offline receipt
  verification, and redacted replay — with a reproducible demo repository.
- `docs/archive/` for superseded internal specifications.

### Changed

- Moved superseded internal specifications to `docs/archive/`.
- npm package excludes documentation images, archived specs, and raw benchmark
  fixture output (unpacked size 7.7 MB → ~5.8 MB).
- Internal planning state (experiment logs, compiled memory blocks, active
  strategy campaigns, PRDs) is now local-only and excluded from the repository.

### Added

- Operation Fork runs one objective through isolated Claude Code and Codex worktrees
  under one immutable objective, scope, policy, budget, workflow, and verifier contract.
- Signed per-branch receipts, evidence coverage, duration, cost, and diff metadata feed
  an honest comparison that preserves ties and insufficient evidence.
- Revision-bound selection is separate from a confirmed, clean-target landing action.
  Ambiguous landing effects block recovery instead of repeating a merge.
- `citadel fork start`, `resume`, `status`, `compare`, `select`, `land`, and `replay`
  provide the complete local journey with a safe default verifier.
- Mission Control adds a responsive side-by-side Forks view and typed same-origin
  selection endpoint. Browser selection never lands code.
- Deterministic public replay exports omit prompts, source, repository identity,
  paths, credentials, raw revisions, reasons, and signer material.

### Verification

- A frozen retrospective import verifies 120 signed real-repository cells,
  87 model attempts, source attestations and digests, zero adversarial false
  passes, and explicit preservation of the still-open performance gate.
- A preregistered prospective integration cell invokes Claude Code against a
  pinned public repository, reconciles the observed model and topology, requires
  the declared artifact change, and passes only after an independent verifier.
  Two infrastructure failures remain published beside the pass.
- Operation Control tests cover strict contracts, conservative Wilson outcome
  estimates, whole-path maximum admission, tool/model/topology reconciliation,
  failure-directed retry, runtime adapters, tamper detection, scale, CLI, and
  installed-package contents.
- Real git worktree isolation and recovery fault injection cover both runtime branches.
- Adversarial tests cover strict schemas, path containment, shell-free spawning,
  redaction, revision races, idempotency, and exactly-once landing boundaries.

This version is prepared in the repository. No package publication, tag, or hosted
service is created by the Operation Fork campaign.

## 1.2.0 - 2026-07-13 (source milestone; not published)

This version was prepared in source but did not receive a Git tag, GitHub
Release, or supported package publication.

### Added

- A conventional `citadel` package CLI for install, doctor, update, rollback, uninstall,
  Pack inspection, starter journeys, and offline receipt verification.
- Operations Protocol v0.1 contracts for specs, runs, attempts, intents, evidence, and
  receipts, plus deterministic adapter conformance and three-target workflow compilation.
- Durable journals, checkpoint recovery, chaos verification, and Ed25519 execution receipts.
- Three first-party outcome Packs with strict manifests, permissions, certification,
  dependency enforcement, and proof-producing journeys.
- A read-only GitHub verification Action, provenance-ready trusted publishing workflow, and
  a classified proof ledger that preserves passed, failed, blocked, and unknown outcomes.
- Typed MCP task control and actionable local Mission Control controls for pause, resume,
  stop, and retry through immutable intents.
- Hierarchical team policy, a five-operator pilot simulator, local-first encrypted Relay
  envelopes, external milestone gates, and privacy-safe reliability analysis.

### Changed

- Canonical package and plugin surfaces are aligned at `1.2.0`.
- The dashboard now presents authorized operation controls, exact next effects, confirmation
  for destructive actions, and honest pending-intent state.
- The strict suite now includes operation, Pack, proof, control, team, Relay, and reliability
  contracts.

### Security

- GitHub workflow argv is executed without a shell, YAML values are mechanically quoted,
  and semantic coverage is derived from generated artifacts.
- Independent proof requires an externally pinned trust root; bundle-controlled keys cannot
  claim independent provenance.
- Relay rejects nested sensitive fields, traversal, and symlinked outbox entries.
- Passed receipts require complete required-step and verifier evidence coverage.

## 1.1.0 - 2026-07-12

### Added

- Deterministic `tar.gz` release artifacts with an embedded release manifest, an external
  manifest, and a SHA-256 sidecar.
- Offline release verification for artifact integrity, file-level checksums, source ref,
  commit, and package/plugin version agreement.
- A plan-first local-artifact updater with explicit `--apply`, automatic backup, and an
  explicit rollback command.
- Strict Node 22/24 verification across Linux, macOS, and Windows before tagged packaging.
- Local activation funnel recording with strict schemas, opt-out controls, legacy migration,
  and explicitly exported redacted reports.
- Maintainer-local GitHub traffic snapshots that preserve daily acquisition history beyond
  GitHub's rolling traffic window.
- Deterministic Claude and Codex golden-path fixtures covering project preparation, setup,
  routing, verification, handoff, fresh-process resume, and exact rollback.
- A strict cross-platform matrix aggregator that requires real Windows, Linux, and macOS run
  evidence and keeps fixture timing separate from stranger timing.

### Changed

- Canonical package, Claude plugin, Claude marketplace, and Codex plugin versions are
  aligned at `1.1.0`.
- CI now treats warnings as failures and includes macOS.

### Security

- Release verification rejects corrupt archives, checksum drift, undeclared files,
  path traversal, version drift, and ref drift before update application.
- Activation records reject prompt, identity, repository, path, command, source-code, and
  credential fields; activation reporting performs no network requests.

## 1.0.0

- Initial public source baseline; no formal tagged release artifact was published.

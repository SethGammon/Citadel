# Changelog

All notable Citadel changes are recorded here. Citadel follows semantic versioning.

## 1.3.0 - Unreleased

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

- Real git worktree isolation and recovery fault injection cover both runtime branches.
- Adversarial tests cover strict schemas, path containment, shell-free spawning,
  redaction, revision races, idempotency, and exactly-once landing boundaries.

This version is prepared in the repository. No package publication, tag, or hosted
service is created by the Operation Fork campaign.

## 1.2.0 - 2026-07-13

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
- Strict Node 18/20 verification across Linux, macOS, and Windows before tagged packaging.
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

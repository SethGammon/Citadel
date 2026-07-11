# Changelog

All notable Citadel changes are recorded here. Citadel follows semantic versioning.

## 1.1.0 - Unreleased

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

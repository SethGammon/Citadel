# Citadel releases

Citadel releases are versioned, reproducible archives intended for GitHub Releases. The
planned milestone version is `1.2.0`; Node 18 and 20 are tested on Linux, macOS, and
Windows for both Claude and Codex runtime surfaces.

## Build and verify

From a clean checkout at the release tag:

```sh
node scripts/test-all.js --strict
node scripts/release-package.js --ref v1.2.0 --dry-run --verify-reproducible
node scripts/release-package.js --ref v1.2.0 --output-dir dist/release --verify-reproducible
node scripts/release-verify.js dist/release/citadel-v1.2.0.tar.gz --ref v1.2.0 --version 1.2.0
```

The package command creates:

- `citadel-v1.2.0.tar.gz`, with one `citadel-1.2.0/` root and an embedded
  `.citadel-release.json`;
- `citadel-v1.2.0.tar.gz.manifest.json`, which records version, ref, commit,
  compatibility, file hashes, and the artifact hash;
- `citadel-v1.2.0.tar.gz.sha256`, the standard SHA-256 sidecar.

`--dry-run` writes only to an operating-system temporary directory and removes it. With
`--verify-reproducible`, two independent builds must produce identical archive and manifest
bytes. A `v*` tag runs the same strict matrix before the release workflow packages and
publishes anything. Creating or pushing that tag is a separate maintainer approval step.

## Update safely

Download all three release files into the same directory. Point the updater at a standalone
Citadel installation, not at a target project using Citadel:

```sh
node scripts/update.js --archive /path/to/citadel-v1.2.0.tar.gz --target /path/to/Citadel
```

This is a read-only plan. It verifies the archive and prints the exact backup directory and
rollback command. Nothing changes without explicit application:

```sh
node scripts/update.js --archive /path/to/citadel-v1.2.0.tar.gz --target /path/to/Citadel --apply
```

The updater preserves `.git/` and `.planning/`, backs up the installed release code beside
the target under `.citadel-backups/`, then replaces release files. It never fetches from the
network; artifact acquisition remains an explicit operator action.

## Roll back

Use the exact rollback target printed by the update plan or apply result. Rollback is also
plan-first:

```sh
node scripts/update.js --rollback /path/to/.citadel-backups/Citadel-1.1.0-before-1.2.0-<commit> --target /path/to/Citadel
node scripts/update.js --rollback /path/to/.citadel-backups/Citadel-1.1.0-before-1.2.0-<commit> --target /path/to/Citadel --apply
```

Never delete the backup until the updated installation has passed its normal setup and
runtime verification.

## Release invariants

- `package.json`, both Claude manifests, and the Codex manifest must have one version.
- A `vX.Y.Z` ref must match package version `X.Y.Z`.
- Every archived file must be declared with its byte count and SHA-256 hash.
- The archive SHA-256 must match both sidecar and external manifest.
- Release automation must not use force operations, verification bypasses, or literal
  credentials.

## npm trusted publishing

The `Publish npm package` workflow is manual only. A maintainer must explicitly dispatch it with the `publish` boolean enabled, then approve the protected `npm-publish` environment. The workflow does not run on pushes, pull requests, tags, schedules, or other workflow completion.

The verification job runs the full strict suite, checks the package allowlist through the packed-tarball smoke test, and uploads the resulting tarball for one day. Only the publish job receives `id-token: write`; every job otherwise has `contents: read`.

Publication uses `npm publish --provenance` through npm trusted publishing. No npm token is stored or passed. The npm package owner must configure the repository and workflow as a trusted publisher before npm will accept a release. Adding the workflow does not publish, reserve a package name, create a tag, or configure that external trust relationship.

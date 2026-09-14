# Citadel releases

GitHub Releases are Citadel's sole supported release channel:
<https://github.com/SethGammon/Citadel/releases>.

Every published version has exactly three downloadable release assets:

- `citadel-vX.Y.Z.tar.gz`, a deterministic source/runtime archive with one
  `citadel-X.Y.Z/` root and an embedded `.citadel-release.json` manifest;
- `citadel-vX.Y.Z.tar.gz.manifest.json`, which records the exact peeled source
  commit, compatibility matrix, file list, byte counts, and file hashes;
- `citadel-vX.Y.Z.tar.gz.sha256`, the archive SHA-256 sidecar.

GitHub Actions also generates signed SLSA build provenance for all three files.
The attestation is stored by GitHub and is not a fourth release asset.

The root npm package is private. The public unscoped `citadel` namespace is not
owned by this project, so `npm install citadel`, `npx citadel`, and npm registry
tarballs are not supported Citadel acquisition paths. `npm pack` is used only
as a local package-boundary and CLI smoke test.

The authoritative current version is the newest immutable tag that also has a
non-draft GitHub Release. `v1.3.0` is an immutable failed release tag with no
GitHub Release and must not be installed. The `1.2.0` source milestone was
never tagged or published.

## Release contents

`release-files.json` is the committed release allowlist. A path not selected by
that policy is not shipped. The policy retains the package CLI, runtime
adapters, installers, governed adoption, update, rollback, uninstall, hooks,
skills, agents, MCP servers, schemas, templates, and product documentation. It
excludes benchmark corpora, research and grant material, site media,
screenshots, test programs, compatibility fixtures, and maintainer-only
instrumentation.

The builder rejects a missing or malformed allowlist entry. It also rejects any
release ref other than the exact `v<package.version>` tag. Annotated tags are
peeled so the manifest's `commit` field identifies the source commit, not the
tag object.

## Maintainer build and verification

From a clean checkout of the intended release commit, first run the untagged
reproducibility check:

```sh
node scripts/test-all.js --strict
node scripts/release-package.js --dry-run --verify-reproducible
```

Creating and pushing a tag is a separate maintainer action. Before the first
public release, enable a repository ruleset that prevents updates or deletion
of `refs/tags/v*`. Once the source and all version manifests are ready, the
release tag must exactly match the package version. For example:

```sh
TAG=v1.4.2
node scripts/release-package.js --ref "$TAG" --dry-run --verify-reproducible
node scripts/release-package.js --ref "$TAG" --output-dir dist/release --verify-reproducible
node scripts/release-verify.js "dist/release/citadel-$TAG.tar.gz" --ref "$TAG" --version 1.4.2
```

A pushed `v*` tag runs the same strict and reproducibility checks on Node 22 and
24 across Linux, macOS, and Windows. The packaging job then rebuilds and
verifies the trio and creates GitHub-native provenance with least privilege. The
packaging job alone receives `contents: write`, `id-token: write`, and
`attestations: write`; it receives no package-registry or registry-linked
artifact-metadata permission. It then
publishes only the three named files. If any gate fails, no GitHub Release is
created.

## Consumer verification

Download the complete trio from the GitHub Release. From a trusted Citadel
checkout, verify the archive's offline integrity and internal manifest consistency:

```sh
node scripts/release-verify.js /path/to/citadel-v1.4.2.tar.gz \
  --ref v1.4.2 --version 1.4.2
```

This offline check proves that the archive, checksum sidecar, embedded manifest,
external manifest, and expected version/ref strings agree. It does not by itself
authenticate the publisher or resolve a trusted Git tag. After the tagged GitHub
workflow publishes the release, use `gh attestation verify` against this repository
for authenticated build provenance. See [GitHub's artifact-attestation guide](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

When online, independently verify GitHub's signed build provenance:

```sh
gh attestation verify /path/to/citadel-v1.4.2.tar.gz -R SethGammon/Citadel
gh attestation verify /path/to/citadel-v1.4.2.tar.gz.manifest.json -R SethGammon/Citadel
gh attestation verify /path/to/citadel-v1.4.2.tar.gz.sha256 -R SethGammon/Citadel
```

The archive, sidecar, external manifest, embedded manifest, GitHub asset digest,
and attestation subjects must agree. Treat a missing file, digest mismatch,
source-commit mismatch, or failed attestation as a blocked release.

## Update safely

Point the updater at a standalone Citadel installation, not at a target project
that Citadel manages. The default command is a read-only plan:

```sh
node scripts/update.js --archive /path/to/citadel-v1.4.2.tar.gz --target /path/to/Citadel
```

After reviewing the verified source, backup path, and rollback command, apply it
explicitly:

```sh
node scripts/update.js --archive /path/to/citadel-v1.4.2.tar.gz --target /path/to/Citadel --apply
```

The updater preserves `.git/` and `.planning/`, creates a backup beside the
target under `.citadel-backups/`, and replaces only release files. It does not
fetch from the network.

## Roll back

Use the exact backup path printed by the update operation. Rollback validates
the backup receipt's target binding and content digest, rejecting a different
directory or modified backup. It is also plan-first:

```sh
node scripts/update.js --rollback /path/to/.citadel-backups/Citadel-previous --target /path/to/Citadel
node scripts/update.js --rollback /path/to/.citadel-backups/Citadel-previous --target /path/to/Citadel --apply
```

Keep the backup until the updated installation passes its normal setup and
runtime verification.

## Release invariants

- `package.json`, both Claude manifests, the Claude marketplace entry, the
  Codex manifest, metadata, tag, and changelog agree on one version.
- A release ref is exactly `v<package.version>` and resolves to the manifest's
  peeled source commit.
- Every archived file is selected by `release-files.json` and declared with its
  byte count and SHA-256 hash.
- Benchmark, research, grant, site-media, screenshot, test, fixture, and
  maintainer-only instrumentation paths are absent.
- The archive hash matches the sidecar, external manifest, GitHub asset digest,
  and SLSA attestation subject.
- Release automation uses SHA-pinned actions, least permissions, no force
  operations, no verification bypasses, and no npm publication path.

## Security update migration

Existing OS schedules keep their stored commands when Citadel is updated.
Users of the full Git marketplace installation should review those entries,
remove the old jobs by exact ID, and recreate only the jobs still wanted.
The slim archive does not include the source-only scheduling commands.
The report and delivery follow-up are tracked in [issue #278](https://github.com/SethGammon/Citadel/issues/278). The full source checkout includes the detailed security migration guide.

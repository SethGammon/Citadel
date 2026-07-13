# Pack governance

The local Pack registry separates four claims that must not be collapsed:

1. A Pack manifest is structurally valid.
2. A Pack's declared checks produced evidence.
3. A pinned publisher signed the exact Pack digest and owns that Pack identity.
4. Independent users adopted the Pack.

The signed local registry proves only claim 3. Certification addresses claims 1 and 2. External
adoption remains a separate milestone.

## Ownership contract

Publisher ownership lives in a trust manifest selected by the operator, outside the registry
directory. Each publisher entry pins an Ed25519 public key and an explicit list of Pack IDs that
key may sign. A publisher cannot acquire a new Pack name by adding it to registry content. The
operator must update the separately held ownership manifest.

Registry content contains publisher key IDs and signatures, never public key material, private
keys, repository paths, prompts, source, credentials, or network locations. The registry itself
is signed by a separately pinned registry key.

## Contributor changes

A contributor proposing a Pack or ownership change should provide:

- The Pack manifest, workflow, and deterministic content digest.
- Local certification evidence with unknown checks left unknown.
- The requested Pack ID and publisher ID.
- A public Ed25519 key through a separately reviewed ownership change.
- A revocation contact and recovery plan outside public registry content.

Maintainers review Pack code and ownership independently. Merging Pack content does not silently
grant a signing key ownership of that Pack ID. Key rotation requires a trust-manifest change and
a registry update signed by the registry owner.

## Revocation

The signed index supports publisher, Pack, and exact-version revocations. A matching active entry
is unusable even when both signatures remain cryptographically valid. Revocations are append-only
records in the generated index and include a bounded reason code and canonical timestamp.

Publisher scope disables every Pack owned by that publisher. Pack scope disables every version of
one Pack. Version scope disables one exact version. Removing a revocation requires a new reviewed
registry artifact and should preserve the prior signed artifact for audit history.

## Local-only boundary

This contract performs no network requests, downloads, uploads, discovery, identity hosting, or
remote publication. It does not create a marketplace or prove community adoption. External
publisher onboarding and registry distribution remain separately gated work.

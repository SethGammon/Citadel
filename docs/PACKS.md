# Citadel Packs

Citadel Packs are versioned, declarative operating bundles. A Pack composes existing skills into one bounded workflow and declares its permissions, capabilities, supported runtimes, artifacts, verification, and stopping conditions before installation.

## Alpha Contract

Every Pack lives under `packs/{name}/` and contains `citadel.pack.json` plus one referenced entry workflow. Pack content may not contain symlinks or network-fetched files.

Unknown manifest, workflow, verification, and step fields are rejected. Pack identity is `publisher/name` plus a semantic version. The manifest must name every skill used by its workflow. Workflow and Pack dependencies must be present and acyclic.

| Permission | Values |
|---|---|
| Filesystem | `read-only`, `workspace-write` |
| Network | `none`, `restricted` |
| External actions | `none`, `approval-required` |

Permissions describe the maximum expected boundary. They do not grant runtime authority or bypass operator approval.

## First-Party Alpha

| Pack | Outcome |
|---|---|
| `citadel/ci-recovery` | Diagnose a failing check, repair only its verified cause, rerun evidence, and hand off honestly. |
| `citadel/migration-campaign` | Execute a bounded migration with coverage, verification, and continuation state. |
| `citadel/release-steward` | Review, verify, serialize, and document a mainline landing and deployment. |

## Local Commands

```bash
node scripts/packs.js list
node scripts/packs.js inspect citadel/ci-recovery
node scripts/packs.js verify ci-recovery --runtime codex
node scripts/packs.js certify ci-recovery --runtime codex
node scripts/packs.js install ci-recovery --project ../target --runtime codex
node scripts/packs.js installed --project ../target
node scripts/packs.js uninstall citadel/ci-recovery --project ../target
node scripts/packs.js registry verify --registry registry.json --trust-roots ../private-pins/trust.json
node scripts/packs.js registry inspect --registry registry.json --trust-roots ../private-pins/trust.json
```

All commands operate on local files. This alpha performs no registry or package download.

## Digest and Installation

The content digest is SHA-256 over sorted relative paths, byte lengths, and exact file bytes. Installation copies only regular files into `.citadel/packs/{publisher}/{name}/{version}/`. The local index records identity, runtime, digest, and path. Copy results are rehashed before the index is written.

Path traversal and symlinked source or destination segments are rejected. Uninstall refuses to remove a modified Pack unless the operator supplies `--force`.

Before creating the destination directory, installation reconstructs the dependency graph from
the manifests already installed in the target project and adds the candidate Pack. Missing
dependencies, duplicate Pack identities, invalid installed manifests, and dependency cycles fail
before any candidate file is copied. The install index records each accepted Pack dependency list,
but installed manifests remain the graph source of truth.

## Certification Honesty

Certification records two independent facts:

- `checked` states whether a condition actually ran
- `status` is `passed`, `failed`, or `unknown`

Manifest, workflow, skill, runtime, and digest checks run locally. Declared verification commands are not executed by `certify`; without supplied execution evidence they remain `checked: false`, `status: unknown`, and the certification result is `unknown`. Missing evidence never becomes a green result.

Certification is an inspectable local receipt, not publisher identity or marketplace trust.

## Signed local registry

The local registry binds each Pack ID, version, and deterministic content digest to an Ed25519
publisher signature, then signs the complete sorted index with a registry key. Public keys and
ownership live in a separately selected trust manifest outside the registry directory. Registry
content cannot self-declare a trusted key or claim a Pack identity for a publisher.

Publisher, Pack, and exact-version revocations fail closed. Schemas reject unknown fields,
embedded key material, unsafe paths, duplicate identities, unsorted content, and malformed
signatures. Verification performs no network requests and does not install or download anything.

See [Pack governance](PACK_GOVERNANCE.md) for ownership, contributor review, rotation, revocation,
and the boundary between local signature trust and external adoption.

# Citadel Operations Protocol v0.1

Citadel Operations Protocol is the small, runtime-neutral contract layer for describing an
operation, the attempts made to execute it, the intent that authorized it, the evidence produced,
and the final receipt. Version `0.1` is a foundation contract. It does not provide storage,
transport, orchestration, or a hosted service.

The executable CommonJS implementation lives in `core/operations/`. External consumers should
import `require('@citadel/contracts').operations`. The matching JSON Schema is
`packages/contracts/schemas/operations-v0.1.json`.

## Contract types

| Contract | Purpose |
|---|---|
| `OperationSpec` | Stable identity, safe display label, objective digest, ordered step IDs, and policy digests. |
| `OperationRun` | One execution of a spec, its lifecycle state, accepted intents, and step-attempt references. |
| `StepAttempt` | One numbered attempt at one step, with evidence references and a bounded failure code. |
| `Intent` | A bounded action requested by an opaque actor over a digested scope. |
| `EvidenceEnvelope` | A content-free evidence reference with subject and artifact digests. |
| `ExecutionReceipt` | A terminal result bound to the operation, run, issuer, and evidence digests. |

Every object carries `protocol_version: "0.1"` and an exact `kind`. Validators reject missing or
additional fields. There are no open-ended metadata objects because they become accidental data
exfiltration and compatibility surfaces.

## Status honesty

`passed`, `failed`, `blocked`, and `unknown` are first-class terminal report states. Evidence and
receipts may use only those four values. Runs and attempts additionally use `pending` and
`running` while work is active.

A generated `passed` receipt requires passed evidence for every declared operation step. Each
evidence envelope must reference an attempt listed by the run, and its subject digest binds that
attempt to exactly one required step. Missing coverage, a wrong subject, or one attempt reused
across steps produces `unknown`. Duplicate evidence identities and attempts outside the run are
rejected.

Allowed state changes are:

```text
pending -> running | blocked | unknown
running -> passed | failed | blocked | unknown
blocked -> running | failed | unknown
passed | failed | unknown -> no different state
```

Repeating the current state is idempotent. A failed attempt is immutable; retrying creates a new
`StepAttempt` with a higher `attempt_number`. A blocked record may resume because the blocking
condition can be removed. `unknown` never silently becomes passed.

## Canonical serialization and identity

`canonicalSerialize(value)` recursively sorts object keys and preserves array order. It accepts
only plain JSON values, rejects cycles, `undefined`, non-finite numbers, and non-plain objects,
and emits JSON without whitespace. `sha256Digest(value)` returns `sha256:<64 lowercase hex>` over
that canonical UTF-8 representation.

Digests establish deterministic content identity. They are not signatures and do not establish
who created a record.

## Privacy boundary

The protocol carries opaque IDs, bounded enums, timestamps, safe display labels, and SHA-256
digests. Evidence envelopes never embed prompts, commands, source code, repository names, local
paths, URLs, usernames, tokens, or artifact contents. `redacted` records whether the referenced
artifact was redacted before its digest was taken.

`OperationSpec.title` is the only human-readable work label in v0.1. It must be a safe-to-share,
single-line label. The objective itself is represented only by `objective_digest`.

Strict allowlists reduce accidental disclosure; they do not make a sensitive title safe or make
a digest anonymous when an attacker can guess the input. Producers remain responsible for data
classification and access control around referenced artifacts.

## Compatibility and migration policy

- Readers reject unsupported `protocol_version` values by default.
- Unknown fields are rejected, even if a consumer believes it can ignore them.
- v0.x is pre-stable. Any field or semantic change requires a new protocol version and explicit
  migration code.
- `migrateOperationContract` never guesses. In v0.1 it performs a validated canonical clone only
  when source and target are both `0.1`; every other path fails closed.
- Producers must retain the original record and record which explicit migration produced a newer
  version once migrations exist.
- A future 1.0 may add an advertised compatibility window, but v0.1 makes no forward-compatibility
  claim.

## Non-goals for this phase

The protocol intentionally does not implement an append-only journal, pack format or registry,
dashboard views, CLI commands, policy compiler, synchronization service, signatures, or remote
transport. Those layers can depend on this contract after its semantics survive local use.

The JSON Schema declares the strict wire shape. Cross-field lifecycle rules, timestamp ordering,
proof requirements, and transition legality are enforced by the executable validators.

## Verification

```bash
node scripts/test-operations-protocol.js
node scripts/test-runtime-contracts.js
node scripts/test-backward-compat.js
```

## Adapter conformance

An adapter can prove that it emits all six contract kinds with the deterministic, local-only
conformance runner:

```bash
node scripts/operations-conformance.js fixtures.json --adapter adapter-name
```

The command fails unless every record validates and all required kinds are represented. Its report
contains only allowlisted contract fields, validation errors, counts, and digests. Passing v0.1
conformance is not a claim that the protocol is stable at 1.0. Version 1.0 remains gated on a
documented compatibility window, migration fixtures, and independent adapter evidence.

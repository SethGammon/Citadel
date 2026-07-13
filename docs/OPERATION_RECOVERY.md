# Operation recovery and execution receipts

Citadel operation recovery is built around an append-only, hash-chained journal. The journal
records only checkpoint metadata and digests. It does not store prompts, commands, source code,
tokens, repository names, or absolute paths.

This is a local execution foundation. It does not provide a scheduler, remote runner, hosted
service, or multi-user synchronization.

## Journal layout

One operation run uses one journal directory. Every committed checkpoint is an immutable,
zero-padded file:

```text
00000001.json
00000002.json
00000003.json
```

An append takes an exclusive journal lock, verifies the complete existing chain, writes the next
record to a same-directory temporary file, flushes it, and atomically renames it to the final
sequence name. Temporary files left by a process crash are ignored. Existing numbered files are
never rewritten by the journal API.

Each record contains an exact privacy allowlist:

- protocol version, record kind, sequence, and canonical timestamp
- opaque run, attempt, and idempotency IDs
- one effect class and one idempotency state
- payload and optional evidence SHA-256 digests
- previous-record hash and current-record hash

`readJournal()` recalculates every entry hash and verifies sequence continuity and the previous
hash link. Invalid JSON, a missing sequence, changed content, or a broken link raises
`JournalCorruptionError`. Recovery planning converts that condition to `blocked` with
`JOURNAL_CORRUPT`. It never attempts work from a damaged history.

## StepAttempt checkpoints

The runner writes a `pending` checkpoint before calling an effect and a `completed` checkpoint
only after it receives a valid evidence digest. An exception or missing evidence writes
`unknown`. These states mean:

| State | Meaning |
|---|---|
| `pending` | The boundary was entered. After a crash, the effect may or may not have happened. |
| `completed` | The effect returned and its evidence digest was durably journaled. |
| `unknown` | The effect outcome or its evidence could not be established. |

The runner exposes fault boundaries before and after the pending write, effect call, and completed
write. Chaos tests interrupt all six boundaries.

## Effect classes and recovery

| Effect class | Pending or unknown recovery | Rationale |
|---|---|---|
| `pure` | Retry | Repetition has no external side effect. |
| `workspace-reversible` | Retry | Workspace state can be verified and repaired locally. |
| `external-idempotent` | Retry | The same idempotency key makes repetition safe. |
| `external-nonrepeatable` | Block | Repetition could duplicate an irreversible external action. |

A completed idempotency key is always skipped. A pending or unknown
`external-nonrepeatable` effect is always blocked, including when a crash happened before the
effect actually began. That conservative false block is intentional. The journal cannot prove
that the effect did not occur, so Citadel does not guess.

## Execution receipts

`createExecutionReceipt()` binds a validated `OperationSpec`, `OperationRun`, and validated
evidence envelopes into the v0.1 canonical `ExecutionReceipt`. Evidence digests are deduplicated
and sorted, so equivalent input produces identical receipt bytes and IDs.

A run can receive a `passed` receipt only when it is passed and at least one supplied evidence
envelope is also passed. Missing, blocked, failed, or unknown evidence turns a claimed pass into
`unknown`. Failed and blocked runs retain those explicit states.

Receipt signatures use Ed25519 through Node's built-in `crypto` module. A signed envelope includes
the receipt digest, signer key ID, public SPKI bytes, and signature. Verification returns exactly
one trust status:

| Verification | Meaning |
|---|---|
| `verified` | Signature and digest are valid and the supplied trusted public key matches. |
| `invalid` | Shape, digest, key, signer, or signature validation failed. |
| `unsigned` | The receipt is structurally valid but has no signature. |
| `unknown` | The embedded signature is valid, but no trusted public key was supplied. |

An embedded key proves only self-consistency. It does not establish trusted identity. Production
verification should always supply a separately acquired public key.

## Offline verification

The verifier reads local files and performs no network operation:

```bash
node scripts/receipt.js verify \
  --input ./receipt.json \
  --public-key ./trusted-public.pem
```

Exit status is `0` only for `verified`, `1` for invalid input or signature, `2` for unsigned, and
`3` for unknown trust. The JSON result never echoes input paths or receipt contents.

Journal verification and recovery planning are also local:

```bash
node scripts/operation-runner.js verify --journal-dir ./.planning/operations/run-id/journal
node scripts/operation-runner.js plan --journal-dir ./.planning/operations/run-id/journal
```

## Security boundary

- Digests provide integrity identity, not secrecy. Guessable inputs can be tested against a digest.
- A valid signature proves control of a private key, not authorization to perform the operation.
- Trusted signer distribution, revocation, and organization policy are intentionally outside this
  local slice.
- The journal directory must remain private project state. Its opaque IDs and timing can still
  reveal operational patterns.
- Absolute paths are accepted only as local CLI arguments. They are never written into journal or
  receipt records.

## Verification

```bash
node scripts/test-operation-recovery.js
node scripts/test-operation-receipts.js
node scripts/test-operation-chaos.js
node scripts/test-operations-protocol.js
```

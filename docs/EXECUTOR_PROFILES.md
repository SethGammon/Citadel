# Executor Profiles

Status: frozen acceptance contract for Operation Fork schema 2

Executor profiles let one Operation Fork compare multiple model and provider
configurations, including multiple profiles on the same runtime. They are a
closed configuration format, not a general command runner.

## Security boundary

Citadel owns every executable, argument position, permission mode, sandbox
setting, and process option. A profile may select only the fields and values in
this document. It cannot provide an executable, arguments, environment
variables, shell fragments, paths, hooks, or verifier commands.

Every executor process is spawned with `shell: false`. Values are passed as
literal argument array elements. Unknown fields and unknown option keys are
errors.

## Executor file schema 1

An executor file has exactly two fields:

```json
{
  "schema_version": 1,
  "executors": [
    {
      "profile_id": "claude-sonnet",
      "runtime": "claude",
      "model": "claude-sonnet-4-5",
      "local_provider": null,
      "adapter_options": {
        "permission_mode": "dontAsk",
        "effort": "high"
      }
    },
    {
      "profile_id": "codex-local-qwen",
      "runtime": "codex",
      "model": "qwen3-coder:30b",
      "local_provider": "ollama",
      "adapter_options": {
        "sandbox": "workspace-write"
      }
    }
  ]
}
```

Each executor has exactly these fields:

| Field | Contract |
|---|---|
| `profile_id` | Unique lowercase ID matching `^[a-z][a-z0-9-]{0,47}$` |
| `runtime` | `claude` or `codex` |
| `model` | `null` or a public-safe ID matching `^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$` |
| `local_provider` | `null`, `ollama`, or `lmstudio` |
| `adapter_options` | Exact runtime-specific object described below |

The file must contain at least two profiles. Profile IDs must be unique.
Runtimes do not need to be unique. Profiles are canonicalized by `profile_id`,
so file ordering does not change an executor set digest or branch order.

`ollama` and `lmstudio` are allowed only with the Codex runtime. A local
provider requires an explicit non-null model. Claude local-provider profiles
and unrecognized providers are rejected.

### Runtime-specific options

Claude accepts only:

| Option | Contract |
|---|---|
| `permission_mode` | Optional `acceptEdits`, `auto`, `manual`, `dontAsk`, or `plan`; defaults to `acceptEdits` |
| `effort` | Optional `low`, `medium`, `high`, `xhigh`, or `max` |

Claude advertises `bypassPermissions`, but Citadel rejects it because it
weakens the executor safety boundary.

Codex accepts only:

| Option | Contract |
|---|---|
| `sandbox` | Optional `read-only` or `workspace-write`; defaults to `workspace-write` |

Codex advertises `danger-full-access`, but Citadel rejects it because Operation
Fork executors must remain contained.

An empty options object is valid. Options for the other runtime, unknown keys,
and invalid values are rejected.

## Canonical invocation

Argument order is part of the contract. Omitted profile values do not create
arguments.

Claude begins with the configured permission mode, or `acceptEdits` by default:

```text
claude --print --output-format json --permission-mode acceptEdits
```

Citadel also supplies a fixed `--allowedTools` policy that permits repository
reads, edits, Node/npm verification, and read-only git inspection while denying
branch, commit, reset, clean, and worktree mutation. Citadel then appends `--model <model>` when a model is present and
`--effort <effort>` when configured.

Codex begins with:

```text
codex exec --json --sandbox workspace-write --ignore-user-config
```

The sandbox argument is `read-only` when requested and `workspace-write`
otherwise. `--ignore-user-config` prevents unrelated user-level model, plugin,
MCP, and profile settings from changing the declared executor contract while
authentication still comes from the installed Codex credential store. For a local provider, Citadel appends
`--oss --local-provider <provider>`. It then appends `--model <model>` when
present and the final stdin marker `-`.

No profile field may select `bypassPermissions`, `danger-full-access`, weaken
Citadel's worktree containment or verifier, or change `shell: false`.

## CLI selection

The new form is:

```text
citadel fork start "objective" --executors path/to/executors.json
```

`--executors` and `--runtimes` are mutually exclusive. Supplying both is an
error before any planning state or worktree is created.

The legacy `--runtimes claude,codex` form remains supported. It synthesizes
canonical profiles with `profile_id` equal to the runtime and null model and
provider values. Those profiles retain the existing `branch-claude` and
`branch-codex` IDs. Legacy behavior is compatibility input, not a second
executor schema.
Legacy Codex runs retain the user's configured default model because legacy
runtime input does not declare a model. New executor profiles isolate user
configuration and therefore require an explicit model when reproducibility is
required.

## Digests and Operation Fork schema 2

The executor profile digest is the SHA-256 digest of the canonical five-field
profile. The executor set digest is the SHA-256 digest of the canonical list of
profile digests sorted by `profile_id`. Changing the model, provider, or any
allowed adapter option changes the profile digest and the set digest. Reordering
the file does not.

New executor-profile forks use fork schema 2. Schema 2 adds
`executor_set_digest` to the fork and `executor_profile_digest` to every branch.
Its shared contract also binds `signer_public_key_digest` and `issuer_id`.
Branch IDs are `branch-<profile_id>`. A branch must match both the shared
operation contract digest and its executor profile digest.

Schema 1 fork records remain readable. Reading, comparing, displaying, or
replaying schema 1 must not rewrite them as schema 2. Any future migration must
be explicit, separately verified, and atomic.

## Fork receipt wrapper

The existing signed execution receipt remains the evidence payload. Schema 2
adds a signed, fork-specific wrapper with exactly these signed receipt fields:

```text
schema_version
kind
fork_id
branch_id
contract_digest
executor_profile_digest
execution_receipt_digest
observation_digest
issued_at
issuer_id
```

`kind` is `operation_fork_execution_receipt` and `schema_version` is `1`.
The signed envelope contains the receipt, its digest, `ed25519` algorithm, and
the signature. Verification fails if any fork ID, branch ID, contract digest,
profile digest, execution receipt digest, timestamp, issuer, digest, or
signature is changed.

Stored wrappers are untrusted input. `compare`, `select`, `land`, and Mission
Control must reload the contract-bound public key, independently verify the
underlying execution receipt, verify the wrapper, and match every binding. The
signed observation digest binds parsed model and usage telemetry. A stored
`receipt_verified: true` or `trusted: true` flag is never sufficient by itself.

Before verification, Citadel rechecks the parent and every assigned worktree.
Their registered paths, branch refs, and HEAD revisions must match the pre-run
snapshot. A checkout, commit, removal, or move fails closed with
`WORKTREE_CONTAINMENT_VIOLATION` and the verifier does not run.

## Model proof and Mission Control

Mission Control presents three distinct facts:

| Fact | Meaning |
|---|---|
| Requested | Model and provider from the signed executor profile |
| Observed | Model identity reported by trusted adapter telemetry |
| Proof status | `passed`, `failed`, or `unknown` |

An explicit model, including every local-provider model, requires trusted
observed-model evidence that exactly matches the request before the model proof
can pass. A mismatch is `failed`. Missing, untrusted, or unparsable telemetry is
`unknown`, never passed. A legacy null-model profile reports requested model as
`default` and model proof as `unknown` unless the adapter produces trusted
observed identity.

Missing cost, duration, token, or model telemetry also remains `unknown`.
Mission Control must not infer observations from requested values or convert
missing data to zero.

## Public replay

Public replay may include profile ID, runtime, provider, requested model,
observed model, proof status, and binding digests. It must exclude signatures,
private receipt material, raw adapter output, environment data, command paths,
and arbitrary process arguments. Model IDs use the public-safe grammar above.
Replay output is deterministic and redacted.

## Acceptance boundary

`scripts/test-executor-profiles.js` is the executable acceptance contract. It
covers strict fields, duplicate IDs, same-runtime profiles, provider rules,
canonical digests, legacy compatibility, exact literal invocation, schema 2
bindings, receipt tamper rejection, model proof, Mission Control honesty, and
public replay redaction. Until production support exists, the test must parse
successfully and stop with `EXECUTOR_PROFILES_NOT_IMPLEMENTED`.

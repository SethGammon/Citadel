# Continue an interrupted operation delivery

Operation Control can save a verified result before delivering its report. This
supports interrupted report delivery without paying for another worker attempt.
It uses the existing operation effect journal; no daemon or separate service is
required. The command is available in the source checkout and full plugin.

Start with a new checkpoint directory whose parent already exists:

```sh
node bin/citadel.js operation run --request ../request.json --catalog ../catalog.json --workspace . --checkpoint ../checkpoint --out ../report.json
```

If report delivery is interrupted, use the same request, catalog, workspace and
optional `--history` input:

```sh
node bin/citadel.js operation continue --request ../request.json --catalog ../catalog.json --workspace . --checkpoint ../checkpoint --out ../report.json
```

Both commands accept `--history-out FILE` and `--json`. Keep checkpoint and report
exports outside the Git workspace, and exports outside the checkpoint. A
checkpoint directory is exclusively claimed once. Reusing it with `run` fails.
The workspace must be the repository root with a committed HEAD.

Continuation checks the original request, catalog, history, workspace identity,
HEAD, journal chain, accepted report digest, and the bytes of tracked and
nonignored untracked files. Explicitly required artifacts are checked even when
ignored. File additions, removals, edits and symbolic links fail closed. Ignored
files not declared as required artifacts, external files and services are outside this
snapshot. Keep acceptance-critical inputs and artifacts tracked or explicitly
declared. Digests detect drift; they do not authenticate an adversarial local
writer who can rewrite the entire checkpoint.

Without a reconciliation manifest, successful continuation returns the original verified report and original
costs. It does not launch an adapter, rerun the verifier, publish, merge, or
replay a model session. Repeated continuation is safe while the bindings remain
unchanged. An interruption before the completed journal entry, a failed run or
an uncertain outcome blocks continuation. Inspect that run and its effects;
there is deliberately no force/retry flag. If a new attempt is appropriate,
explicitly start a new operation with a new checkpoint and budget.

The checkpoint may contain private report text and workspace file names. Keep it
local with the same access protections as the original operation inputs.

## Reconcile a declared local file effect

For a deterministic tool operation, `--reconcile FILE` can establish completion
after its file effect succeeded but before the worker returned or checkpointed.
Declare the exact expected bytes before starting, using their SHA-256 hashes:

```json
{
  "schema": 1,
  "kind": "workspace-postconditions",
  "files": [{"path": "receipts.jsonl", "sha256": "<64 lowercase hex characters>"}]
}
```

Pass the same `--reconcile ../postconditions.json` to both `operation run` and
`operation continue`, along with the existing arguments. The files must exactly
match the request's `required_changed_paths`. Include a stable operation identity
in the expected file contents. A postcondition already satisfied before the run
is rejected. Append operations declare the hash of the entire resulting file,
so an extra, partial or different record cannot pass.

This mode currently requires tool plans with no model, retries or fallback, and
a trusted read-only Node verifier whose entry file is in the workspace outside
the effect paths. All acceptance-critical inputs belong in that workspace.
Remote APIs, model-session recovery, external verifier dependencies and undeclared
effects are outside this contract. Stop the entire owned operation process tree
before continuing. A live original owner blocks recovery; a missing PID is not
treated as evidence that the effect completed. This command does not discover
or terminate orphaned adapter descendants.

Before launching the adapter, Citadel binds the manifest, workspace baseline and
owner to the pending journal entry. After interruption, continuation checks the
expected file hashes and unchanged remaining workspace, executes the independent
verifier, and checks the files again before saving a completed checkpoint. It
does not rerun the adapter. A lock prevents concurrent reconciliation; an
interrupted reconciliation or an existing uncommitted accepted record remains
blocked for inspection rather than being guessed safe.

Successful reconciliation returns `citadel_operation_recovery_report`, with
unknown original execution/costs and no fabricated attempt history. `operation
verify` checks this receipt's integrity. `--history-out` produces no training
records for a recovered execution. Subsequent continuation returns the saved
report without rerunning the verifier. Missing, partial, duplicate, different or
ambiguous effects continue to block. This is verified recovery for the declared
local-file contract, not a universal exactly-once guarantee.

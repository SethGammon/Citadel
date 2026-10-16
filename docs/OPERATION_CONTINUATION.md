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

A successful continuation returns the original verified report and original
costs. It does not launch an adapter, rerun the verifier, publish, merge, or
replay a model session. Repeated continuation is safe while the bindings remain
unchanged. An interruption before the completed journal entry, a failed run or
an uncertain outcome blocks continuation. Inspect that run and its effects;
there is deliberately no force/retry flag. If a new attempt is appropriate,
explicitly start a new operation with a new checkpoint and budget.

The checkpoint may contain private report text and workspace file names. Keep it
local with the same access protections as the original operation inputs.

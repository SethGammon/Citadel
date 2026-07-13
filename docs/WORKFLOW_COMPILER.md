# Deterministic workflow compiler

Citadel compiles one Operations Protocol v0.1 workflow into runtime-specific files without changing the operation's meaning. The initial `verify-change` workflow targets:

- Local argv execution
- Codex interactive argv execution
- GitHub Actions

```sh
node scripts/compile-workflow.js \
  --input workflows/verify-change.citadel.json \
  --target codex \
  --output .codex/workflows/verify-change.json
```

Omit `--output` to print the deterministic artifact. Add `--json` for a machine-readable compilation summary.

## Shared contract

Every output preserves the same protocol version, operation identity and digest, workflow digest, ordered step IDs, step-command digest, verifier, four evidence states, failure mapping, cancellation mapping, and receipt path.

Targets do not report their own coverage. After generation, the compiler reparses the artifact,
derives step order and the argv digest from its executable representation, and verifies explicit
evidence, outcome, and receipt mappings. A single missing or changed semantic check rejects the
artifact. GitHub Actions artifacts also contain an executable semantic guard that fails the job
unless passed, failed, blocked, unknown, cancellation, missing evidence, and receipt requirements
retain their declared meaning.

Targets can change representation, but not prompts or workflow semantics. Commands remain argv
arrays in the canonical source. GitHub Actions stores each argv array as base64-encoded canonical
JSON and invokes it through Node `spawnSync` with `shell: false`. User values never become shell
source. Workflow and step display names are generated from safe identifiers, and YAML scalars are
quoted mechanically. There is no target-specific prompt or GitHub expression interpolation.

## Failure boundaries

- Invalid or additional workflow fields fail closed.
- Step order must exactly match the Operations Protocol `OperationSpec`.
- Missing verifier evidence remains `unknown`.
- Failure maps to `failed`; cancellation maps to `unknown`.
- Receipt paths must remain under `.planning/receipts/`.
- Receipt paths and operation IDs must be safe generated-artifact paths.
- Unsupported target capabilities fail compilation instead of degrading silently.
- The GitHub target grants only `contents: read`.
- Generated GitHub artifacts reject `${{ ... }}` expressions and never interpolate user argv.

## Verification

```sh
node scripts/test-workflow-compiler.js
```

The test compares every target against checked-in golden output and verifies determinism, target
parity, artifact-derived semantics, explicit evidence and receipt mappings, capability failure,
strict validation, malicious argv isolation, YAML hardening, and tamper rejection.

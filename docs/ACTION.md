# Citadel verification Action

The root GitHub Action runs a checked-in Citadel verification workflow and writes an unsigned Operations Protocol receipt plus a readable summary.

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
  - uses: SethGammon/Citadel@<full-commit-sha>
    id: citadel
    with:
      workflow: verify-change
      evidence-path: .planning/action-evidence
      strict: "true"
      working-directory: "."
```

## Contract

Inputs are bounded and never interpolated into a shell command:

- `workflow` is a checked-in identifier such as `verify-change`.
- `evidence-path` and `working-directory` must be relative and remain inside the workspace.
- `strict` accepts only `true` or `false`.

Outputs are `status`, `receipt-path`, and `summary-path`. Status is always one of `passed`, `failed`, `blocked`, or `unknown`. With strict mode, anything except `passed` fails the Action after evidence is written. Missing or indeterminate evidence never becomes a pass.

The Action requires only `contents: read`. Consumers choose whether to upload the generated evidence. The Action itself does not push, comment, publish, deploy, or transmit the receipt.

When `GITHUB_STEP_SUMMARY` is available, Citadel appends the same status table written to the summary artifact.

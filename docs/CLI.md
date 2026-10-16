# Citadel release CLI

For normal Claude Code or Codex installation, use the native marketplace pinned
to an explicit released version, as shown in the [README](../README.md#install).
This guide covers the smaller package CLI in the verified archive attached to a
[GitHub Release](https://github.com/SethGammon/Citadel/releases), an alternative
for manual or offline installation.

The root npm package is private because the unscoped `citadel` namespace is not
owned by this project. Do not use `npm install citadel`, `npx citadel`, or a
registry tarball as a Citadel installation source.

The stable archive intentionally exposes a small package CLI:

```text
install
doctor
update
rollback
uninstall
```

Use `node "$CITADEL_ROOT/bin/citadel.js" --help` from the extracted release as
the authority for that archive. Full tagged plugin source and development
checkouts contain optional APIs that are deliberately absent from this CLI.

## Governed adoption

Initial adoption uses the release's plan-first lifecycle script. Run it from
the target project and save the plan outside that target so creating the plan
cannot invalidate its own preflight and trigger `TARGET_DRIFT`:

```sh
node "$CITADEL_ROOT/scripts/adopt.js" plan "$CITADEL_ROOT" --target . \
  --project-runtime codex --out ../citadel-adoption.plan.json --json
node "$CITADEL_ROOT/scripts/adopt.js" apply ../citadel-adoption.plan.json \
  --confirm TOKEN --json
node "$CITADEL_ROOT/scripts/adopt.js" doctor --target . --json
```

Use `--project-runtime claude` for Claude Code or `both` only when both
projections are intentional. The extracted source, target, plan digest, and
confirmation token are rechecked at apply.

## Install and doctor

`install` is the runtime registration compatibility adapter. It is not the
authority for footprint ownership, update, rollback, or removal.

```sh
node "$CITADEL_ROOT/bin/citadel.js" install --runtime codex --dry-run --json
node "$CITADEL_ROOT/bin/citadel.js" install --runtime claude --project-root /path/to/project
node "$CITADEL_ROOT/bin/citadel.js" doctor --json
```

`install` selects a runtime from `--runtime claude|codex`, then
`CITADEL_RUNTIME`, then an unambiguous project marker or installed runtime. If
both runtimes are available, it stops and requires `--runtime`.

## Agent model configuration

Codex agent models and reasoning effort are governed project settings. Preview
the change first, add `--apply` when it is correct, then refresh the managed
agent projection:

```sh
node "$CITADEL_ROOT/scripts/citadel-config.js" configure-codex-agents \
  --agent-model arbiter=gpt-5.6-sol \
  --agent-effort arbiter=ultra
node "$CITADEL_ROOT/scripts/citadel-config.js" configure-codex-agents \
  --agent-model arbiter=gpt-5.6-sol \
  --agent-effort arbiter=ultra --apply
node "$CITADEL_ROOT/scripts/generate-agent-projections.js" --project-root .
```

Use `--model-alias FAMILY=MODEL` for a model family, `--default-model MODEL`
for roles without a family, and `--default-effort LEVEL` for the project
default. Codex levels are `low`, `medium`, `high`, `xhigh`, `max`, and
`ultra`; the chosen model must support the chosen level. Claude executor
profiles support through `max`, not `ultra`.

## Update and rollback

Download and verify the next release trio before using its extracted directory
as `CITADEL_NEXT_ROOT`. Plans remain outside the target repository.

```sh
node "$CITADEL_ROOT/bin/citadel.js" update plan "$CITADEL_NEXT_ROOT" \
  --migration migration.json --target . \
  --out ../citadel-update.plan.json --json
node "$CITADEL_ROOT/bin/citadel.js" update apply ../citadel-update.plan.json \
  --confirm TOKEN --json

node "$CITADEL_ROOT/bin/citadel.js" rollback plan --target . \
  --out ../citadel-rollback.plan.json --json
node "$CITADEL_ROOT/bin/citadel.js" rollback apply ../citadel-rollback.plan.json \
  --confirm TOKEN --json
```

`update` and `rollback` accept only `plan|apply`. They recheck receipt ownership,
source and target identity, pre-images, migration compatibility, and the plan
digest before mutation.

## Uninstall

The no-write package command inventories the current removal boundary:

```sh
node "$CITADEL_ROOT/bin/citadel.js" uninstall /path/to/project --dry-run --json
```

Create the saved receipt-owned leave plan outside the target, then apply it
through the supported package command:

```sh
node "$CITADEL_ROOT/scripts/adopt.js" leave plan --target . \
  --out ../citadel-leave.plan.json --json
node "$CITADEL_ROOT/bin/citadel.js" uninstall --apply \
  --plan ../citadel-leave.plan.json --confirm TOKEN --json
```

Unknown ownership never becomes successful removal. Modified or ambiguous
entries remain visible conflicts. Legacy installs must first use the lifecycle
script's `import plan` path and cannot claim exact removal until a receipt-owned
inventory exists.

For Windows quoting, release verification, and runtime enable steps, use
[Installation](../INSTALL.md). For archive and provenance rules, use
[Releases](RELEASES.md).

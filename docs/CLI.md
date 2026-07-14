# Citadel package CLI

Citadel can be invoked from a local checkout today and is structured for a conventional package-registry install once the package is published:

```sh
npx citadel@latest install
```

Until registry publication is verified, run the same entrypoint from a checkout:

```sh
node bin/citadel.js install
```

## Install

`citadel install` selects a runtime in this order:

1. `--runtime claude|codex`
2. `CITADEL_RUNTIME`
3. A single `.claude/` or `.codex/` project marker
4. A single available `claude` or `codex` command

If both runtimes are available, Citadel stops and asks for `--runtime`. It does not choose silently.

```sh
citadel install --runtime codex --dry-run --json
citadel install --runtime claude --project-root /path/to/project
```

Arguments are passed to the existing runtime installer as an argv array. The CLI does not interpolate a shell command.

## Maintenance

```sh
citadel doctor --json
citadel update --archive citadel-v1.2.0.tar.gz --target /path/to/Citadel
citadel update --archive citadel-v1.2.0.tar.gz --target /path/to/Citadel --apply
citadel rollback /path/to/.citadel-backups/backup --target /path/to/Citadel --apply
citadel uninstall /path/to/project --dry-run --json
```

Updates remain plan-only until `--apply` is supplied. Uninstall exports durable project state before removing the harness. Use `--export-only` to keep the harness in place.

## Operation Fork

Run one objective through Claude Code and Codex from the same commit:

```sh
citadel fork start "Find and eliminate the authentication race"
citadel fork status fork-find-and-eliminate-the-authentication-race
citadel fork compare fork-find-and-eliminate-the-authentication-race
```

The default workflow verifies `git diff --check`. Supply `--workflow FILE` to declare
project-specific steps and a verifier as `{ "command": "npm", "args": ["test"] }`.
Commands are always executed as literal argument arrays with `shell: false`.

```sh
citadel fork select ID --branch branch-claude --expected-revision 6 \
  --idempotency-key choose-claude-001
citadel fork land plan ID
citadel fork land apply ID --expected-revision 7 --target-revision SHA \
  --confirm TOKEN --idempotency-key land-claude-001
citadel fork replay ID --output replay.json
```

Selection never lands code. `land plan` returns the current target revision, clean-state
result, and one exact token. `land apply` rechecks all three before a local merge. It never
pushes, publishes, tags, deploys, or bypasses branch protection. An ambiguous merge effect
blocks recovery and is not repeated.

## Packs and receipts

`citadel pack` manages the local certified Pack index and lifecycle. `citadel journey` starts or completes a Pack as an Operations Protocol run, and `citadel receipt verify` checks its execution receipt offline. Missing evidence remains `unknown`.

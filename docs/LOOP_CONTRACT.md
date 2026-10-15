# Citadel Loop Contract

Citadel treats a loop as a bounded operating contract, not as "keep prompting
until something happens." A loop can be manual, scheduled, Codex-native,
daemon-backed, PR-driven, or foreground-only, but it should always expose the
same reviewable parts.

## Contract Fields

Every loop record should declare:

| Field | Purpose |
|---|---|
| `id` | Stable loop identifier. |
| `type` | Workflow family, such as `foreground-loop`, `daemon`, `pr-watch`, or `schedule`. |
| `trigger` | What starts the loop: manual command, schedule, daemon tick, Codex automation, file watch, or PR check. |
| `input` | Goal or queue the loop consumes. |
| `scope` | Files, repo area, PR, issue queue, or project boundary the loop may touch. |
| `permissions` | Filesystem, network, and approval assumptions. |
| `budget` | Attempt count, spend ceiling, or per-run cost model. |
| `verifier` | Command, verification profile, or external status that decides whether work is done. |
| `retry` | Maximum attempts and optional backoff. |
| `stopConditions` | Shared terminal states that end or pause the loop. |
| `statePath` | Durable state record under `.planning/loops/` or a legacy state file. |
| `reviewArtifact` | Report, PR, package, or evidence file a human can inspect. |
| `recovery` | How to continue or roll back if the loop stops midstream. |

## Shared Stop States

All loop-like workflows should use the same stop vocabulary:

| Status | Meaning |
|---|---|
| `done` | Work completed by the loop's declared standard. |
| `verifier-passed` | The verifier passed and the loop stopped successfully. |
| `verifier-failed` | The verifier failed and no autonomous repair should continue. |
| `blocked` | The loop cannot make safe progress without new information. |
| `budget-exhausted` | The spend, time, session, or attempt budget was reached. |
| `attempt-limit` | The retry ceiling was reached. |
| `needs-human-review` | A human decision is required before more work. |
| `unsafe-to-continue` | The loop stopped before taking a risky action. |
| `no-active-work` | There is no campaign, PR, queue item, or task left to process. |
| `stopped` | The user or operator explicitly stopped the loop. |

## Registry

First-class loop records live in:

```text
.planning/loops/{loop-id}.json
```

`node scripts/loops.js list` also reads legacy loop state such as:

- `.planning/daemon.json`
- `.planning/codex-automations/*.json`

This keeps older workflows visible while new workflows adopt the common
contract.

## Built-In Templates

Citadel ships these loop templates through `core/loops/templates.js`:

| Template | Use |
|---|---|
| `pr-review-repair` | Monitor a PR, read review/CI feedback, and apply bounded targeted fixes. |
| `issue-triage` | Periodically classify new issues and write a reviewable summary. |
| `dependency-refresh` | Check dependency drift and verify safe updates. |
| `docs-drift-check` | Detect public docs or command drift. |
| `nightly-health` | Run routine project health checks and summarize blockers. |
| `visual-qa` | Exercise UI routes and capture inspectable evidence. |
| `security-scan` | Run bounded security checks and stop for human review. |
| `demo-proof-refresh` | Refresh operating-loop proof artifacts. |

Preview templates with:

```bash
node scripts/loops.js templates
```

Create a plan from a template with:

```bash
node scripts/loops.js plan --template docs-drift-check --write
```

## Foreground Loops

Use `/loop` or `node scripts/loop-runner.js` for bounded repetition inside the
current session:

```bash
node scripts/loop-runner.js --action "npm run lint -- --fix" --verify "npm run lint" --max-attempts 3 --write
```

The verifier controls success. If the verifier passes, the loop stops with
`verifier-passed`. If attempts run out, it stops with `attempt-limit`.

## Interruption inspection and limited verification follow-up

Inspect a source loop before deciding what to do:

```bash
node scripts/loops.js inspect <id>
node scripts/loops.js inspect <id> --json
```

Both forms include a derived recovery summary: source revision, stop reason,
last run/phase, command observations, remaining attempts/deadline, cleanup
diagnostics, and a closed recovery decision. Inspection does not write state or
execute commands. An interrupted or pending command can have performed effects
without saving its result. A successful child verifier never resolves that
unknown history. `recovery.continueCommand` is metadata, not an instruction to
execute; `/do continue` does not run loop recovery.

Most interrupted records remain **inspection-only**. The supported executable
case is deliberately small: a terminal `interrupted` source with stop reason
`interrupted`, one completed receipt positively recording that its first command
was never spawned, an exact verifier, remaining attempts/time, and no unmeasured
spend budget. Older records, any previously started command, incomplete receipts,
active/pending loops, explicit stops, review holds, and exhausted budgets cannot
use this command. The existing supervisor records `command-not-started` when
cancelled before its first admission. Null cleanup errors and successful owned
process-tree termination do **not** establish that escaped/detached descendants
are absent. The first slice has no ownership lease, containment job, or operator
quiescence acknowledgement, so it does not admit unknown actions for rechecking.

For an eligible record, preview the exact inherited verifier and one-check budget:

```bash
node scripts/loops.js recover <id> --verify-only --expected-revision <n>
```

The preview performs no state writes or command execution. Add `--write` only
when deliberately authorizing **one invocation of that exact shell command**:

```bash
node scripts/loops.js recover <id> --verify-only --expected-revision <n> --write
```

“Verifier” and `--verify-only` do not imply read-only effects. The command can
write files or have external effects; review its exact contents before invoking
it. No action/verifier substitutions, attempt/budget overrides, duplicate flags,
or unknown flags are accepted. `--json` and `--project-root` are supported.

This creates a separate action-free child linked to source id/revision/run and
the verifier's SHA-256 digest. Its attempt limit is one; its timeout is bounded
by the source command timeout and remaining duration. A failed check stops with
evidence; a pass reports the child's observation only. Source status, receipts,
stop reason, budgets, and bytes remain unchanged.

Admission checks the expected revision under the source's existing registry
lock. A deterministic child id prevents two callers from admitting independent
checks for the same source revision. The child is durable before execution, and
a durable single-use execution claim prevents concurrent supervisor re-entry.
The supervisor checks the source again before dispatch and during cancellation
polling. Locks are released before running shell commands; a change after
admission interrupts observation and does not retroactively undo command effects.
This is not a cross-file transaction or an exactly-once-effects guarantee.
After a source revision changes, a new explicit invocation may authorize one
new child for that revision. It has its own one-check budget; this does not
decrement or replenish the source's attempt budget and is not automatic retry.

If the process crashes after child creation or claiming, retrying `recover`
refuses the existing child. Inspect it; never delete its state or steal a lock
to retry. Pending receipts remain unknown, and no original action is replayed.
A child stopped or timed out uses the existing supervisor's cancellation and
cleanup diagnostics. An expired source cannot acquire a fresh recovery budget.

The source CLI and NPM `loops` script support this journey. Project delegates
require an installed package containing `scripts/loops.js`. The current slim
release allowlist omits that script, so the slim artifact does not provide this
command. Core loop files alone do not ship the CLI.

## Design Rule

Do not add a new autonomous or repeated workflow without either:

1. Writing a loop contract record, or
2. Explaining why it is not a loop.

The goal is simple: every repeated agent workflow should be inspectable,
bounded, reversible, and easy to stop.

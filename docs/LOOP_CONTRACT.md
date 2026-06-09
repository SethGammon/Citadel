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

## Design Rule

Do not add a new autonomous or repeated workflow without either:

1. Writing a loop contract record, or
2. Explaining why it is not a loop.

The goal is simple: every repeated agent workflow should be inspectable,
bounded, reversible, and easy to stop.

---
name: loop
description: >-
  Bounded foreground repetition for the current session. Creates a loop
  contract, runs or coordinates an action plus verifier up to a declared attempt
  limit, and records evidence under .planning/loops/. Use for repeat-until-pass
  work that is too small for daemon and not time-based scheduling.
user-invocable: true
auto-trigger: false
last-updated: 2026-06-09
---

# /loop -- Bounded Foreground Loop

## Orientation

**Use when:** the user wants a visible repeat-until-pass cycle inside the
current session, such as "loop until lint passes" or "try this up to three
times and stop if tests still fail."

**Don't use when:** the work should run unattended across sessions (`/daemon`),
on a clock (`/schedule`), on file changes (`/watch`), or as a metric-driven
optimization experiment (`/experiment`).

## Commands

| Command | Behavior |
|---|---|
| `/loop status` | Show all known Citadel loops with active/stopped grouping. |
| `/loop inspect {id}` | Show one loop's contract, verifier, budget, runs, and stop reason. |
| `/loop templates` | List built-in loop templates. |
| `/loop plan --template {name}` | Create a loop contract from a template. |
| `/loop run "{action}" --verify "{command}" --max {N}` | Run a bounded foreground loop. |
| `/loop stop {id}` | Mark a loop stopped. |

## Protocol

### Step 1: Classify the loop

Determine which kind of loop the user requested:

| User intent | Route |
|---|---|
| Repeat within this active session | `/loop` |
| Continue campaign across sessions | `/daemon` |
| Run on a schedule | `/schedule` |
| Watch PR checks/reviews | `/pr-watch` |
| Watch files or marker comments | `/watch` |
| Optimize a numeric metric | `/experiment` |

If another route is clearly better, say so and route there.

### Step 2: Require a verifier

A `/loop run` must have an explicit verifier. If the user did not provide one,
ask for the verifier before executing. Accept examples like:

```text
--verify "npm run lint"
--verify "npm run test"
--verify "node scripts/operating-proof.js --write"
```

Do not run an open-ended loop without a verifier.

### Step 3: Create the contract

For status, inspect, templates, and stop commands, run:

```bash
node scripts/loops.js <command>
```

For template planning:

```bash
node scripts/loops.js plan --template <name> --write
```

For foreground execution:

```bash
node scripts/loop-runner.js --action "<action>" --verify "<verifier>" --max-attempts <N> --write
```

The runner writes a contract under `.planning/loops/{id}.json`, appends each
attempt, and stops with a shared stop status.

### Step 4: Stop on the first terminal condition

Stop when any of these are true:

- verifier passes
- attempt limit is reached
- the action fails in a way that needs human review
- the requested action would cross a safety or approval boundary
- the user asks to stop

Never silently continue beyond the declared attempt limit.

### Step 5: Report the outcome

Summarize:

- loop id
- status
- attempts used
- verifier
- state path
- next action if stopped before success

## Fringe Cases

**If `.planning/` does not exist:** create `.planning/loops/` before writing
loop state. If writing fails, output the contract inline and tell the user
setup is needed.

**No verifier:** ask for one. Do not infer a destructive or expensive verifier.

**Action is an agent command, not a shell command:** run the action manually as
the agent for each attempt, then record the loop with `node scripts/loops.js
register` or use the loop contract as the state artifact. Do not pass slash
commands to the shell runner.

**Verifier keeps failing with the same cause:** stop at the attempt limit and
report `attempt-limit` with the latest evidence.

**User asks for unattended looping:** route to `/daemon` or `/schedule`, not
`/loop`.

## Contextual Gates

**Disclosure:** "Running foreground loop: action `{action}`, verifier
`{verifier}`, max attempts `{N}`."

**Reversibility:** amber -- the loop may run user-provided shell commands and
modify files; inspect the diff or loop-owned artifacts to revert.

**Trust gates:**
- Any: require verifier and attempt cap.
- Familiar: may execute shell action/verifier after disclosing the contract.
- Risky commands: require normal tool approval boundaries before running.

## Quality Gates

- A loop contract exists under `.planning/loops/` unless the filesystem blocks it.
- The verifier is explicit.
- The attempt limit is explicit and >= 1.
- The final status uses the shared loop vocabulary from `docs/LOOP_CONTRACT.md`.
- The final answer includes the loop id and state path.

## Exit Protocol

```
---HANDOFF---
- Loop: {id}
- Status: {status}
- Attempts: {used}/{max}
- Verifier: {command}
- State: .planning/loops/{id}.json
- Next: {next action or "none"}
---
```

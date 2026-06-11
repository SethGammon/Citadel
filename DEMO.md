# Citadel Demo Workflow

This demo takes an existing repository, initializes Citadel, then asks it to improve confidence in the project by routing a real task, using local memory, verifying safely, and reporting cost or telemetry where the runtime supports it.

If Citadel is not installed yet, follow [INSTALL.md](INSTALL.md) first.

## Core Demo: 5 minutes, works in most repos

Open the repository you want Citadel to manage in Claude Code or OpenAI Codex, then run:

```text
/do setup --express
/do next
/do review README.md for first-time developer friction
/do identify the project's safest verification command and run it
/cost
```

### What each command demonstrates

**`/do setup --express`** creates or refreshes repo-local Citadel state: project detection, harness state, and hooks where the runtime supports them.

**`/do next`** shows the operator console: what Citadel currently sees, what should happen next, whether a local repair can run, what needs approval, and which verification profile applies.

**`/do review README.md for first-time developer friction`** demonstrates `/do` routing. You describe an engineering intent; Citadel routes the work to the right review workflow instead of requiring you to pick a skill first.

**`/do identify the project's safest verification command and run it`** demonstrates disciplined verification without assuming a stack. In a Node repo this might be `npm test`; in another repo it may be a lint command, typecheck, unit test, docs check, or a read-only verification path.

**`/cost`** demonstrates visibility into usage where telemetry is available. If the current runtime has no cost data yet, the useful result is still explicit: Citadel should report what it can see and what is unavailable.

## What to Look For

After the core demo, check for concrete evidence:

- `.planning/` exists or was refreshed.
- Project memory, campaign, verification, telemetry, or handoff files are created or updated when available for the runtime and task.
- Verification output is captured, summarized, or turned into a clear next step.
- Cost telemetry is visible when supported by the runtime.
- The agent produces a concrete report: what it found, what it changed or did not change, what passed, and what should happen next.

The important behavior is continuity. A later session should be able to inspect local Citadel state and continue from project evidence instead of starting from a blank chat.

Citadel itself is the canonical proof target (real docs, skills, hooks, and a real test suite; the verification command the agent should discover is `npm run test`). The demo is written around project intent rather than Citadel-specific paths, so the same workflow works on most repos.

## Advanced Demo: parallel orchestration

Use this only when you are ready for multiple agents to work in isolated git worktrees and produce changes you will review before accepting:

```text
/fleet split a polish pass across docs, install flow, and verification in isolated worktrees
```

What to look for:

- Fleet creates or updates state under `.planning/fleet/`.
- Agents work on independent scopes rather than stepping on the same files.
- Discoveries and handoffs are summarized back to the coordinator.
- Merge review remains explicit; do not accept parallel changes blindly.

If the task is not actually parallel, Citadel should downgrade or recommend a lighter workflow. That is a feature, not a failure: Fleet is for independent streams, not every task.

For a 90-second proof clip, record the core demo end to end in a real terminal or agent window: real repo, real commands, real output. The evidence checklist behind the recording is [Operating Loop Proof](docs/OPERATING_LOOP_PROOF.md); for a stricter post-landing first-use assessment, run the [Usefulness Trial](docs/USEFULNESS_TRIAL.md).

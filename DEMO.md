# Citadel Demo Workflow

This demo takes an existing repository, initializes Citadel, then asks it to improve confidence in the project by routing a real task, using local memory, verifying safely, and reporting cost or telemetry where the runtime supports it.

The point is not to tour every feature. The point is to show what changes when Claude Code or OpenAI Codex has a repo-local operating layer: setup, memory, routing, safety, verification, and reporting become part of the project instead of one-off chat discipline.

## Core Demo: 5 minutes, works in most repos

Open the repository you want Citadel to manage in Claude Code or OpenAI Codex.

If Citadel is not installed yet, paste the install prompt from [README.md](README.md#quick-install), follow any runtime-specific plugin enable step, then start a fresh session if the runtime asks for one.

Run these commands:

```text
/do setup --express
/do review README.md for first-time developer friction
/do identify the project's safest verification command and run it
/cost
```

### What each command demonstrates

**`/do setup --express`** creates or refreshes repo-local Citadel state. It detects the project, sets up the harness state Citadel uses, and installs or refreshes hooks where the runtime supports them.

**`/do review README.md for first-time developer friction`** demonstrates `/do` routing. The user describes an engineering intent, and Citadel routes the work to the right review workflow instead of requiring the user to pick a skill first.

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

## Canonical Example

Citadel itself is the canonical proof target because it has real docs, real skills, real hooks, and a real test suite.

From a Citadel clone, the verification command the agent should discover is:

```bash
npm run test
```

You can substitute your own repository. The core demo is intentionally written around project intent, not Citadel-specific file paths, so the same workflow works on most repos:

```text
/do setup --express
/do review README.md for first-time developer friction
/do identify the project's safest verification command and run it
/cost
```

## Advanced Demo: parallel orchestration

Use this only when you are ready for multiple agents to work in isolated git worktrees and produce changes you will review before accepting.

Fleet has stable user-facing commands. A believable advanced demo is:

```text
/fleet split a polish pass across docs, install flow, and verification in isolated worktrees
```

What to look for:

- Fleet creates or updates state under `.planning/fleet/`.
- Agents work on independent scopes rather than stepping on the same files.
- Discoveries and handoffs are summarized back to the coordinator.
- Merge review remains explicit; do not accept parallel changes blindly.

If the task is not actually parallel, Citadel should downgrade or recommend a lighter workflow. That is a feature, not a failure: Fleet is for independent streams, not every task.

## Before and After

**Before Citadel:** every agent session starts from scratch. You re-explain project context, choose workflows manually, remember safety rules yourself, and reconstruct what happened after the session ends.

**After Citadel:** setup, memory, routing, safety, verification, and cost visibility are part of the repo. The agent still does the work, but Citadel gives it an operating loop that can be inspected and repeated.

## Recording the demo

For a 90-second proof clip, record the core demo in a real terminal or agent window:

1. Open a real repository.
2. Paste the install prompt if needed.
3. Run `/do setup --express`.
4. Run the README friction review.
5. Run the safest verification command.
6. Show `/cost` or the explicit message that telemetry is not available yet.
7. Show the final report and the `.planning/` evidence.

Keep the recording practical: real repo, real commands, real output.

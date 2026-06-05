# Public Positioning

Citadel should be explained as an operating layer for coding agents, not as a new agent runtime and not as a promise of unattended correctness.

Use this guide when editing the README, writing demo copy, recording public clips, or reviewing contributor docs.

## Core Position

Citadel helps Claude Code and OpenAI Codex work across real repositories by adding the harness around the model:

- durable project memory
- `/do` intent routing
- lifecycle hooks and approval boundaries
- verification and report artifacts
- multi-agent coordination through isolated worktrees

The short version:

```text
Citadel is an open-source orchestration layer that makes coding agents easier to operate across real projects.
```

## Audience

Citadel is for builders who already use local coding agents and are hitting operational limits:

- repeated context setup across sessions
- unclear workflow choice for review, debugging, refactor, or larger builds
- weak handoffs after context reset
- manual safety and verification discipline
- ad hoc coordination when work needs multiple branches or agents

It is less useful for one-off toy prompts, non-git folders, or teams that want a hosted SaaS dashboard before adopting a local harness.

## Claims to Make

Prefer claims that can be inspected in the repository:

- Citadel stores project state under `.planning/`.
- `/do` routes plain-language tasks to skills and orchestrators.
- Hooks, approval capsules, and verification plans make local automation easier to review.
- Fleet coordinates independent work in isolated git worktrees.
- Reports and handoffs make later sessions less dependent on chat memory.

Tie claims to commands or files whenever possible.

## Claims to Avoid

Avoid language that overstates what the harness can guarantee:

- "fully autonomous engineer"
- "safe unattended execution"
- "replaces code review"
- "guarantees correct routing"
- "secure sandbox"
- "works identically across all runtimes"
- "no human approval needed"

Citadel can improve operating discipline. It does not remove the need for human review, repository-specific verification, or approval around risky actions.

## Public Proof Standard

When public copy says Citadel is real, point to evidence:

- the install prompt and `/do setup --express`
- the [demo workflow](../DEMO.md)
- the [operating loop proof](OPERATING_LOOP_PROOF.md)
- the [report artifact guide](REPORT_ARTIFACTS.md)
- the local verification command, usually `npm test` for this repository

Screenshots and videos are useful only when they show the command path, the selected workflow, and the resulting artifact or verification output.

## Review Checklist

Before merging public-facing copy, check:

- Does it describe Citadel as a harness or operating layer?
- Does it name at least one concrete command, file, or artifact?
- Does it avoid unsupported autonomy or security guarantees?
- Does it distinguish local repo state from publishable public docs?
- Does it explain who benefits without claiming every coding-agent user needs the full harness?

## Expected Outcome

Clear positioning helps the right users understand Citadel quickly: it is the repo-local operating layer around Claude Code and Codex, built for memory, routing, safety boundaries, verification, and coordinated work that survives a single chat session.

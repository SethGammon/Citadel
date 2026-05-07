# Architecture

> last-updated: 2026-05-07

How the harness works, from intent to execution.

For the runtime-agnostic contract boundary, see
[`docs/architecture/runtime-contract.md`](architecture/runtime-contract.md).

## The Orchestration Ladder

```
/do ─────────── Router (classifies intent, dispatches)
  │
  ├─ Skills ─── Focused, single-task protocols
  │
  ├─ /marshal ─ Single-session orchestrator (chains skills)
  │
  ├─ /archon ── Multi-session campaigns (persistent state)
  │   │
  │   └─ spawns /marshal for individual phases
  │
  └─ /fleet ─── Parallel campaigns (waves of agents)
      │
      └─ spawns agents in isolated worktrees
```

**Use the cheapest level that fits.** A typo fix doesn't need Archon.
A multi-day feature doesn't fit in a single skill.

| Level | Duration | Token Cost | State | Use When |
|-------|----------|-----------|-------|----------|
| Skill | minutes | low | none | Focused, known pattern |
| Marshal | 30min-2hr | medium | session log | Multi-step, one session |
| Archon | hours-days | high | campaign file | Multi-session, needs persistence |
| Fleet | days | very high | session file | 3+ parallel streams |

## The /do Router

Four tiers of classification, each cheaper than the next:

1. **Tier 0: Pattern Match** (~0 tokens) — Regex catches trivial commands
2. **Tier 1: Active State** (~0 tokens) — Checks for campaigns to resume
3. **Tier 2: Skill Keywords** (~0 tokens) — Matches against installed skills
4. **Tier 3: LLM Classifier** (~500 tokens) — Structured complexity analysis

First match wins. The router biases toward under-routing because it's cheaper
to re-invoke than to waste tokens on over-routing.

## Hooks

Automatic Node.js scripts that fire on 29 lifecycle events. 32 hooks total. Full reference: [docs/HOOKS.md](HOOKS.md).

| Category | Key Hooks | Purpose |
|----------|-----------|---------|
| Safety (PreToolUse) | `protect-files.js`, `external-action-gate.js`, `governance.js` | Block protected edits, gate external actions, audit tool calls |
| Quality (PostToolUse) | `post-edit.js`, `organize-enforce.js`, `complexity-check.js` | Typecheck, file placement, advisory complexity scores |
| Wave (PostToolBatch) | `post-tool-batch.js` | Async quality checkpoint after parallel tool waves |
| Session | `init-project.js`, `session-end.js`, `restore-compact.js` | Scaffold state, flush telemetry, restore after compression |
| Fleet | `subagent-start.js`, `subagent-stop.js`, `worktree-setup.js` | Agent identity binding, completion logging, worktree init |
| Consent | `permission-request.js`, `external-action-gate.js` | Auto-approve safe ops, gate pushes/PRs with user consent |
| Signals | `instructions-loaded.js`, `file-changed.js`, `config-change.js` | React to CLAUDE.md reloads, file-on-disk changes, settings changes |

Hook definitions live in `hooks/hooks-template.json`. Installed per-project via `scripts/install-hooks.js`.

## Governance & Safety

Three layers of policy enforcement:

| Layer | Mechanism | When |
|-------|-----------|------|
| Automatic | Hooks (PreToolUse, PostToolUse) | Every tool call |
| Spawned judge | `policy-enforcer` agent (Haiku, read-only) | Red-reversibility operations in Archon |
| Constitution | `docs/CONSTITUTION.md` — 3-tier rules | Tier 1 hard-blocks, Tier 2 warns, Tier 3 advisory |

The `policy-enforcer` agent receives a proposed action, reads the Tier-appropriate rules, and returns a structured JSON verdict (allow/block). Tier 1 violations always block. Archon spawns it before destructive or hard-to-reverse operations.

Audit entries are written with a `_hash` field (SHA-256 of the entry content minus `_hash` itself). The `verify-audit-integrity` script detects tampering by recomputing hashes.

## Campaign Files

The only persistent state. Everything else is amnesiac.

```markdown
# Campaign: {name}

Status: active
Direction: {what the user asked for}

## Phases
1. [complete] Research: ...
2. [in-progress] Build: ...
3. [pending] Verify: ...

## Feature Ledger      ← what's been built
## Decision Log        ← choices and reasoning
## Active Context      ← where we are now
## Continuation State  ← machine-readable pickup point
```

Each Archon invocation reads the campaign file to rebuild context.
Each completion updates the file. This is how work survives across sessions.

## Fleet Sessions

Parallel execution through coordinated waves:

```
Wave 1: Agent A (src/api/) + Agent B (src/ui/)
  ← Collect results
  ← Compress discoveries (~500 tokens each)
  ← Merge branches

Wave 2: Agent C (src/api/ + src/ui/) ← informed by Wave 1 discoveries
  ← Collect, compress, merge
```

Discovery relay is the key innovation: Wave 2 agents start with Wave 1's
knowledge, preventing rediscovery and enabling informed decisions.

## Coordination

File-based coordination prevents parallel agents from editing the same files:

```
.planning/coordination/
  instances/     ← who's running
  claims/        ← who's editing what
```

Scope overlap detection: parent/child directories overlap, siblings don't.
`(read-only)` scopes never conflict. Dead instances are cleaned up by sweep.

## Skills

Protocol files that load into Claude's context on demand.
Built-in skills live in the plugin's `skills/` directory. Custom project skills live at `.claude/skills/{name}/SKILL.md`.

```
skills/{name}/SKILL.md          # Built-in (plugin)
.claude/skills/{name}/SKILL.md  # Custom (project)

---
name: skill-name
description: What it does
user-invocable: true
---

# /skill-name

## Identity      ← Who is this skill?
## Orientation   ← When to use it?
## Protocol      ← Step-by-step instructions
## Quality Gates ← What must be true when done?
## Exit Protocol ← What to output?
```

Skills cost zero tokens when not loaded. They're on-demand expertise.

## Configuration

`.claude/harness.json` stores project-specific settings:

```json
{
  "language": "typescript",
  "framework": "react",
  "packageManager": "npm",
  "typecheck": { "command": "npx tsc --noEmit", "perFile": true },
  "test": { "command": "npm test", "framework": "vitest" },
  "qualityRules": { "builtIn": ["no-confirm-alert"], "custom": [] },
  "protectedFiles": [".claude/harness.json"],
  "features": { "intakeScanner": true, "telemetry": true }
}
```

Generated by `/do setup`. Edit manually to customize.

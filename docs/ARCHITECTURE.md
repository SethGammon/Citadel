# Architecture

> last-updated: 2026-08-09

How the harness works, from intent to execution.

The public operating vocabulary is: **Request → Run → Evidence → Needs You /
Resume**. The repository is the state and evidence boundary; Claude Code or
Codex remains the execution runtime.

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
  └─ /fleet --quick ─ Parallel campaigns (waves of agents)
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

Four runtime stages narrow the request:

1. **Tier 0: Exact command** (~0 tokens): normalized whole-input equality,
   never substring matching. Project `test`, `build`, and `typecheck` commands
   are final only when the target `package.json` declares that script.
2. **Tier 1: Active state** (~0 tokens): the live agent checks campaigns,
   Fleet sessions, review-package state, and deterministic continuation.
3. **Tier 2: Candidate discovery** (~0 tokens): generated built-in keywords
   plus project-local custom skills produce evidence, not execution authority.
4. **Tier 3: Runtime semantic classifier** (~500 tokens): the live agent
   classifies scope, complexity, persistence, parallelism, and judgment, then
   applies proportionality and activation before dispatch.

Only exact Tier 0 commands can skip semantic classification. A single Tier 2
match is still a candidate, and multiple matches are carried forward rather
than resolved by table order. An explicit validated route override changes
selection only; it does not bypass activation, worktree, approval, or
verification boundaries.

`scripts/route-preview.js` is deliberately narrower. It reuses the exact
contract and generated built-in candidates, but does not inspect Tier 1 state,
discover project custom skills, or run Tier 3. Every natural-language preview
is therefore non-final with `command: null`, `canRunNow: false`, and boundary
`semantic-classification-required`. See [Routing Preview](ROUTING_PREVIEW.md).

## Hooks

Automatic Node.js scripts: <!-- GENERATED: hook-script-count -->36<!-- /GENERATED --> hook scripts covering <!-- GENERATED: hook-event-count -->29<!-- /GENERATED --> lifecycle events.

| Category | Key Hooks | Purpose |
|----------|-----------|---------|
| Safety (PreToolUse) | `protect-files.js`, `external-action-gate.js`, `governance.js` | Block protected edits, gate external actions, audit tool calls |
| Quality (PostToolUse) | `post-edit.js`, `organize-enforce.js`, `complexity-check.js` | Typecheck, file placement, advisory complexity scores |
| Wave (PostToolBatch) | `post-tool-batch.js` | Async quality checkpoint after parallel tool waves |
| Session | `init-project.js`, `session-end.js`, `restore-compact.js` | Scaffold state, flush telemetry, restore after compression, and sync opted-in cross-clone memory |
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
| Constitution | loaded governance rules, 3 tiers | Tier 1 hard-blocks, Tier 2 warns, Tier 3 advisory |

The `policy-enforcer` agent receives a proposed action, reads the Tier-appropriate rules, and returns a structured JSON verdict (allow/block). Tier 1 violations always block. Archon spawns it before destructive or hard-to-reverse operations.

New telemetry and artifact records carry stable lineage fields (`event_id`, `run_id`, `agent_id`, `task_id`, `artifact_id`, `parent_id`, `source_event_id`) plus `_hash`, a SHA-256 digest of the canonical record content without integrity fields. Optional HMAC-SHA256 signing is enabled with `CITADEL_TELEMETRY_HMAC_KEY`. Run `node scripts/verify-telemetry-integrity.js` to verify hashes/signatures; older unsigned records are reported as legacy instead of treated as corrupted.

## Campaign Files

The default persistent state. An optional user-level SQLite store can preserve a
strict durable-knowledge subset across disposable clones; active execution state
remains repository-local.

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
  "typecheck": { "command": "npx tsc --noEmit", "timeoutMs": 25000 },
  "test": { "command": "npm test", "framework": "vitest" },
  "qualityRules": { "builtIn": ["no-confirm-alert"], "custom": [] },
  "protectedFiles": [".claude/harness.json"],
  "features": { "intakeScanner": true, "telemetry": true }
}
```

Generated by `/do setup`. Edit manually to customize.

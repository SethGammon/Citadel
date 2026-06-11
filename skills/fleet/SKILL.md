---
name: fleet
license: MIT
description: >-
  Parallel campaign orchestrator. Runs multiple campaigns in coordinated waves
  within a single session. Spawns 2-3 agents per wave in isolated worktrees,
  collects discoveries, shares context between waves. Use when work decomposes
  into 3+ independent streams that can run simultaneously.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - parallel
  - simultaneous
  - multiple agents
  - at the same time
last-updated: 2026-03-21
---

# /fleet — Parallel Coordinator

Use for 3+ independent work streams that can run simultaneously in isolated worktrees. Do NOT use for single-file scope, linear work, or when a marshal or skill suffices.

## Orientation

**Use when:** Running 2+ independent work streams in parallel — tasks with non-overlapping file scopes that can execute simultaneously.

**Don't use when:** Work must execute sequentially or accumulate findings across phases (use `/archon`), a single orchestrated session is enough (use `/marshal`), or the task is simple enough for a bare skill.

## Commands

| Command | Behavior |
|---|---|
| `/fleet [direction]` | Decompose direction into parallel streams, execute in waves |
| `/fleet [path-to-spec]` | Read a spec file, decompose into streams |
| `/fleet continue` | Resume from the last fleet session file |
| `/fleet` (no args) | Health diagnostic → work queue → execute |
| `/fleet --quick [task1]; [task2]` | Lightweight parallel mode for solo devs — 2+ tasks, single wave, auto-merge, no session file |
| `/fleet --speculative N [direction]` | Try N different approaches to the same task in parallel — see Speculative Mode below |
| `/fleet --teams [direction]` | Pilot: native task spine when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set, see Teams Mode (experimental) below |

## Protocol

### Step 1: WAKE UP

1. Read CLAUDE.md (project conventions)
2. Check `.planning/campaigns/` for active campaigns
3. Check `.planning/coordination/claims/` for external claims
4. Determine input mode: directed, spec-driven, continuing, or undirected
5. **Load prior session context**: if `.planning/momentum.json` exists, run `node .citadel/scripts/momentum-read.cjs` and use the active scopes and recurring decisions to inform work queue prioritization. Skip silently if the file is absent or output is empty.

> **Wave context restoration:** Use the Claude Code Compaction API to restore fleet session context. Do NOT read `.claude/compact-state.json` — deprecated in favour of server-side compaction (available on Opus 4.6+). Fleet session files (`.planning/fleet/session-{slug}.md`) remain the source of truth for inter-wave discovery relay; compaction handles agent memory, not campaign state. If the Compaction API is unavailable, read the fleet session file's Continuation State directly.

### Step 1b: LOG SESSION START + START WATCHER

Run `node .citadel/scripts/telemetry-log.cjs --event campaign-start --agent fleet --session {session-slug}`, then `node .citadel/scripts/momentum-watch-start.cjs`. The watcher runs in the background and re-synthesizes `momentum.json` within 500ms of any new discovery write. Safe to call if already running — one watcher per project.

### Step 2: WORK QUEUE

Produce a ranked list of campaigns with columns: Campaign name, Scope (directories touched), Dependencies, Wave, Agent type. Rules:
- Independent items go in Wave 1; items that depend on Wave 1 results go in Wave 2
- Maximum 3 agents per wave (conservative default)
- Scope must NOT overlap between agents in the same wave
- After writing or changing a session queue, run `node scripts/fleet-steward.js --session .planning/fleet/session-{slug}.md` and use its `READY TO RUN`, `BLOCKED`, `MERGE NEXT`, `MERGE BLOCKED`, and `SCOPE CONFLICTS` sections as the operational DAG.
- If the steward reports `READINESS BLOCKED`, do not spawn that task in a high-autonomy wave unless a human verified the worktree and you pass `--override-readiness` intentionally.

### Step 3: WAVE EXECUTION

For each wave:

1. **Prepare context** for each agent:
   - CLAUDE.md content and `.claude/agent-context/rules-summary.md`
   - **Map slice** (if `.planning/map/index.json` exists): run `node scripts/map-index.js --slice "<agent's scope keywords>" --max-files 15` and inject the `=== MAP SLICE ===` block; skip silently if no index
   - **Prior session context** (all waves): re-read momentum fresh at each wave boundary via `node .citadel/scripts/momentum-read.cjs` and inject as a `=== PRIOR SESSION CONTEXT ===` block — a fresh read picks up discoveries from parallel Fleet sessions in other terminals; skip silently if empty
   - Campaign-specific direction and scope, plus discovery briefs from previous waves
   - Sandbox provider status when an agent has a known worktree: `node scripts/sandbox-provider.js status --provider worktree --worktree {path}`
   - Which `.planning/` paths the agent may write and the merge strategy for each (see Shared State Merge Strategies)
2. **Log wave start**: `node .citadel/scripts/telemetry-log.cjs --event wave-start --agent fleet --session {session-slug} --meta '{"wave":N,"agents":["name1","name2"]}'`
3. **Spawn agents** with `isolation: "worktree"`, `mode: "bypassPermissions"`, prompt = full context + direction
4. **Collect results** from all agents in the wave
4.5. **Validate wave results** — spawn one Phase Validator per agent (subagent_type `citadel:phase-validator`, Haiku, read-only, effort: low), all in a single parallel batch — never sequentially. Validator prompt: campaign slug, wave, agent name, exit conditions (the agent's scope goal and any stated conditions), and the agent's full HANDOFF text. For each verdict:
   - **`pass`**: mark agent `validated` in session file. Proceed.
   - **`fail`**: check the retry counter for this agent (max 2 retries in fleet; single-session so lower budget than Archon's 3):
     - **Retries remain**: re-spawn the failed agent in a new worktree with the validator's `conditions_failed` and `suggestions` appended to its prompt. Collect, re-validate, decrement counter.
     - **Retries exhausted**: mark agent `partial` in session file. Log `validator_halt: {agent-name} wave {N} — {conditions_failed}`. Continue.
   - **Validator timeout or unparseable output**: treat as pass with warning. Log. Advance.
4.75. **Validate task exit evidence** if the Fleet session file has an `## Exit Evidence` table: `node scripts/evidence-validate.js --file .planning/fleet/session-{slug}.md --target task:{id}`. Failed required evidence creates a repair task or blocks advancement based on its retries remaining.
5. **Log per-agent results**: `node .citadel/scripts/telemetry-log.cjs --event agent-complete --agent {agent-name} --session {session-slug} --status {success|partial|failed}`
6. **Compress discoveries**: extract HANDOFF blocks, run `node .citadel/scripts/compress-discovery.cjs` on each output, write compressed briefs to `.planning/fleet/briefs/`
6b. **Write persistent discovery records** per agent (cross-session memory): `node .citadel/scripts/discovery-write.cjs --session {session-slug} --agent {agent-name} --wave {N} --status {success|partial|failed} --scope "{comma-separated-scope-dirs}" --handoff "{json-array}" --decisions "{json-array}" --files "{json-array}" --failures "{json-array}"`
7. **Log wave complete**: `node .citadel/scripts/telemetry-log.cjs --event wave-complete --agent fleet --session {session-slug} --meta '{"wave":N,"status":"complete"}'`
8. **Merge branches** from worktrees:
   - Run the fleet steward (command above); merge only tasks listed under `MERGE NEXT`
   - Review changes from each agent; if clean, merge the branch
   - If conflicts: record in session file, then decide:
     - **Resolve if:** the conflict is < 20 lines and affects only formatting or naming
     - **Skip if:** the conflict involves competing logic changes; keep the higher-delta worktree result and log the discarded changes in session file
9. **Update session file** with wave results and accumulated discoveries

### Step 5: COMPLETION

After all waves:

1. Run typecheck on the full project via `node scripts/run-with-timeout.js 300 <typecheck-cmd>`
2. Run tests if configured (also use the timeout wrapper). If tests fail after wave completion, apply the error ladder: 1-2 failures — fix before merging; 3-4 — attempt fixes, continue if resolved; 5+ — halt the wave merge for that worktree and log `wave_test_fail: true` in the session file.
3. Update session file status to `completed`
4. Log: `node .citadel/scripts/telemetry-log.cjs --event campaign-complete --agent fleet --session {session-slug}`
5. **Update momentum** (cross-session synthesis): `node .citadel/scripts/momentum-synthesize.cjs`
5.5. **Propagate knowledge**: run `npm run propagate -- --campaign {slug}` once per campaign that completed this session (not per wave). If `npm run propagate` is unavailable, note each slug in the fleet session file under `## Pending Propagation`.
6. Output final HANDOFF

## Fleet Session File Format

Create at `.planning/fleet/session-{slug}.md`:

```markdown
# Fleet Session: {name}

Status: active | needs-continue | completed
Started: {ISO timestamp}
Direction: {original direction}

## Work Queue
| # | Campaign | Scope | Deps | Status | Wave | Agent | Branch | Evidence |
|---|----------|-------|------|--------|------|-------|--------|----------|
| 1 | {name} | {dirs} | none | pending | - | - | - | - |

## Wave N Results
### Agent: {name}
**Status:** complete | partial | failed
**Built:** ...  **Decisions:** ...  **Files:** ...

## Shared Context (Discovery Relay)
- {cross-agent finding → what Wave N+1 should know}

## Continuation State
Next wave: N  Blocked items: ...  Auto-continue: true
```

## Scope Overlap Prevention

Before assigning agents to a wave, compare all agent scopes pairwise (a directory scope covers every file inside it):

- `src/api/` and `src/api/auth/` OVERLAP (parent/child); `src/api/` and `src/ui/` do NOT (siblings)
- `(read-only)` scopes never conflict
- On overlap: merge tasks, narrow scopes, or move one agent to a later wave. **NEVER proceed with overlapping scopes.**
- Also check `.planning/coordination/claims/` for external claims

## Budget Management

Use the `effort` parameter for wave agents, not `budget_tokens` (rationale: docs/FLEET.md#budget): scouts (research, mapping, audit) `medium` ~100K; execution agents (build, refactor, implement) `high` ~250K; verify agents (typecheck, visual-verify, QA) `low` ~60K.

## Quality Gates

- All agents must receive full context injection
- Scope must not overlap between same-wave agents
- Every wave must produce compressed discovery briefs
- Discovery relay must be injected into subsequent waves
- Merge conflicts must be resolved or explicitly recorded
- Final typecheck must pass after all waves

## Agent Timeouts

Sub-agents can hang indefinitely; Fleet enforces time limits at the orchestrator level. Read values from `harness.json` → `agentTimeouts.{skill|research|build}` (defaults: skill 10 min / research 15 min / build 30 min = 600000/900000/1800000 ms; config reference: docs/FLEET.md#agent-timeouts).

On timeout: log `agent-timeout` event, extract partial HANDOFF if present, retry once with simplified prompt (Wave 1 critical scope only), skip otherwise. Never block the wave. Record `Status: timed out` in session file.

## Shared State Merge Strategies

Parallel agents writing to the same `.planning/` directory can silently overwrite each other. Strategies (full rules table: docs/FLEET.md#shared-state-merge-strategies):

- **append-only** — `.planning/discoveries/*.md`, `.planning/fleet/briefs/*.md`, `.planning/telemetry/*.jsonl`, `.planning/wiki/_staging/*.jsonl`: each agent writes its own uniquely-named file or appends atomic JSONL lines; never overwrite an existing file.
- **lock-on-write** — `.planning/fleet/session-{slug}.md` (only the Fleet coordinator writes; agents emit HANDOFFs that the coordinator transcribes), `.planning/campaigns/{slug}.md` (only the owning Archon writes; fleet agents report campaign-adjacent work in their HANDOFF), `.planning/coordination/claims/*.json` (each agent owns its own claim file, named by instance ID).

**Enforcement:** before Step 3 spawn, remind each agent in its context injection which paths it may write to and the strategy for each. Agents that attempt to modify lock-on-write resources they don't own must be blocked via scope claim verification.

## Consistency Voting (High-Stakes Decisions)

For decisions that cannot easily be undone, spawn 3 Phase Validators in parallel with an identical vote prompt and require 2/3 agreement before proceeding.

**When to vote:** proposing to mark a multi-wave fleet `completed` while any wave is `partial`; merging an agent's branch after its phase validator returned `fail` (even after retries); deciding to abort and discard work from a wave with mixed results. Skip voting when the decision is clearly safe (all waves complete, all validators pass).

**Vote prompt:** state the session slug, wave, proposed decision, and evidence (handoff summaries, validator results); ask for JSON `{verdict: 'proceed'|'block', reason}` (template: docs/FLEET.md#consistency-voting).

**Tally:** 3/3 proceed → proceed; 2/3 proceed → proceed, log the dissenting reason; 2/3 block → block, escalate to user with the reasons; 3/3 block → block. A timed-out voter counts as `proceed` (conservative — don't let validator failure park the fleet).

## Coordination Safety

**Instance IDs:** every spawned agent gets a unique ID, format `fleet-{session-slug}-{wave}-{agent-index}` (e.g. `fleet-auth-refactor-w1-a3`). Write it to the agent's worktree as `.fleet-instance-id`, include it in all telemetry entries, and use it in coordination claims and dead instance recovery (details: docs/FLEET.md#instance-ids).

**Dead instance recovery:** after each wave, read `.planning/coordination/claims/`, verify each instance is still alive (worktree exists + HANDOFF present). Release orphaned claims; return uncompleted scope to the next wave's queue.

## Fringe Cases

- **`.planning/fleet/` does not exist**: Create the directory before writing the session file.
- **All agents in a wave fail**: Escalate to the user rather than proceeding to the next wave. Output which agents failed and why before continuing.
- **Worktree checkout fails for an agent**: Skip that agent, log the failure in the session file, and continue. Record the skipped scope as a gap for the next wave.
- **`.planning/` does not exist**: Create `.planning/fleet/` before starting. If `.planning/coordination/` is absent, skip scope claim registration.
- **Discovery compression script missing**: Write raw HANDOFF excerpts to the briefs directory instead.
- **Phase validator times out or returns malformed output**: Treat as pass with warning. Log and advance. Never block a wave on validator failure.
- **All agents in a wave fail validation and exhaust retries**: Mark the entire wave `partial`. Log `wave_validator_halt`. Escalate to the user before proceeding to the next wave — partial wave results may invalidate downstream wave assumptions.
- **An agent fails validation or post-wave tests**: Run `node scripts/fleet-steward.js --session .planning/fleet/session-{slug}.md --mark-failed {id} --reason "{reason}" --write` to mark the row failed and add a repair task with inherited dependencies.

## Speculative Mode

`/fleet --speculative N [direction]` — try N approaches to the same task simultaneously, each in its own worktree on branch `speculative/{session-slug}/{strategy-label}`. The user picks the winner; losers are archived, never deleted. (Depth and examples: docs/FLEET.md#speculative-mode.)

1. **Decompose into N strategies.** Each must target the exact same files and end goal, use a meaningfully different strategy (not style variations), and be feasible in a single agent session.
2. **Spawn N agents in parallel** with `isolation: "worktree"`. Each gets the common direction, its own strategy description, its branch name, and the instruction to set `branch` and `worktree_status: active` in its campaign frontmatter. Scope overlap rules do NOT apply between speculative agents — they intentionally touch the same files.
3. **Collect and compare.** For each agent: read the HANDOFF, run typecheck on its branch via `node scripts/run-with-timeout.js 300 <typecheck-cmd>`, record built/typecheck/decisions in the session file. Present a comparison table (Strategy | Branch | Typecheck | Key Decision | Notable Tradeoffs). If ALL N fail typecheck: present the table with all entries marked `FAIL typecheck` and ask the user to pick the least-broken approach or abort. Do not proceed to step 4 without a user decision.
4. **Archive losers, merge winner.** Winner: set campaign frontmatter `worktree_status: merged`, proceed with normal merge. Losers: set `worktree_status: archived`; do NOT delete branches (optional tag: `git tag archive/{loser-branch} {loser-branch}`). Add `## Speculative Comparison` to the session file: direction, N strategies, comparison table, winner, merge timestamp.

## Quick Mode

`/fleet --quick [task1]; [task2]; [task3]`

Differences from standard fleet: minimum 2 streams (not 3), minimum complexity 3 (not 4), single wave only, no session file (results reported inline), no discovery briefs, auto-merge if no conflicts, no scope claim. (Full comparison table and `/do` routing conditions: docs/FLEET.md#quick-mode.)

1. Parse tasks from the `--quick` argument (semicolon-separated)
2. Validate scope overlap — if any two tasks touch the same files, merge them or sequence them
3. Spawn all agents simultaneously with `isolation: "worktree"`
4. Collect results; auto-merge worktrees if no conflicts detected
5. If merge conflict: surface to user, offer manual resolution
6. Report results inline — no session file written unless the user asks

Entry from `/do` confirmation prompt: user chose yes (1) or always (2). Preferences stored under `consent.fleetSpawn` in harness.json via `readConsent`/`writeConsent`.

## Teams Mode (experimental)

`/fleet --teams [direction]`

Pilot: swap the coordination spine to native Agent Teams primitives. Everything not listed below is unchanged from the classic protocol above. Depth (comparison table, rollout plan, risks): see `docs/FLEET.md`, Teams Mode section.

### Precondition

Both must hold: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` present in the environment, AND the runtime is Claude Code. Otherwise print:

```
Teams mode unavailable: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS not set or runtime is not Claude Code. Falling back to classic worktree mode.
```

and run the classic protocol unchanged.

### Protocol deltas

| Concern | Delta from classic |
|---|---|
| Task spine | Lead creates one native task per scope (`TaskCreate`); dependency links mirror wave order; status via `TaskUpdate` |
| Discoveries | Teammates send discoveries to the lead via `SendMessage` |
| Durability | Lead mirrors every discovery to `.planning/fleet/<session>/discoveries/` on receipt; the mirror is the source of truth for recovery |
| Merge review | Unchanged (steward gates merges exactly as classic) |
| Rebalancing | On teammate idle, the TeammateIdle hook appends to `.planning/fleet/rebalance.jsonl`; the lead reassigns the next unblocked scope via `SendMessage` |

On any disagreement between messages and the mirror, reconcile from the mirror. Skip rebalance lines that lack a teammate identity, and skip rebalancing entirely when no scope is unblocked.

### Classic mode progressive enhancement

In classic mode, when native Task tools are available, the lead also mirrors each scope as a native task and updates its status at wave boundaries. `.planning` files stay canonical; native tasks are a visibility layer only.

## Contextual Gates

### Disclosure
- "Spawning {N} agents across {waves} waves in isolated worktrees. Estimated token budget: ~{tokens}K."
- For speculative mode: "Running {N} parallel approaches to the same task. All will touch the same files."

### Reversibility
- **Green:** Single-wave fleet with < 3 agents
- **Amber:** Multi-wave fleet (the default) -- each wave's merge is a separate commit
- **Red:** Speculative mode or fleets that modify shared infrastructure

Red actions require explicit confirmation regardless of trust level.

### Proportionality
- **Standard fleet:** work queue requires 3+ independent streams. Fewer → downgrade to Marshal or Archon.
- **Quick mode:** 2+ tasks with non-overlapping scopes. No minimum complexity gate.
- If all streams touch the same directory: downgrade to sequential Archon phases
- If estimated agents > 6: confirm with user (even trusted level)

### Trust Gating
Read trust level from `harness.json`:
- **Novice** (0-4 sessions): Always confirm before spawning. Show agent count, scopes, and estimated cost.
- **Familiar** (5-19 sessions): Confirm only for > 3 agents or speculative mode.
- **Trusted** (20+ sessions): Auto-proceed for standard fleet. Confirm only for speculative mode or > 6 agents.

## Exit Protocol

Update the session file, then output:

```
---HANDOFF---
- Fleet session: {name} — {waves completed} waves, {agents} agents total
- Built: {summary of all wave results}
- Discoveries: {key cross-agent findings}
- Merge conflicts: {count and resolution}
- Next: {remaining work if any}
- Reversibility: amber -- multi-wave merges, revert each wave's merge commit
---
```

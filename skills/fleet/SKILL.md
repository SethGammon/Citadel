---
name: fleet
description: >-
  Parallel campaign orchestrator. Runs multiple campaigns in coordinated waves
  within a single session. Spawns 2-3 agents per wave in isolated worktrees,
  collects discoveries, shares context between waves. Use when work decomposes
  into 3+ independent streams that can run simultaneously.
user-invocable: true
auto-trigger: false
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

## Protocol

### Step 1: WAKE UP

1. Read CLAUDE.md (project conventions)
2. Check `.planning/campaigns/` for active campaigns
3. Check `.planning/coordination/claims/` for external claims
4. Determine input mode: directed, spec-driven, continuing, or undirected
5. **Load prior session context**: If `.planning/momentum.json` exists, run
   ```bash
   node .citadel/scripts/momentum-read.cjs
   ```
   and read the output. Use the active scopes and recurring decisions to inform
   work queue prioritization. Skip silently if the file is absent or output is empty.

> **Wave context restoration:** Use the Claude Code Compaction API to restore fleet
> session context at the start of each session. Do NOT read `.claude/compact-state.json`
> — that pattern is deprecated in favour of server-side compaction (available on Opus 4.6+).
> Fleet session files (`.planning/fleet/session-{slug}.md`) remain the source of truth
> for inter-wave discovery relay; compaction handles agent memory, not campaign state.
> If the Compaction API is unavailable, fall back to reading the fleet session file's
> Continuation State directly.

### Step 1b: LOG SESSION START + START WATCHER

```bash
node .citadel/scripts/telemetry-log.cjs --event campaign-start --agent fleet --session {session-slug}
node .citadel/scripts/momentum-watch-start.cjs
```

The watcher runs in the background and re-synthesizes `momentum.json` within 500ms of any new discovery write. Safe to call if already running — only one watcher runs per project.

### Step 2: WORK QUEUE

Produce a ranked list of campaigns with:

| Column | Purpose |
|---|---|
| Campaign name | What this stream does |
| Scope | Which directories it touches |
| Dependencies | What must complete before this can start |
| Wave | Which wave to assign it to |
| Agent type | What kind of agent to spawn |

**Rules for work queue:**
- Independent items go in Wave 1
- Items that depend on Wave 1 results go in Wave 2
- Maximum 3 agents per wave (conservative default)
- Scope must NOT overlap between agents in the same wave

### Step 3: WAVE EXECUTION

For each wave:

1. **Prepare context** for each agent:
   - CLAUDE.md content
   - `.claude/agent-context/rules-summary.md`
   - **Map slice** (if `.planning/map/index.json` exists): run
     `node scripts/map-index.js --query "<agent's scope keywords>" --max-files 15`
     and inject the results as a `=== MAP SLICE ===` block. If the index does
     not exist, skip silently.
   - **Prior session context** (all waves): re-read `momentum.json` fresh at each
     wave boundary via `node .citadel/scripts/momentum-read.cjs` and inject as a
     `=== PRIOR SESSION CONTEXT ===` block. Re-reading (rather than reusing the
     Step 1 snapshot) picks up discoveries written by parallel Fleet sessions in
     other terminals. If the output is empty, skip silently.
   - Campaign-specific direction and scope
   - Discovery briefs from previous waves (if any)

2. **Log wave start**:
   ```bash
   node .citadel/scripts/telemetry-log.cjs --event wave-start --agent fleet --session {session-slug} --meta '{"wave":N,"agents":["name1","name2"]}'
   ```

3. **Spawn agents** with `isolation: "worktree"`:
   ```
   Agent(
     prompt: "{full context + direction}",
     isolation: "worktree",
     mode: "bypassPermissions"
   )
   ```

4. **Collect results** from all agents in the wave

5. **Log per-agent results**:
   ```bash
   node .citadel/scripts/telemetry-log.cjs --event agent-complete --agent {agent-name} --session {session-slug} --status {success|partial|failed}
   ```

6. **Compress discoveries** for each agent:
   - Extract HANDOFF blocks
   - Run `node .citadel/scripts/compress-discovery.cjs` on each output
   - Write compressed briefs to `.planning/fleet/briefs/`

6b. **Write persistent discovery records** for each agent (cross-session memory):
   ```bash
   node .citadel/scripts/discovery-write.cjs \
     --session {session-slug} \
     --agent {agent-name} \
     --wave {wave-number} \
     --status {success|partial|failed} \
     --scope "{comma-separated-scope-dirs}" \
     --handoff "{json-array-of-handoff-items}" \
     --decisions "{json-array-of-decisions}" \
     --files "{json-array-of-files-touched}" \
     --failures "{json-array-of-failures}"
   ```

7. **Log wave complete**:
   ```bash
   node .citadel/scripts/telemetry-log.cjs --event wave-complete --agent fleet --session {session-slug} --meta '{"wave":N,"status":"complete"}'
   ```

8. **Merge branches** from worktrees:
   - Review changes from each agent
   - If clean merge: merge the branch
   - If conflicts: record in session file, then decide:
     - **Resolve if:** the conflict is < 20 lines and affects only formatting or naming
     - **Skip if:** the conflict involves competing logic changes; keep the higher-delta worktree result and log the discarded changes in session file

9. **Update session file** with wave results and accumulated discoveries

### Step 5: COMPLETION

After all waves:

1. Run typecheck on the full project via `node scripts/run-with-timeout.js 300 <typecheck-cmd>`
2. Run tests if configured (also use the timeout wrapper). If tests fail after wave completion: apply the same error ladder as the main protocol — 1-2 failures: fix before merging; 3-4 failures: attempt fixes, continue if resolved; 5+ failures: halt the wave merge for that worktree and log `wave_test_fail: true` in the session file.
3. Update session file status to `completed`
4. Log session completion:
   ```bash
   node .citadel/scripts/telemetry-log.cjs --event campaign-complete --agent fleet --session {session-slug}
   ```
5. **Update momentum** (cross-session synthesis):
   ```bash
   node .citadel/scripts/momentum-synthesize.cjs
   ```
5.5. **Propagate knowledge** — for each campaign that completed this session, run:
   ```bash
   npm run propagate -- --campaign {slug}
   ```
   Run once per completed campaign slug (not per wave). If multiple campaigns
   completed, run for each slug. If `npm run propagate` is unavailable, note each
   slug in the fleet session file under `## Pending Propagation`.
6. Output final HANDOFF

## Fleet Session File Format

Create at `.planning/fleet/session-{slug}.md`:

```markdown
# Fleet Session: {name}

Status: active | needs-continue | completed
Started: {ISO timestamp}
Direction: {original direction}

## Work Queue
| # | Campaign | Scope | Deps | Status | Wave | Agent |

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

Before assigning agents to a wave:

1. List all scope directories for each agent
2. Check for parent/child overlaps:
   - `src/api/` and `src/api/auth/` OVERLAP (parent/child)
   - `src/api/` and `src/ui/` do NOT overlap (siblings)
3. `(read-only)` scopes never conflict
4. If overlap: move one agent to a later wave

Also check `.planning/coordination/claims/` for external claims.

## Budget Management

**Effort hints for wave agents** (use the `effort` parameter, not `budget_tokens`):

| Agent Type | Effort | ~Tokens |
|---|---|---|
| Fleet scouts (research, mapping, audit) | `medium` | ~100K each |
| Execution agents (build, refactor, implement) | `high` | ~250K each |
| Verify agents (typecheck, visual-verify, QA) | `low` | ~60K each |

The `effort` parameter is GA as of April 2026 and produces ~20–40% token reduction
compared to manually tuned `budget_tokens` values. Always prefer `effort` for new wave definitions.

## Quality Gates

- All agents must receive full context injection
- Scope must not overlap between same-wave agents
- Every wave must produce compressed discovery briefs
- Discovery relay must be injected into subsequent waves
- Merge conflicts must be resolved or explicitly recorded
- Final typecheck must pass after all waves

## Agent Timeouts

Sub-agents can hang indefinitely on tool calls. Fleet must enforce execution time limits
at the orchestrator level.

### Default Timeouts

| Agent Type | Default Timeout | Override Key |
|---|---|---|
| Skill-level agents | 10 minutes | `agentTimeouts.skill` |
| Research scouts | 15 minutes | `agentTimeouts.research` |
| Build agents | 30 minutes | `agentTimeouts.build` |

Timeouts are configurable in `harness.json`:
```json
{
  "agentTimeouts": {
    "skill": 600000,
    "research": 900000,
    "build": 1800000
  }
}
```

### Timeout Protocol

On timeout: log `agent-timeout` event, extract partial HANDOFF if present, retry once with simplified prompt (Wave 1 critical scope only), skip otherwise. Never block the wave. Record `Status: timed out` in session file.

Read timeout values from `harness.json` → `agentTimeouts.{skill|research|build}` (defaults: 600000/900000/1800000ms).

## Coordination Safety

### Instance ID Generation

Every agent spawned by Fleet must have a unique instance ID.

Format: `fleet-{session-slug}-{wave}-{agent-index}`
Example: `fleet-auth-refactor-w1-a3` (wave 1, agent 3)

The instance ID is:
- Written to the agent's worktree as `.fleet-instance-id`
- Included in all telemetry log entries for this agent
- Used in coordination claims to identify which agent owns which scope
- Used in dead instance recovery to identify orphaned claims

### Scope Overlap Detection

Before spawning: compare all agent scopes pairwise (directory scopes overlap any file inside them). On overlap: merge tasks, narrow scopes, or sequence. **NEVER proceed with overlapping scopes.**

### Dead Instance Recovery

After each wave: read `.planning/coordination/claims/`, verify each instance is still alive (worktree exists + HANDOFF present). Release orphaned claims, return uncompleted scope to next wave's queue.

## Fringe Cases

- **`.planning/fleet/` does not exist**: Create the directory before writing the session file.
- **All agents in a wave fail**: Escalate to the user rather than proceeding to the next wave. Output which agents failed and why before continuing.
- **Worktree checkout fails for an agent**: Skip that agent, log the failure in the session file, and continue. Record the skipped scope as a gap for the next wave.
- **`.planning/` does not exist**: Create `.planning/fleet/` before starting. If `.planning/coordination/` is absent, skip scope claim registration.
- **Discovery compression script missing**: Write raw HANDOFF excerpts to the briefs directory instead.

## Speculative Mode

`/fleet --speculative N [direction]`

Try N different approaches to the same task simultaneously. Each approach gets its own
worktree and branch. When all finish, the user picks the winner; losers are archived (not deleted).

### Step 1: Decompose into N strategies

Before spawning, enumerate N distinct approaches. Each approach must:
- Target the exact same files and end goal
- Use a meaningfully different strategy (not just style variations)
- Be feasible to complete in a single agent session

### Step 2: Spawn N agents in parallel

Each agent gets:
- The common direction (same for all)
- Its strategy description (different per agent)
- Its own branch name: `speculative/{session-slug}/{strategy-label}`
- Instruction to set `branch` and `worktree_status: active` in its campaign frontmatter

Spawn with `isolation: "worktree"`. Scope overlap rules do NOT apply between speculative
agents — they will all touch the same files intentionally.

### Step 3: Collect and compare

After all agents complete, for each:
1. Read the HANDOFF
2. Run typecheck on that worktree's branch via `node scripts/run-with-timeout.js 300 <typecheck-cmd>`
3. Record in the session file: what was built, typecheck result, key decisions

Present a comparison table to the user:

| Strategy | Branch | Typecheck | Key Decision | Notable Tradeoffs |
|----------|--------|-----------|--------------|-------------------|

If ALL N approaches fail typecheck: present the comparison table with all entries marked `FAIL typecheck`. Ask the user to pick the least-broken approach or abort. Do not proceed to Step 4 without a user decision.

### Step 4: Archive losers, merge winner

When the user picks a winner:
1. **Winner**: Update campaign frontmatter `worktree_status: merged`, proceed with normal merge
2. **Losers**: Update campaign frontmatter `worktree_status: archived`. Do NOT delete branches.

```bash
# Optional: tag losers for clarity
git tag archive/{loser-branch} {loser-branch}
```

Add `## Speculative Comparison` to session file: direction, N strategies, comparison table (strategy/branch/status/typecheck/notes), winner, merge timestamp.

## Quick Mode

`/fleet --quick [task1]; [task2]; [task3]`

### Differences from standard fleet

| Property | Standard Fleet | Quick Mode |
|---|---|---|
| Min streams | 3 | 2 |
| Min complexity | 4 | 3 |
| Waves | Multi-wave with discovery relay | Single wave only |
| Session file | Written to `.planning/fleet/` | Skipped — results reported inline |
| Discovery briefs | Compressed to `.planning/fleet/briefs/` | Skipped |
| Merge | Per-wave confirmation | Auto-merge if no conflicts |
| Scope claim | Written to coordination/ | Skipped |

### Protocol

1. Parse tasks from the `--quick` argument (semicolon-separated)
2. Validate scope overlap — if any two tasks touch the same files, merge them or sequence them
3. Spawn all agents simultaneously with `isolation: "worktree"`
4. Collect results; auto-merge worktrees if no conflicts detected
5. If merge conflict: surface to user, offer manual resolution
6. Report results inline — no session file written unless the user asks

### When /do routes here

`/do` routes to `--quick` mode (not standard fleet) when:
- Input contains "at the same time", "simultaneously", "in parallel", "both ... and"
- Two or more clearly independent tasks are detected
- Complexity is 3 (moderate), not 4+ (complex)
- User chose "1" (yes once) or "2" (always) on the Fleet confirmation prompt

Entry from `/do` confirmation prompt: user chose yes (1) or always (2). Preferences stored under `consent.fleetSpawn` in harness.json via `readConsent`/`writeConsent`.

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

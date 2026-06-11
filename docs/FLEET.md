# Fleet — Parallel Campaign Orchestration

> last-updated: 2026-06-11

Fleet runs multiple campaigns simultaneously through coordinated waves,
sharing discoveries between them.

## When to Use Fleet

- Work decomposes into 3+ independent streams
- Domains don't overlap in files (e.g., API + frontend + docs)
- You want institutional-scale throughput from a single session

## Wave Mechanics

```
Wave 1: 2-3 agents run in parallel (worktree-isolated)
  │
  ← Collect results from all agents
  ← Compress each output to ~500-token discovery brief
  ← Merge branches into main
  │
Wave 2: 2-3 agents, informed by Wave 1 discoveries
  │
  ← Collect, compress, merge
  │
Wave N: Continue until work queue empty
```

### Discovery Relay

The key innovation. After each wave:

1. Each agent's output is compressed to a ~500-token brief
2. Briefs capture: what was built, decisions made, discoveries, failures
3. Next wave's agents receive ALL previous briefs in their context
4. Agents don't rediscover what previous agents already found

Example: Wave 1 Agent A finds the API has rate limiting at 100 req/min.
Wave 2 Agent C (building the frontend) starts with that knowledge and
implements client-side throttling without hitting the limit first.

### Worktree Isolation

A [git worktree](https://git-scm.com/docs/git-worktree) is a separate working directory
linked to the same repository. Think of it as a lightweight clone — it shares the same
`.git` history but has its own files and branch. This lets multiple agents edit files
simultaneously without conflicts.

Every agent runs in its own git worktree:
- Separate working directory — no file conflicts between agents
- Independent git branch — clean merge path
- Dependencies auto-installed by the WorktreeCreate hook
- Environment files copied from main repo

## Fleet Session Files

State lives in `.planning/fleet/session-{slug}.md`:

```markdown
# Fleet Session: {name}

Status: active
Direction: {what was requested}

## Work Queue
| # | Campaign | Scope | Deps | Status | Wave | Agent | Branch | Evidence |
|---|----------|-------|------|--------|------|-------|--------|----------|
| 1 | API auth | src/api/ | none | merged | 1 | build | codex/api-auth | validator pass |
| 2 | Frontend | src/ui/ | none | validated | 1 | build | codex/frontend | validator pass |
| 3 | Integration | both | 1, 2 | pending | 2 | verify | - | - |

## Wave 1 Results
### Agent: api-builder
**Built:** JWT auth middleware
**Discoveries:** Uses jose library, tokens expire in 15min

## Shared Context
- API uses jose for JWT (inform frontend agents)
- 15min token expiry means frontend needs refresh logic
```

Citadel also ships a queue steward:

```bash
node scripts/fleet-steward.js --session .planning/fleet/session-{slug}.md
```

The steward parses the markdown table as the session DAG. It reports runnable
tasks, dependency-blocked tasks, merge-order blockers, and same-wave scope
conflicts. It is read-only unless `--write` is paired with `--mark-failed`, which
marks the failed row and adds a repair task.

Fleet also reads `.planning/verification/worktree-readiness/*.json`. A task whose
branch matches a `blockFleet: true` readiness report is shown under
`READINESS BLOCKED` instead of `READY TO RUN`. Use
`--override-readiness` only when a human has verified the worktree manually.

## Shared State Merge Strategies

Parallel agents access shared `.planning/` state. Each resource has a declared merge strategy to prevent silent overwrites:

| Resource | Strategy | Rule |
|---|---|---|
| `.planning/discoveries/*.md` | append-only | Never overwrite an existing discovery file. Each agent writes its own uniquely-named file: `{agent-id}-{timestamp}.md`. |
| `.planning/fleet/briefs/*.md` | append-only | Each agent writes its own brief. Fleet coordinator reads all of them. |
| `.planning/fleet/session-{slug}.md` | lock-on-write | Only the Fleet coordinator updates the session file. Agents never write to it directly — they emit HANDOFFs that the coordinator reads and transcribes. |
| `.planning/campaigns/{slug}.md` | lock-on-write | Only the owning Archon instance updates this file. Fleet agents that produce campaign-adjacent work report it in their HANDOFF and let Archon update. |
| `.planning/telemetry/*.jsonl` | append-only | Append-only log. Multiple agents may append simultaneously — JSONL format guarantees each line is an atomic write. |
| `.planning/wiki/_staging/*.jsonl` | append-only | Each agent writes a uniquely-named staging file. Compile step resolves all of them in order. No concurrent write conflicts possible. |
| `.planning/coordination/claims/*.json` | lock-on-write | Each agent owns its own claim file (named by instance ID). No sharing; no conflicts. |

An agent that violates its resource's strategy may silently corrupt shared state.
When in doubt, use append-only and let Fleet merge after the wave completes.
Before spawning a wave, the coordinator reminds each agent which paths it may
write to and the strategy for each; agents that attempt to modify lock-on-write
resources they don't own are blocked via scope claim verification.

## Consistency Voting

For high-stakes Fleet decisions, spawn 3 Phase Validators and require 2/3 agreement:

**When to vote:**
- A wave completes partially (some agents succeeded, some failed) and the next wave's scope depends on the outcome
- A failed validation merge would affect other agents' branches
- An abort decision would discard multiple agents' work

**How to vote:**
1. Spawn 3 Phase Validator agents with identical context
2. Each agent independently examines the evidence and returns a verdict (`proceed` / `abort` / `retry`)
3. Tally: majority verdict wins; timeout counts as `proceed` (never blocks indefinitely)
4. Log the vote and outcome to `telemetry/agent-runs.jsonl`

**Vote prompt template** (used by `/fleet` for completion approval, merge-after-fail, and abort decisions):

```
Vote prompt: "Fleet session {slug}, Wave {N}. The proposed decision is: {decision}.
             Evidence: {handoff summaries, validator results}.
             Should we proceed? Respond with JSON: {verdict: 'proceed'|'block', reason: '...'}"
```

Tally rules for the proceed/block form: 3/3 proceed → proceed; 2/3 proceed →
proceed and log the dissenting reason; 2/3 block → block and escalate to the
user with the reasons; 3/3 block → block. A timed-out voter counts as `proceed`
(conservative — validator failure must never park the fleet). Skip voting when
the decision is clearly safe (all waves complete, all validators pass).

## Coordination

### Scope Overlap Prevention

Agents in the same wave MUST NOT touch the same files:
- Parent/child directories overlap: `src/api/` and `src/api/auth/` conflict
- Sibling directories are safe: `src/api/` and `src/ui/` don't conflict
- `(read-only)` scopes never conflict

### Multi-Instance Coordination

If multiple Archon or Fleet instances run simultaneously:
- `.citadel/scripts/coordination.js` manages instance registration and scope claims
- Claims are file-based (no database needed)
- Dead instances cleaned up by `npm run coord:sweep`

### Instance IDs

Every agent spawned by Fleet gets a unique instance ID with format
`fleet-{session-slug}-{wave}-{agent-index}`, e.g. `fleet-auth-refactor-w1-a3`
(wave 1, agent 3). The instance ID is:

- Written to the agent's worktree as `.fleet-instance-id`
- Included in all telemetry log entries for this agent
- Used in coordination claims to identify which agent owns which scope
- Used in dead instance recovery to identify orphaned claims

## Agent Timeouts

Sub-agents can hang indefinitely on tool calls, so Fleet enforces execution
time limits at the orchestrator level.

| Agent Type | Default Timeout | Override Key |
|---|---|---|
| Skill-level agents | 10 minutes | `agentTimeouts.skill` |
| Research scouts | 15 minutes | `agentTimeouts.research` |
| Build agents | 30 minutes | `agentTimeouts.build` |

Timeouts are configurable in `harness.json` (values in milliseconds):

```json
{
  "agentTimeouts": {
    "skill": 600000,
    "research": 900000,
    "build": 1800000
  }
}
```

On timeout, the coordinator logs an `agent-timeout` event, extracts a partial
HANDOFF if one is present, retries once with a simplified prompt (Wave 1
critical scope only), and otherwise skips the agent. A timeout never blocks
the wave; the session file records `Status: timed out` for that agent.

## Speculative Mode

`/fleet --speculative N [direction]` tries N different approaches to the same
task simultaneously. Each approach gets its own worktree and branch
(`speculative/{session-slug}/{strategy-label}`). When all finish, the user
picks the winner; losers are archived, not deleted.

**Strategy decomposition.** Before spawning, the coordinator enumerates N
distinct approaches. Each approach must target the exact same files and end
goal, use a meaningfully different strategy (not just style variations), and
be feasible to complete in a single agent session.

**Spawn.** Each agent receives the common direction (same for all), its
strategy description (different per agent), its branch name, and the
instruction to set `branch` and `worktree_status: active` in its campaign
frontmatter. Agents spawn with `isolation: "worktree"`. Scope overlap rules do
NOT apply between speculative agents — they all touch the same files
intentionally.

**Compare.** After all agents complete, the coordinator reads each HANDOFF,
runs typecheck on each worktree's branch via
`node scripts/run-with-timeout.js 300 <typecheck-cmd>`, records what was
built, the typecheck result, and key decisions in the session file, then
presents a comparison table:

| Strategy | Branch | Typecheck | Key Decision | Notable Tradeoffs |
|----------|--------|-----------|--------------|-------------------|

If ALL N approaches fail typecheck, the table is presented with every entry
marked `FAIL typecheck` and the user must pick the least-broken approach or
abort; the coordinator never proceeds to archive/merge without a user
decision.

**Archive losers, merge winner.** The winner's campaign frontmatter is updated
to `worktree_status: merged` and merged normally. Losers are updated to
`worktree_status: archived`; their branches are never deleted. Optionally tag
losers for clarity:

```bash
git tag archive/{loser-branch} {loser-branch}
```

The session file gains a `## Speculative Comparison` section: direction, the N
strategies, the comparison table (strategy/branch/status/typecheck/notes), the
winner, and the merge timestamp.

## Quick Mode

`/fleet --quick [task1]; [task2]; [task3]` is the lightweight parallel mode
for solo devs: 2+ semicolon-separated tasks, single wave, auto-merge, no
session file.

| Property | Standard Fleet | Quick Mode |
|---|---|---|
| Min streams | 3 | 2 |
| Min complexity | 4 | 3 |
| Waves | Multi-wave with discovery relay | Single wave only |
| Session file | Written to `.planning/fleet/` | Skipped — results reported inline |
| Discovery briefs | Compressed to `.planning/fleet/briefs/` | Skipped |
| Merge | Per-wave confirmation | Auto-merge if no conflicts |
| Scope claim | Written to coordination/ | Skipped |

**When /do routes to quick mode.** `/do` routes to `--quick` (not standard
fleet) when the input contains "at the same time", "simultaneously",
"in parallel", or "both ... and"; two or more clearly independent tasks are
detected; complexity is 3 (moderate), not 4+ (complex); and the user chose
"1" (yes once) or "2" (always) on the Fleet confirmation prompt. The
preference is stored under `consent.fleetSpawn` in harness.json via
`readConsent`/`writeConsent`.

## Teams Mode (experimental pilot)

Gated behind the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` environment variable on a
Claude Code runtime. When the flag is absent or the runtime is not Claude Code,
`/fleet --teams` prints an explicit notice and runs classic worktree mode unchanged.

In teams mode the lead keeps the classic wave plan but swaps the coordination
spine: native tasks carry the DAG, `SendMessage` carries discoveries, and the
TeammateIdle hook drives rebalancing. The `.planning/fleet/` mirror remains the
durable record; recovery always reconciles from the mirror.

### Classic vs Teams

| Dimension | Classic (file relay) | Teams (native spine) |
|---|---|---|
| Isolation model | One git worktree per agent via `isolation: "worktree"` | Teammate sessions; file isolation still via worktrees, coordination via the team runtime |
| Comms channel | Files: HANDOFF blocks, briefs in `.planning/fleet/briefs/` | `SendMessage` teammate-to-lead, mirrored by the lead to `.planning/fleet/<session>/discoveries/` |
| Durability | Inherent: every relay artifact is a file | Messages are ephemeral; durability comes only from the lead's `.planning` mirror |
| Rebalancing | None: wave membership is fixed at spawn | TeammateIdle hook appends to `.planning/fleet/rebalance.jsonl`; lead reassigns the next unblocked scope via `SendMessage` |
| Failure modes | Stale session file, orphaned worktrees, merge conflicts | All of classic, plus lost messages, flag instability, idle events with nothing reassignable |

### Rollout plan

Pilot on ONE campaign type first: multi-stream refactors with 3+ non-overlapping
scopes, the shape with the most rebalancing opportunity. Do not enable teams mode
for speculative or quick mode during the pilot.

Success criteria, measured per pilot session:

1. Zero lost discoveries: every discovery received via `SendMessage` appears in
   the `.planning/fleet/<session>/discoveries/` mirror, and nothing the merge
   review needed existed only in a message.
2. Reassignment latency on idle: time from a `rebalance.jsonl` idle line to the
   lead's `SendMessage` reassignment. Target: within one lead turn.
3. Merge conflicts not worse than classic: conflict count per wave at or below
   the classic baseline for the same campaign type.

If any criterion fails for two consecutive pilot sessions, revert to classic and
record findings in the session file.

### Risks

| Risk | Mitigation |
|---|---|
| Experimental flag instability: behavior changes or removal between Claude Code releases | Precondition check falls back to classic automatically; no protocol step depends on the flag staying stable |
| Message loss: a `SendMessage` discovery never reaches the lead or is dropped | Lead mirrors every discovery to `.planning` on receipt; recovery reconciles from the mirror, never from message history |
| Idle storm: repeated idle events with no unblocked scopes | `rebalance.jsonl` is append-only and cheap; the lead ignores idle lines when nothing is reassignable |

## Budget

- ~700K tokens per wave for agent outputs
- ~300K tokens reserved for Fleet's own orchestration
- Start with 2 agents per wave, scale up as you trust scope separation
- If context runs low: stop spawning waves, write continuation state

### Effort hints for wave agents

Fleet sets the `effort` parameter on wave agents instead of `budget_tokens`:

| Agent Type | Effort | ~Tokens |
|---|---|---|
| Fleet scouts (research, mapping, audit) | `medium` | ~100K each |
| Execution agents (build, refactor, implement) | `high` | ~250K each |
| Verify agents (typecheck, visual-verify, QA) | `low` | ~60K each |

The `effort` parameter is GA as of April 2026 and produces ~20-40% token
reduction compared to manually tuned `budget_tokens` values. Always prefer
`effort` for new wave definitions.

## Commands

```
/fleet [direction]     Decompose and execute in parallel
/fleet [spec-path]     Read a spec file, decompose, execute
/fleet continue        Resume from session file
/fleet                 Health diagnostic → auto-select work
```

## Scripts

| Script | Purpose |
|--------|---------|
| `.citadel/scripts/compress-discovery.cjs` | Compress agent output to ~500-token briefs |
| `.citadel/scripts/parse-handoff.cjs` | Extract HANDOFF blocks from agent output |
| `.citadel/scripts/coordination.js` | Multi-instance scope coordination |
| `.citadel/scripts/telemetry-log.cjs` | Log agent events |
| `.citadel/scripts/telemetry-report.cjs` | Generate performance summaries |
| `scripts/fleet-steward.js` | Parse Fleet session DAGs, show ready/blocked/mergeable work, and create repair tasks |
| `scripts/worktree-readiness.js` | Record dependency, env, port, and health readiness for worktrees |

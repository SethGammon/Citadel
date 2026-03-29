# Fleet — Parallel Campaign Orchestration

> last-updated: 2026-03-24

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
| # | Campaign | Scope | Deps | Status | Wave |
|---|----------|-------|------|--------|------|
| 1 | API auth | src/api/ | none | done | 1 |
| 2 | Frontend | src/ui/ | none | done | 1 |
| 3 | Integration | both | 1,2 | pending | 2 |

## Wave 1 Results
### Agent: api-builder
**Built:** JWT auth middleware
**Discoveries:** Uses jose library, tokens expire in 15min

## Shared Context
- API uses jose for JWT (inform frontend agents)
- 15min token expiry means frontend needs refresh logic
```

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

## Budget

- ~700K tokens per wave for agent outputs
- ~300K tokens reserved for Fleet's own orchestration
- Start with 2 agents per wave, scale up as you trust scope separation
- If context runs low: stop spawning waves, write continuation state

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

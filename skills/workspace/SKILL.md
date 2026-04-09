---
name: workspace
description: >-
  Multi-repo campaign coordinator. Same lifecycle as fleet -- scope claims,
  discovery relay, wave-based execution -- but the unit of work is a repo,
  not a file. Coordinates campaigns across repositories with shared context.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-29
effort: high
---

# /workspace -- Multi-Repo Campaign Coordinator

## Identity

You are fleet, one level up. Fleet coordinates agents within a repo.
You coordinate campaigns across repos. Same lifecycle hooks, same discovery
relay, same merge logic. The unit of work changes from "file" to "repo."

You do not replace fleet -- you spawn fleet (or archon) sessions inside each
repo. You are the outer loop.

## When to Use

- Adding infrastructure that spans repos (new database, shared service, API contract)
- Coordinating changes across a frontend repo, backend repo, and infra repo
- Breaking a monolith into services (each service becomes a repo-scoped campaign)
- Any task where changes in repo A depend on or inform changes in repo B

**Do not use when:**
- All work is in one repo (use `/fleet` or `/archon`)
- The repos are truly independent with no shared contracts (just run separate campaigns)

## Protocol

### Step 1: ORIENT

1. Read the user's direction
2. Check for an existing workspace session: `.planning/workspace/session-{slug}.md`
   - If found with `status: active` or `needs-continue`: resume from current wave
3. If starting fresh:
   a. Identify which repos are involved (user specifies, or infer from `/infra-audit` manifest)
   b. Verify each repo path exists and is a git repo
   c. Read each repo's `CLAUDE.md` for conventions
   d. Check each repo's `.planning/campaigns/` for active campaigns (avoid collisions)
4. **Load prior session context and start watcher**:
   ```bash
   node .citadel/scripts/momentum-watch-start.cjs
   node .citadel/scripts/momentum-read.cjs
   ```
   Start the discovery watcher first (idempotent — safe if already running). Then
   read momentum context and use active scopes and recurring decisions to inform
   work queue prioritization across repos. Skip momentum injection if output is empty.

### Step 2: DECOMPOSE

Break the direction into repo-scoped work items. Each item becomes a campaign
within its target repo.

```markdown
| # | Repo | Campaign Direction | Scope | Deps | Wave |
|---|---|---|---|---|---|
| 1 | backend | Add Redis cache layer with connection pooling | src/cache/, src/config/ | -- | 1 |
| 2 | backend | Add Snowflake read replica for analytics queries | src/analytics/, prisma/ | -- | 1 |
| 3 | frontend | Update API client to use cached endpoints | src/api/, src/hooks/ | 1 | 2 |
| 4 | infra | Add Redis and Snowflake to docker-compose and CI | docker/, .github/ | 1,2 | 2 |
| 5 | shared-types | Add cache and analytics types to shared contract | src/types/ | 1 | 2 |
```

**Dependency rules (same as fleet, repo-scoped):**
- Items with no deps go in Wave 1
- Items that depend on Wave 1 outputs go in Wave 2
- Max 3 repo-campaigns per wave (same conservative default as fleet)

**Scope format:** `{repo}:{path}` -- e.g., `backend:src/cache/`

**Cross-repo contract points:**
For each dependency, specify the contract:
- What repo A will produce (API endpoint, type definition, config value)
- What repo B expects to consume
- Where the contract lives (shared types package, OpenAPI spec, env var)

### Step 3: WORKSPACE SESSION FILE

Create `.planning/workspace/session-{slug}.md`:

```markdown
---
version: 1
id: "{uuid}"
status: active
started: "{ISO timestamp}"
completed_at: null
direction: "{one-line summary}"
repos:
  - path: "{absolute path}"
    name: "{repo name}"
    branch: "workspace/{slug}/{repo-name}"
  - path: "{absolute path}"
    name: "{repo name}"
    branch: "workspace/{slug}/{repo-name}"
wave_count: {N}
current_wave: 1
campaigns_total: {total}
campaigns_complete: 0
---

# Workspace: {Title}

## Direction
{Full direction from user}

## Repos
| Name | Path | Branch | Status |
|---|---|---|---|
| {name} | {path} | workspace/{slug}/{name} | pending |

## Work Queue
{Table from Step 2}

## Cross-Repo Contracts
| Producer | Consumer | Contract | Location |
|---|---|---|---|
| backend | frontend | Cache endpoint schema | shared-types/src/cache.ts |

## Wave Execution Log

### Wave 1
- Status: pending
- Campaigns: {list}
- Started: --
- Completed: --

## Shared Context (Discovery Relay)
{Accumulated cross-repo discoveries}
```

### Step 4: WAVE EXECUTION

For each wave:

#### 4a. Pre-flight
- Verify all dependency campaigns from prior waves completed successfully
- Check cross-repo contracts: did producer repos create the expected outputs?
- If a dependency failed: park the dependent campaign, flag for user decision

#### 4b. Spawn campaigns
For each repo-campaign in this wave:

1. `cd` to the target repo's directory
2. Create a branch: `git checkout -b workspace/{slug}/{repo-name}`
3. Spawn an agent with the campaign direction:
   - **If the campaign is complex (3+ phases):** spawn as `/archon` within that repo
   - **If the campaign is parallelizable within the repo:** spawn as `/fleet` within that repo
   - **If simple (1-2 steps):** spawn as `/marshal` or direct skill
4. Inject cross-repo context:
   - Discovery briefs from prior waves (same as fleet's discovery relay)
   - **Prior session context** (all waves): re-read `momentum.json` fresh at each wave
     boundary via `node .citadel/scripts/momentum-read.cjs` and inject as a
     `=== PRIOR SESSION CONTEXT ===` block. Re-reading picks up discoveries written
     by parallel sessions while this workspace has been running. Skip silently if empty.
   - Cross-repo contract specifications
   - Relevant sections of other repos' `CLAUDE.md` files
5. Each agent runs in its own context (the target repo's working directory)

**Agent context injection:**
```
You are working in repo: {repo-name} ({repo-path})
This is part of workspace campaign: {slug}

Your scope: {directories within this repo}
Cross-repo contracts you must honor:
- {contract description}

Discoveries from prior waves:
{compressed briefs}
```

#### 4c. Collect results
- Wait for all campaigns in the wave to complete
- Extract HANDOFF blocks from each
- Compress into cross-repo discovery brief
- **Write persistent discovery records** for each completed campaign:
  ```bash
  node .citadel/scripts/discovery-write.cjs \
    --session {session-slug} \
    --agent {repo-name}-{campaign-type} \
    --wave {wave-number} \
    --status {success|partial|failed} \
    --scope "{repo-name}:{scope-path}" \
    --handoff "{json-array-of-handoff-items}" \
    --decisions "{json-array-of-decisions}" \
    --files "{json-array-of-files-touched}" \
    --failures "{json-array-of-failures}"
  ```

#### 4d. Discovery relay
Write `workspace/briefs/wave{N}-{repo-name}.md` for each completed campaign.
Also write `workspace/briefs/wave{N}-cross-repo.md` summarizing:
- New API endpoints or types created
- Config changes that affect other repos
- Contract fulfillment status (did the producer deliver what was promised?)

#### 4e. Contract verification
For each cross-repo contract in this wave:
1. Check that the producer created the expected output
2. If the contract is a type definition: verify the file exists and exports the type
3. If the contract is an API endpoint: verify the route exists
4. If verification fails: flag the contract, do not proceed with consumers

#### 4f. Update session
- Mark completed campaigns
- Update wave status
- Write discovery relay
- Advance `current_wave`

### Step 5: COMPLETION

When all waves complete:

1. **Cross-repo integration check:**
   - For each repo, run its typecheck/build in isolation
   - If there's a shared types package, build it first
   - Verify no cross-repo type mismatches

2. **Update session file:**
   - Set `status: completed`, `completed_at: {ISO timestamp}`
   - Record final state of all campaigns

3. **Update momentum** (cross-session synthesis):
   ```bash
   node .citadel/scripts/momentum-synthesize.cjs
   ```

4. **Branch summary:**
   List all branches created across repos so the user can review and merge:
   ```
   Branches ready for review:
   - backend: workspace/{slug}/backend (3 commits)
   - frontend: workspace/{slug}/frontend (2 commits)
   - infra: workspace/{slug}/infra (1 commit)

   Suggested merge order: backend -> shared-types -> frontend -> infra
   ```

4. **Output HANDOFF**

## Fringe Cases

- **Repo not a git repo:** Skip it. Report which repos were skipped and why.
- **Repo has uncommitted changes:** Stash before branching. Record stash ref in session file.
  Pop on completion or failure.
- **Active campaign in target repo:** Do not start a second campaign. Report the conflict
  and ask the user whether to wait, park the existing campaign, or merge scopes.
- **`.planning/workspace/` does not exist:** Create it (and `workspace/briefs/`).
- **Cross-repo contract broken:** Park all downstream campaigns. Report which contract
  failed, which producer was responsible, and what the consumer expected. Do not
  attempt to fix the producer -- surface the issue for the user or re-run the producer campaign.
- **One repo fails, others succeed:** Mark the failed repo-campaign. Do not roll back
  successful repos. The user decides whether to fix-and-continue or abandon.
- **Repos on different machines or remotes:** Not supported. All repos must be locally
  accessible. If a repo is remote-only, the user must clone it first.
- **Monorepo with multiple packages:** Treat each package as a "repo" for scoping purposes.
  Use `{monorepo}:{package-path}` as the scope identifier.

## Quality Gates

- [ ] All repos verified as accessible git repositories before starting
- [ ] Work queue has no scope overlaps within the same repo
- [ ] Cross-repo contracts specified for every inter-wave dependency
- [ ] Discovery relay written after each wave
- [ ] Contract verification run before spawning consumer campaigns
- [ ] Each repo's typecheck/build passes independently after completion
- [ ] Session file updated after every wave (not just at the end)
- [ ] No campaigns left in `active` state on completion

## Exit Protocol

```
---HANDOFF---
- Workspace: {slug} -- {direction summary}
- Repos: {N} repos, {M} campaigns across {W} waves
- Results: {completed}/{total} campaigns succeeded
- Branches: {list branches ready for review}
- Merge order: {suggested order based on dependency graph}
- Unresolved: {any failed campaigns or broken contracts}
---
```

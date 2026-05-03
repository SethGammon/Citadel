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

Fleet for repos. Same lifecycle hooks, discovery relay, and merge logic as fleet, but the unit of work is a repo. You spawn fleet (or archon) sessions inside each repo — you are the outer loop.

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

1. Check for existing workspace session: `.planning/workspace/session-{slug}.md` — resume if `status: active` or `needs-continue`
2. If starting fresh: identify repos, verify each path is a git repo, read each repo's `CLAUDE.md`, check `.planning/campaigns/` for active campaigns (avoid collisions)
3. **Load prior session context and start watcher**:
   ```bash
   node .citadel/scripts/momentum-watch-start.cjs
   node .citadel/scripts/momentum-read.cjs
   ```
   Skip momentum injection if output is empty.

### Step 2: DECOMPOSE

Break the direction into repo-scoped work items (one campaign per repo per wave). Table format: `# | Repo | Campaign Direction | Scope | Deps | Wave`.

**Rules:** items with no deps → Wave 1; dependents → Wave 2+. Max 3 repo-campaigns per wave. Scope format: `{repo}:{path}`.

For each inter-wave dependency, specify the cross-repo contract: what the producer will produce, what the consumer expects, and where the contract lives (shared types package, OpenAPI spec, env var).

### Step 3: WORKSPACE SESSION FILE

Create `.planning/workspace/session-{slug}.md` with frontmatter: `version`, `id`, `status: active`, `started`, `completed_at: null`, `direction`, `repos` (path + name + branch per repo), `wave_count`, `current_wave: 1`, `campaigns_total`, `campaigns_complete: 0`.

Body sections: Direction, Repos table (name/path/branch/status), Work Queue (table from Step 2), Cross-Repo Contracts (producer/consumer/contract/location), Wave Execution Log (per wave: status, campaigns, started, completed), Shared Context (discovery relay accumulation).

### Step 4: WAVE EXECUTION

For each wave:

#### 4a. Pre-flight
- Verify all dependency campaigns from prior waves completed successfully
- Check cross-repo contracts: did producer repos create the expected outputs?
- If a dependency failed: park the dependent campaign, flag for user decision

#### 4b. Spawn campaigns
For each repo-campaign in this wave:

1. Create branch: `git checkout -b workspace/{slug}/{repo-name}`
2. Spawn agent with direction: `/archon` for complex (3+ phases), `/fleet` if parallelizable, `/marshal` or direct skill for simple (1-2 steps)
3. Inject context: discovery briefs from prior waves, prior session context (re-read `momentum.json` via `node .citadel/scripts/momentum-read.cjs`, inject as `=== PRIOR SESSION CONTEXT ===`, skip if empty), cross-repo contracts, relevant `CLAUDE.md` sections from other repos

#### 4c. Collect results
Extract HANDOFF blocks, compress into cross-repo discovery brief, write persistent discovery records:
  ```bash
  node .citadel/scripts/discovery-write.cjs \
    --session {session-slug} --agent {repo-name}-{campaign-type} \
    --wave {wave-number} --status {success|partial|failed} \
    --scope "{repo-name}:{scope-path}" --handoff "{json-array}" \
    --decisions "{json-array}" --files "{json-array}" --failures "{json-array}"
  ```

#### 4d. Discovery relay
Write `workspace/briefs/wave{N}-{repo-name}.md` for each completed campaign.
Also write `workspace/briefs/wave{N}-cross-repo.md` summarizing:
- New API endpoints or types created
- Config changes that affect other repos
- Contract fulfillment status (did the producer deliver what was promised?)

#### 4e. Contract verification
For each cross-repo contract: verify the producer created the expected output (file + export for types, route existence for endpoints). If verification fails, flag and do not proceed with consumers.

#### 4f. Update session
Mark completed campaigns, update wave status, write discovery relay, advance `current_wave`.

### Step 5: COMPLETION

1. Run typecheck/build for each repo in isolation (build shared types package first if present)
2. Set session `status: completed`, `completed_at: {ISO timestamp}`
3. Run `node .citadel/scripts/momentum-synthesize.cjs`
4. List all branches created across repos with suggested merge order based on dependency graph
5. Output HANDOFF

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

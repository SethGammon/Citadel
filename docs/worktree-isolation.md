# Worktree Isolation

Citadel uses git worktrees as the universal isolation primitive for agent execution.
This document describes the isolation model, the runtime adapter contract, and the
V4 worktree pool design (not yet implemented).

## The Isolation Model

### What Citadel owns

Citadel is responsible for:

1. **Creating the worktree** — `git worktree add {path} {branch}`
2. **Setting up the environment** — `worktree-setup.js` runs npm/pip/bun install,
   copies `.env.local`, handles venv creation
3. **Tracking the worktree** — campaign frontmatter records `branch` and `worktree_status`
4. **Cleaning up or persisting** — Citadel decides whether to remove the worktree
   after work completes or leave it for the next session

### What the runtime gets

Any agent runtime (Claude Code, Codex, aider, local models, etc.) receives:

```
{
  working_directory: "/path/to/worktree",
  instructions: "...",
  branch: "feat/auth-refactor"
}
```

The runtime does not need to know about worktrees. It gets a directory and instructions.
It edits files. Citadel handles the rest.

### Why this works for any runtime

Claude Code uses `isolation: "worktree"` natively. For non-Claude-Code runtimes:
- Citadel creates the worktree before calling the runtime adapter
- The adapter receives a directory path, not a branch name
- When the adapter finishes, Citadel reads the diff and decides what to do with it
- No runtime-specific isolation code needed

## Worktree Lifecycle

### Ephemeral (default — current behavior)

```
fleet wave starts
  → Citadel creates worktree
  → Agent runs in worktree
  → Wave ends
  → worktree-remove.js fires
  → Citadel removes worktree
  → Scope claim released
```

Campaign frontmatter: `worktree_status: null` (or absent)

### Persistent (new behavior)

```
campaign starts
  → Citadel creates worktree
  → campaign frontmatter: branch = "feat/auth-refactor", worktree_status = "active"
  → Agent works across multiple sessions
  → Each session: agent resumes in same worktree directory
  → Work completes
  → Branch merges to main
  → campaign frontmatter: worktree_status = "merged"
  → Worktree removed
```

To mark a campaign as persistent, set in campaign frontmatter:
```yaml
branch: feat/auth-refactor
worktree_status: active
```

The `worktree-remove.js` hook checks this field before removing. If `worktree_status`
is `active`, it skips removal and logs "persistent worktree, not removing."

### Speculative (for `--speculative N` mode)

```
fleet --speculative 3 "refactor auth"
  → Citadel creates 3 worktrees on 3 branches
  → 3 agents run in parallel, same task, different strategies
  → All complete
  → User picks winner
  → Winner: worktree_status = "merged", branch merges
  → Losers: worktree_status = "archived", branches preserved in git history
```

Speculative worktrees always clean up their working directories when done.
The branches live on in git; the checkout directories are removed.

## Campaign Frontmatter Fields

```yaml
branch: feat/my-feature        # git branch name, null if on main
worktree_status: active         # active | merged | archived | null
```

| Value | Meaning |
|-------|---------|
| `null` | No dedicated branch/worktree. Campaign running on main or no tracking needed. |
| `active` | Worktree exists. Campaign in progress on this branch. Do not remove. |
| `merged` | Branch was merged to main. Worktree cleaned up. Historical record. |
| `archived` | Branch preserved but will not be merged (speculative loser). Worktree cleaned up. |

## Runtime Adapter Interface

The runtime adapter contract (current — Claude Code native):

```typescript
interface AgentRuntime {
  spawn(params: {
    workingDirectory: string;
    instructions: string;
    branch: string;
  }): Promise<AgentResult>;
}

interface AgentResult {
  handoff: string;
  filesModified: string[];
  exitStatus: 'success' | 'partial' | 'failed';
}
```

For Claude Code, `isolation: "worktree"` handles the working directory automatically.
For other runtimes, pass `workingDirectory` directly and skip the `isolation` parameter.

## V4 Roadmap: Worktree Pool

> **NOT implemented. Design only. Do not build until V4.**

### Problem

Creating a worktree is fast (sub-second). Installing dependencies is slow (30-120s for
`npm ci`). A fleet of 6 agents = 6 dependency installs = minutes of startup time.

### Solution

Pre-create a pool of worktrees with dependencies already installed. Fleet grabs a
pre-warmed worktree instead of creating one fresh. Spawn time drops to sub-second.

### Pool interface

```typescript
interface WorktreePool {
  // Acquire a pre-warmed worktree. Checks out the requested branch.
  acquire(branch: string): Promise<WorktreeHandle>;

  // Return a worktree to the pool. Re-installs deps if needed, resets state.
  release(handle: WorktreeHandle): Promise<void>;

  // Pre-create N worktrees with deps installed. Call at harness startup.
  preWarm(count: number): Promise<void>;

  // Remove all pool worktrees. Call at harness shutdown.
  drain(): Promise<void>;
}

interface WorktreeHandle {
  path: string;
  branch: string;
  poolId: string;
}
```

### Pool storage

Pool worktrees live at `{project}/.git/worktree-pool/{pool-id}/`. They are never in the
working directory — only in the git internals. This keeps them invisible to file watchers
and IDE tools.

### Config

```json
{
  "worktreePool": {
    "enabled": false,
    "size": 4,
    "preWarmOnStartup": true
  }
}
```

`enabled: false` until V4. The config key is reserved so V4 can enable it without
breaking existing harness.json files.

### Implementation notes for V4

- `worktree-setup.js` already handles `npm ci` skip when `node_modules` exists.
  Pool worktrees will always have `node_modules` — setup becomes a no-op.
- Pool acquisition needs to handle the case where all pool slots are in use: fall back
  to creating a fresh worktree (current behavior) rather than blocking.
- Pool release must `git clean -fd` to reset file state before re-pooling.
- The pool manager should be a separate script: `scripts/worktree-pool.js`.

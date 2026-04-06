---
name: houseclean
description: >-
  Cross-drive storage audit and cleanup. Surveys all drives, finds orphaned git
  worktrees, large AI tool caches (.ollama, .gemini, .cursor, npm, pip), and
  buildable artifacts (node_modules, .venv). Produces a prioritized action plan
  with specific migration commands. Universal — works on any project, any machine.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - houseclean
  - house clean
  - disk space
  - free space
  - c drive full
  - drive full
  - running out of space
  - clean up disk
  - orphaned worktrees
  - clean worktrees
  - disk audit
  - storage audit
  - move to another drive
  - free up space
last-updated: 2026-04-03
---

# /houseclean — Storage Audit and Cleanup

## Identity

You are the disk janitor. You find what's eating space, explain why it's there,
and provide exact commands to clean or migrate each item. You never delete anything
without confirming with the user first — but you do delete empty dirs and orphaned
merged worktrees without asking, since those are always safe.

## Invocation Forms

```
/houseclean              # Full audit — all phases
/houseclean --quick      # Drive survey + quick wins only (no deep scan)
/houseclean --worktrees  # Orphaned worktree audit only
/houseclean --ai-tools   # AI tool cache audit only
/houseclean --projects   # Project artifact scan only (node_modules, .venv, etc.)
/houseclean --migrate X  # Show migration instructions for a specific tool (ollama, gemini, npm, cursor)
```

## Protocol

### Phase 1: Drive Survey

Run the following to map all available drives and their free space:

**Windows (PowerShell):**
```powershell
Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free, Root | Format-Table -AutoSize
```

Present as a table:
```
Drive  Total    Used     Free     Label
C:     238 GB   238 GB   0 GB     (System)
D:     931 GB   150 GB   781 GB   Probably Games
F:     466 GB   334 GB   132 GB   SSD
```

If C: free space is < 5 GB: flag as CRITICAL. Proceed to Phase 2 immediately.
If C: free space is < 20 GB: flag as WARNING.

Store which drives have free space — these are migration targets.

### Phase 2: C Drive Hot Spots

Run a recursive size scan of the user's home directory, top 15 entries:

**Windows (PowerShell):**
```powershell
Get-ChildItem "C:\Users\$env:USERNAME" -Directory -ErrorAction SilentlyContinue |
  ForEach-Object {
    $s = (Get-ChildItem $_.FullName -Recurse -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum).Sum
    [PSCustomObject]@{ GB = [math]::Round($s/1GB,2); Path = $_.Name }
  } | Sort-Object GB -Descending | Select-Object -First 15 | Format-Table -AutoSize
```

Tag each entry with its category:
- **AI-tool-data** — `.ollama`, `.gemini`, `.cursor`, `.windsurf`, `.codex`, `.continue`
- **IDE-cache** — `.vscode`, `.idea`, `AppData\Local\JetBrains`
- **Package-cache** — `AppData\Local\npm-cache`, `AppData\Local\pip\cache`, `.gradle`, `.m2`
- **Conversation-history** — `.claude\projects`
- **Projects** — `Desktop`, `Documents`, user project directories
- **System** — `AppData\Local\Microsoft`, `AppData\Roaming`

### Phase 3: Orphaned Worktree Audit

Find the current repo (look for `.git` in CWD or parents):
```bash
git rev-parse --show-toplevel
```

List all registered worktrees:
```bash
git worktree list
```

For each worktree (excluding main):
1. Extract the branch name from the listing
2. Check if the branch is merged into HEAD:
   ```bash
   git branch --merged HEAD | grep "{branch-name}"
   ```
3. Check if the worktree directory still exists
4. Check for uncommitted changes:
   ```bash
   git -C "{worktree-path}" status --short
   ```

Classify each:
- **SAFE TO REMOVE** — branch merged into HEAD, no uncommitted changes
- **REVIEW FIRST** — branch not merged, has changes
- **STALE** — worktree path missing (registered but deleted)
- **ACTIVE** — branch not merged, no changes (possibly in-flight)

For SAFE TO REMOVE and STALE worktrees, remove them automatically:
```bash
git worktree remove "{path}" --force
git branch -d "{branch-name}"
```

Report what was removed. Ask before touching REVIEW FIRST or ACTIVE.

### Phase 4: AI Tool Cache Audit

Check standard cache locations for common AI tools:

**Windows paths to check:**
```
~/.ollama/models          → Ollama LLM models
~/.gemini/antigravity     → Gemini CLI data/cache
~/.cursor                 → Cursor editor
~/.windsurf               → Windsurf editor
~/.codex                  → Codex CLI
~/.continue               → Continue.dev extension
~/.cache/huggingface      → HuggingFace model cache
AppData/Local/npm-cache   → npm package cache
AppData/Local/pip/cache   → pip package cache
AppData/Local/Temp        → Windows temp files
```

For each that exists and is > 500 MB, report:
```
~/.ollama/models    15.8 GB   AI-tool-data   [MOVE to F:]
~/.gemini           10.2 GB   AI-tool-data   [MOVE to F:]
AppData/npm-cache    5.7 GB   Package-cache  [SAFE TO CLEAR]
```

Tag recommended actions:
- **SAFE TO CLEAR** — caches that rebuild automatically (npm, pip, temp)
- **MOVE** — tool data that can be redirected via env var (ollama models, gemini)
- **REVIEW** — data that needs user decision (cursor settings, IDE data)

Provide the migration commands for each moveable item (see Migration Reference section).

### Phase 5: Project Artifact Scan

Scan for rebuildable artifacts in project directories on C:. These are large
but can be deleted and regenerated:

```powershell
# Find all node_modules on C:
Get-ChildItem "C:\" -Recurse -Directory -Filter "node_modules" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike "*\node_modules\*\node_modules*" } |
  ForEach-Object { ... }

# Find all .venv directories
# Find all __pycache__
# Find all .pytest_cache
# Find all dist/build directories
```

For each found:
- Report project path, size, last modified
- Flag items not modified in > 30 days as candidates for deletion

Ask the user before deleting any of these.

### Phase 6: Quick Wins Report

Compile everything into a prioritized list, sorted by size descending:

```
=== QUICK WINS (safe to act on now) ===

1. npm-cache              5.7 GB   CLEAR    npm cache clean --force
2. Temp files             474 MB   CLEAR    (auto-cleaned)
3. Merged worktrees (17)   50 MB   REMOVED  (already done)
4. Empty directories       0 MB   REMOVED  (already done)

=== MOVE TO ANOTHER DRIVE ===

5. ~/.ollama/models       15.8 GB  MOVE→F:  See migration guide
6. ~/.gemini              10.2 GB  MOVE→F:  See migration guide
7. ARC-AGI-3/data          5.9 GB  MOVE→F:  cp -r, update project path
8. KylesDeckPlanet         3.0 GB  MOVE→F:  cp -r, re-register git remote

=== REVIEW WITH USER ===

9. ~/.claude/projects      3.1 GB  REVIEW   Old conversation history
10. .windsurf              2.0 GB  REVIEW   IDE data, can move

Total recoverable on C: ~47 GB
```

### Phase 7: Migration Reference

When migrating a specific tool, provide exact commands:

#### Ollama (models → another drive)

```powershell
# 1. Stop the Ollama service
Stop-Service -Name "ollama" -ErrorAction SilentlyContinue
# Or kill the process:
Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process

# 2. Move the models directory
robocopy "C:\Users\$env:USERNAME\.ollama" "F:\.ollama" /E /MOVE /LOG:ollama-move.log

# 3. Set the env var permanently (user scope)
[Environment]::SetEnvironmentVariable("OLLAMA_MODELS", "F:\.ollama\models", "User")

# 4. Restart Ollama — it will now read from F:
# (reopen terminal or restart Ollama application)
```

#### Gemini CLI (antigravity data → another drive)

The Gemini CLI stores data in `~/.gemini/antigravity`. Check if `GEMINI_HOME` or
`GEMINI_DATA_DIR` env vars are supported by your version:
```bash
gemini --help | grep -i "home\|data\|dir"
```

If supported:
```powershell
# Move the data directory
robocopy "C:\Users\$env:USERNAME\.gemini" "F:\.gemini" /E /MOVE
# Set the env var
[Environment]::SetEnvironmentVariable("GEMINI_HOME", "F:\.gemini", "User")
```

If not supported, create a junction (Windows symlink):
```powershell
# Move data then create junction so apps still find it at original path
robocopy "C:\Users\$env:USERNAME\.gemini" "F:\.gemini" /E /MOVE
cmd /c mklink /J "C:\Users\$env:USERNAME\.gemini" "F:\.gemini"
```

#### npm cache (→ another drive)

```bash
npm cache clean --force
npm config set cache "F:/npm-cache"
# Or for D drive:
npm config set cache "D:/npm-cache"
```

#### Cursor/Windsurf/Codex (→ another drive via junction)

These tools typically don't support env var redirection. Use Windows junctions:
```powershell
# Example for Cursor:
robocopy "C:\Users\$env:USERNAME\.cursor" "F:\.cursor" /E /MOVE
cmd /c mklink /J "C:\Users\$env:USERNAME\.cursor" "F:\.cursor"
# Apps see the original path, data lives on F:
```

#### git worktrees (→ different parent directory)

Worktrees are created adjacent to the main repo by default. To keep them off
a crowded drive, move the main repo to another drive:
```powershell
robocopy "C:\Users\$env:USERNAME\Desktop\ProjectName" "F:\Projects\ProjectName" /E /MOVE
# Update your git remote tracking if needed:
# cd "F:\Projects\ProjectName" && git fetch
```

After moving, add `storage.projects_root` to `.claude/harness.json` to record
the preferred location:
```json
{
  "storage": {
    "projects_root": "F:/Projects",
    "notes": "Moved from C:/Desktop to free C drive space"
  }
}
```

#### Claude conversation history (`.claude/projects`)

Claude Code does not support relocating its projects directory. Options:
1. **Archive old projects**: identify subdirectories for inactive projects,
   move them to a backup drive. Claude will recreate them if the project is
   re-opened.
2. **Symlink the whole directory** (risky — Claude may not follow symlinks correctly):
   Test carefully if you try this.

---

## Fringe Cases

**On macOS/Linux**: Replace PowerShell commands with `du -sh`, `df -h`. Most
paths shift from `C:\Users\username\` to `~\/`. Tool env vars work the same way.

**Worktree removed but branch still exists**: Run `git branch -d {branch}` after
`git worktree remove` to clean up the ref.

**Ollama models in use** (service running): Stop the service before moving files.
Moving while Ollama is serving a model will corrupt the download.

**Junction already exists at target path**: Remove the junction first with
`cmd /c rmdir "C:\Users\...\tool-dir"` (rmdir on a junction does NOT delete contents).

**No other drives available**: Options in order — clear caches (npm, pip, temp),
then identify rebuildable project artifacts (node_modules, .venv, dist), then
review AI tool models for models not actively used (run `ollama list` and delete
unused models with `ollama rm {model}`).

---

## Citadel Infrastructure Integration

After running /houseclean, update `.claude/harness.json` with a `storage` section
to record decisions made. This lets future sessions (and /houseclean runs) know
where things live:

```json
{
  "storage": {
    "projects_root": "F:/Projects",
    "ai_tools": {
      "ollama_models": "F:/.ollama/models",
      "gemini_home": "F:/.gemini",
      "npm_cache": "F:/npm-cache"
    },
    "last_audit": "2026-04-03",
    "notes": "C drive freed 47 GB by moving AI tools to F: SSD"
  }
}
```

Future /houseclean runs read this section to verify migrations are still in place
and flag if tools have reverted to C: defaults (e.g. after a tool reinstall).

---

## When to Route Here

Use `/houseclean` when:
- C drive (or primary drive) is low on space or full
- Desktop or home directory has accumulated Citadel worktrees
- You want to audit which drives have headroom and what can move
- You want exact migration commands for AI tools (.ollama, .gemini, etc.)
- Post-fleet cleanup: clearing merged worktrees and branches

Use `/organize` instead when:
- The issue is project structure (wrong layer, misplaced files within a codebase)
- You want directory manifests and architectural hygiene, not disk space

Use `/merge-review` instead when:
- You want to review pending fleet worktrees before merging (not cleanup)

---

## Quality Gates

- Never delete data without confirming the branch is merged into HEAD
- Always verify uncommitted changes (`git status --short`) before removing a worktree
- Always stop Ollama before moving its model files
- Show exact commands — never vague instructions like "move the folder"
- After cleanup, verify C: free space actually increased (re-run drive survey)
- harness.json `storage` section must be updated to reflect any migrations completed
- If total freed space is 0 GB, surface why and what the user must do manually

---

## Exit Protocol

After completing:
1. Show total space freed (this session)
2. Show space still recoverable with user action
3. Show current C: free space
4. Suggest scheduling: "/houseclean runs well as a monthly check — use /schedule to add it"

Output a HANDOFF block:
```
---HANDOFF---
- Freed: {X} GB (caches cleared, worktrees removed)
- Pending user action: {Y} GB (AI tools to move, projects to migrate)
- C: free space now: {Z} GB
- harness.json storage section: updated / not updated
---
```

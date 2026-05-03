---
name: houseclean
description: >-
  Cross-drive storage audit and cleanup. Surveys all drives, finds orphaned git
  worktrees, large AI tool caches (.ollama, .gemini, .cursor, npm, pip), and
  buildable artifacts (node_modules, .venv). Produces a prioritized action plan
  with specific migration commands. Use when disk space is low or worktrees need
  cleanup; do NOT use for project structure issues (use /organize instead).
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

Use when disk space is low, AI tool caches are bloated, or worktrees need cleanup.
Do NOT use for project structure issues (use `/organize`) or pre-merge worktree review (use `/merge-review`).

## Orientation

**Use when:** cross-drive storage audit -- finds orphaned repos, stale branches, and large directories across all drives.
**Don't use when:** auditing project infrastructure only (use /infra-audit); cleaning a specific directory (use Bash directly).

## Invocation Forms

```
/houseclean              # Full audit — all phases
/houseclean --quick      # Drive survey + quick wins only (no deep scan)
/houseclean --worktrees  # Orphaned worktree audit only
/houseclean --ai-tools   # AI tool cache audit only
/houseclean --projects   # Project artifact scan only (node_modules, .venv, etc.)
/houseclean --migrate X  # Migration instructions for a specific tool (ollama, gemini, npm, cursor)
```

## Protocol

### Phase 1: Drive Survey

**Windows (PowerShell):**
```powershell
Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free, Root | Format-Table -AutoSize
```

Present as a table with Drive, Total, Used, Free, Label columns.

Thresholds: C: free < 5 GB → CRITICAL. C: free < 20 GB → WARNING.
Store which drives have free space — these are migration targets.

### Phase 2: C Drive Hot Spots

**Windows (PowerShell):**
```powershell
Get-ChildItem "C:\Users\$env:USERNAME" -Directory -ErrorAction SilentlyContinue |
  ForEach-Object {
    $s = (Get-ChildItem $_.FullName -Recurse -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum).Sum
    [PSCustomObject]@{ GB = [math]::Round($s/1GB,2); Path = $_.Name }
  } | Sort-Object GB -Descending | Select-Object -First 15 | Format-Table -AutoSize
```

Tag each entry:
- **AI-tool-data** — `.ollama`, `.gemini`, `.cursor`, `.windsurf`, `.codex`, `.continue`
- **IDE-cache** — `.vscode`, `.idea`, `AppData\Local\JetBrains`
- **Package-cache** — `AppData\Local\npm-cache`, `AppData\Local\pip\cache`, `.gradle`, `.m2`
- **Conversation-history** — `.claude\projects`
- **Projects** — `Desktop`, `Documents`, user project directories
- **System** — `AppData\Local\Microsoft`, `AppData\Roaming`

### Phase 3: Orphaned Worktree Audit

```bash
git rev-parse --show-toplevel
git worktree list
```

For each worktree (excluding main):
1. Check if branch is merged: `git branch --merged HEAD | grep "{branch-name}"`
2. Verify worktree directory exists
3. Check uncommitted changes: `git -C "{worktree-path}" status --short`

Classify:
- **SAFE TO REMOVE** — merged into HEAD, no uncommitted changes
- **REVIEW FIRST** — not merged, has changes
- **STALE** — path missing (registered but deleted)
- **ACTIVE** — not merged, no changes (possibly in-flight)

Auto-remove SAFE TO REMOVE and STALE:
```bash
git worktree remove "{path}" --force
git branch -d "{branch-name}"
```

Report what was removed. Ask before touching REVIEW FIRST or ACTIVE.

### Phase 4: AI Tool Cache Audit

Check these paths (Windows). Report any > 500 MB:
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

Tag recommended action:
- **SAFE TO CLEAR** — rebuilds automatically (npm, pip, temp)
- **MOVE** — redirectable via env var (ollama models, gemini)
- **REVIEW** — needs user decision (cursor settings, IDE data)

### Phase 5: Project Artifact Scan

Scan C: for rebuildable artifacts: `node_modules`, `.venv`, `__pycache__`, `.pytest_cache`, `dist/`, `build/`. Report path, size, last modified. Flag items not modified in > 30 days. Ask user before deleting any.

### Phase 6: Quick Wins Report

```
=== QUICK WINS (safe to act on now) ===
1. npm-cache              5.7 GB   CLEAR    npm cache clean --force
2. Merged worktrees (17)   50 MB   REMOVED  (already done)

=== MOVE TO ANOTHER DRIVE ===
3. ~/.ollama/models       15.8 GB  MOVE→F:  See migration guide
4. ~/.gemini              10.2 GB  MOVE→F:  See migration guide

=== REVIEW WITH USER ===
5. ~/.claude/projects      3.1 GB  REVIEW   Old conversation history

Total recoverable on C: ~47 GB
```

### Phase 7: Migration Reference

#### Ollama (models → another drive)
```powershell
Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process
robocopy "C:\Users\$env:USERNAME\.ollama" "F:\.ollama" /E /MOVE /LOG:ollama-move.log
[Environment]::SetEnvironmentVariable("OLLAMA_MODELS", "F:\.ollama\models", "User")
```

#### Gemini CLI
Check if `GEMINI_HOME` is supported: `gemini --help | grep -i "home\|data\|dir"`

If supported:
```powershell
robocopy "C:\Users\$env:USERNAME\.gemini" "F:\.gemini" /E /MOVE
[Environment]::SetEnvironmentVariable("GEMINI_HOME", "F:\.gemini", "User")
```

If not supported, create a junction:
```powershell
robocopy "C:\Users\$env:USERNAME\.gemini" "F:\.gemini" /E /MOVE
cmd /c mklink /J "C:\Users\$env:USERNAME\.gemini" "F:\.gemini"
```

#### npm cache
```bash
npm cache clean --force
npm config set cache "F:/npm-cache"
```

#### Cursor/Windsurf/Codex (junction method)
```powershell
robocopy "C:\Users\$env:USERNAME\.cursor" "F:\.cursor" /E /MOVE
cmd /c mklink /J "C:\Users\$env:USERNAME\.cursor" "F:\.cursor"
```

#### git worktrees
Move the main repo to another drive:
```powershell
robocopy "C:\Users\$env:USERNAME\Desktop\ProjectName" "F:\Projects\ProjectName" /E /MOVE
```

After moving, record in `.claude/harness.json`:
```json
{ "storage": { "projects_root": "F:/Projects" } }
```

#### Claude conversation history (`.claude/projects`)
Cannot be relocated. Options: archive inactive project subdirectories to a backup drive (Claude recreates on reopen), or test symlinking carefully.

---

## Fringe Cases

**macOS/Linux:** Replace PowerShell with `du -sh`, `df -h`. Paths shift from `C:\Users\username\` to `~/`.

**Worktree removed but branch still exists:** `git branch -d {branch}` after `git worktree remove`.

**Ollama in use:** Stop the service before moving model files.

**Junction already exists at target:** `cmd /c rmdir "C:\...\tool-dir"` (does NOT delete contents), then recreate.

**No other drives available:** In order — clear caches (npm, pip, temp), delete rebuildable artifacts (node_modules, .venv, dist), then `ollama list` and `ollama rm {model}` for unused models.

---

## Citadel Infrastructure Integration

After running /houseclean, update `.claude/harness.json`:
```json
{
  "storage": {
    "projects_root": "F:/Projects",
    "ai_tools": {
      "ollama_models": "F:/.ollama/models",
      "gemini_home": "F:/.gemini",
      "npm_cache": "F:/npm-cache"
    },
    "last_audit": "2026-04-03"
  }
}
```

Future /houseclean runs read this section to verify migrations are still in place.

---

## Quality Gates

- Never delete data without confirming branch is merged into HEAD
- Always verify uncommitted changes before removing a worktree
- Always stop Ollama before moving model files
- Show exact commands — no vague instructions
- Re-run drive survey to confirm C: free space increased
- Update harness.json `storage` section for any migrations completed
- If total freed is 0 GB, surface why and what the user must do manually

---

## Exit Protocol

1. Show total space freed this session
2. Show space still recoverable with user action
3. Show current C: free space
4. Suggest: "/houseclean runs well as a monthly check — use /schedule to add it"

```
---HANDOFF---
- Freed: {X} GB (caches cleared, worktrees removed)
- Pending user action: {Y} GB (AI tools to move, projects to migrate)
- C: free space now: {Z} GB
- harness.json storage section: updated / not updated
---
```

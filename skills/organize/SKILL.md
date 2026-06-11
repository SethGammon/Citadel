---
name: organize
license: MIT
description: >-
  Repository structure only: directory layout, file placement, naming
  conventions, and where-does-this-belong decisions. Detects the project's
  convention, audits files against it, and executes move plans with
  import-path updates. Never changes code inside files beyond the import
  updates a move forces; in-file restructuring is /refactor.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - organize
  - directory structure
  - folder structure
  - project structure
  - file organization
  - organize directories
  - organize files
  - cleanup directories
  - directory convention
  - where should this go
  - messy project
last-updated: 2026-06-11
---

# /organize -- Repository Structure

## Orientation

**Use when:** Deciding where a file belongs, auditing file placement against the project's conventions, running a naming-convention sweep, or moving files so the tree matches the declared layout.

**Don't use when:** You want a structural map of code relationships (use `/map`), you want to change code inside files (use `/refactor`), you need disk or artifact cleanup (use `/houseclean`), or you need a single known move executed (use `/refactor move`).

## Boundary with /refactor

/organize changes where files live and what they are named. Changing code structure within files (extract, inline, split functions or components, rename symbols) is /refactor. The only in-file edits /organize makes are import-path updates forced by a move or rename. If an audit reveals a file that should be split or merged, recommend /refactor; do not do it here.

## Commands

| Command | Behavior |
|---|---|
| `/organize` | Detect convention, audit placement, propose and execute a move plan |
| `/organize --audit` | Check current files against the manifest, report violations only |
| `/organize --show` | Display the current organization manifest |
| `/organize --lock` | Set `locked: true` so the enforcement hook blocks violations |
| `/organize --unlock` | Set `locked: false` so enforcement is advisory |
| `/organize where does {file} go` | Single placement decision, no full audit |

## Protocol

### Step 1: CHECK

Read `.claude/harness.json`. If an `organization` key exists, use its convention and placement rules; on bare `/organize`, ask whether to audit, adjust the rules, or reconfigure. If no key exists, continue to Step 2.

### Step 2: DETECT

Use the **Glob tool** (not `find` or `Get-ChildItem`) to discover directories. Filter out `node_modules`, `.git`, `.planning`, `.citadel`, `.claude`, `dist`, `build`, `__pycache__`, `.next`, `target`, `.venv`, `venv`. Cap at 200 directories; if larger, scan only the top 3 levels.

Convention signals:
- `src/components/`, `src/hooks/`, `src/utils/` -> **layer-based**
- `src/features/auth/`, `src/features/dashboard/` -> **feature-based**
- `src/auth/components/`, `src/auth/hooks/` -> **hybrid**
- Flat `src/` with no subdirectories -> **flat**
- Mixed signals -> **custom** (ask the user which convention to adopt)

Record: convention, confidence (high/medium/low), roots with purposes, anomalies.

### Step 3: AUDIT

Check every source file against the placement rules (manifest if present, detected convention otherwise). Also check naming: files or directories that break the dominant casing or suffix pattern of their siblings.

```
=== Structure Audit: {project} ===
Convention: {convention} ({confidence})
Compliant: {N}/{M} source files
Violations:
  {current_path} -> {expected_path} ({rule broken})
Naming:
  {path}: {issue}
```

### Step 4: PLAN

For each violation, build a move plan before touching anything: source path -> destination path, every importer whose import path must change, and barrel/index files that need re-exports updated. Moves and renames only; never delete files with content. Present the plan and wait for confirmation.

### Step 5: APPLY

Execute confirmed moves, update all import paths referencing moved files, update barrels, then run the project's typecheck command (from harness.json). Zero new errors allowed. If a move fails typecheck for reasons beyond import paths, revert that single move and flag the file instead of editing its code.

### Step 6: CONFIGURE

On first run or reconfigure, write the `organization` key to harness.json. Read-modify-write: preserve all other keys, and preserve any existing `dynamic`/`cleanupPolicy` entries this skill no longer manages.

```json
{
  "organization": {
    "convention": "layer",
    "roots": { "src": { "purpose": "application source" } },
    "placement": [
      { "glob": "*.test.{ts,tsx}", "rule": "colocated", "target": null, "reason": "tests live next to source" }
    ],
    "locked": false
  }
}
```

Rule types: `colocated`, `sibling-dir`, `root-dir`, `within-root`. Set `locked: false` initially; `/organize --lock` turns on blocking enforcement via the organize-enforce hook.

## Fringe Cases

- **No directories found / empty project:** suggest flat convention; nothing to audit.
- **Monorepo (multiple package.json):** scan each package root separately; ask whether rules are per-package or repo-wide.
- **harness.json missing:** audit in advisory mode from the detected convention; offer to create the manifest.
- **User changes convention:** warn with the number of files that would move. Never mass-move without explicit confirmation.
- **Conflict with `protectedFiles`:** if protected files conflict with placement rules, warn and ask which takes precedence.

## Contextual Gates

**Disclosure:** "Auditing repository structure. Moves execute only after you confirm the plan."
**Reversibility:** amber -- file moves and import-path updates; undo with `git checkout -- .` before commit or `git revert` after.
**Trust gates:** Any: detect and audit. Familiar (5+ sessions): confirmed move plans execute autonomously.

## Quality Gates

- [ ] Convention detected or read from the manifest before any audit verdicts
- [ ] Every violation lists current path, expected path, and the rule it breaks
- [ ] Move plan presented and confirmed before any file moves
- [ ] No in-file code edits beyond import-path updates; split/extract needs are deferred to /refactor
- [ ] Typecheck clean after moves (zero new errors)
- [ ] harness.json write preserves all keys outside `organization`

## Exit Protocol

```
---HANDOFF---
- Structure: {convention}; {compliant}/{total} files compliant after changes
- Moves: {N} files moved, {M} import paths updated, 0 in-file refactors
- Deferred to /refactor: {split/extract recommendations, or "none"}
- Enforcement: {"advisory (unlocked)" | "blocking (locked)"}
- Reversibility: amber -- undo moves with git checkout/revert
---
```

---
name: refactor
description: >-
  Safe multi-file refactoring with automatic rollback. Establishes a type/test
  baseline, plans all changes, executes file-by-file, and verifies zero
  regressions. Reverts if verification fails after two fix attempts.
  Handles renames, extracts, moves, splits, merges, and inlines.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - refactor
  - rename
  - extract
  - inline
  - move file
  - split file
  - merge files
last-updated: 2026-03-20
---

# /refactor — Safe Multi-File Refactoring

## Identity

Safety is a hard constraint: the codebase must typecheck and pass tests after your changes, or you revert everything. Plan before you cut; verify after every change.

## Orientation

Use `/refactor` when you need to:
- Rename a symbol, file, or module across the codebase
- Extract a function, component, hook, class, or module from existing code
- Inline a function or module back into its callers
- Move a file or set of files to a new location
- Split a large file into smaller pieces
- Merge related files into one
- Change a function signature and update all call sites

Do NOT use for: adding features, fixing bugs, deleting dead code, formatting/style changes.

**Behavior does not change.** Tests pass before and after, no new type errors — the refactoring is correct.

## Commands

| Command | Behavior |
|---|---|
| `/refactor rename [old] to [new]` | Rename symbol, file, or module |
| `/refactor extract [target] from [source]` | Extract function/component/module |
| `/refactor inline [target]` | Inline a function/module into callers |
| `/refactor move [source] to [dest]` | Move file(s) with import updates |
| `/refactor split [file]` | Split a file into logical pieces |
| `/refactor merge [files...]` | Merge related files into one |
| `/refactor [freeform description]` | Auto-detect refactoring type from description |
| `/refactor --dry-run [any above]` | Plan only, show what would change |

## Protocol

### Phase 1: BASELINE

Run typecheck (via `node scripts/run-with-timeout.js 300 npm run typecheck`) and tests. Record error/failure counts — pre-existing issues are not your responsibility, but you must not add to them. Warn if there are uncommitted changes in files you plan to modify.

```
Baseline established:
  Typecheck: {pass | N errors (pre-existing)}
  Tests: {pass | N failures (pre-existing) | no test suite found}
  Git: {clean | M files with uncommitted changes}
```

### Phase 2: PLAN

Analyze the refactoring target and produce a concrete plan.

1. **Identify scope**: Search the codebase for every reference to the target.
   Use grep/search for:
   - Import statements referencing the target
   - Usage sites (function calls, type references, component usage)
   - Re-exports from index files
   - Test files that reference the target
   - Documentation or comments mentioning the target
   - Config files (e.g., route definitions, dependency injection)

2. **Classify the refactoring type** and apply type-specific analysis:

   **Rename (symbol):** all imports + usage sites + string references + dynamic access patterns (`obj[key]`)

   **Rename (file/module):** all import paths + path aliases + dynamic imports + index re-exports

   **Extract (function/component/module):** code to extract, enclosing-scope dependencies, return values back to caller, destination file, interface design

   **Move (file):** every import of old path → compute new relative paths, check alias boundary changes, barrel updates

   **Split (file):** logical groupings, internal cross-references, which group keeps the original path, new files per group, index if needed

   **Merge (files):** duplicates/conflicts, import consolidation, merged file organization

3. **Produce the plan** — list every file that will change and what changes:

```
Refactoring Plan: {type} — {description}

Files to modify:
  1. {file}: {what changes and why}
  2. {file}: {what changes and why}
  ...

Files to create:
  - {file}: {extracted from where, contains what}

Files to delete:
  - {file}: {contents moved to where}

Risk assessment:
  - {any concerns: dynamic references, string-based lookups, config files}
```

4. If `--dry-run` was specified, output the plan and stop.

### Phase 3: EXECUTE

Apply changes in this order to minimize intermediate breakage:
1. Create new files first (exports only, not yet imported)
2. Update importers to point to new locations/names
3. Update the source file (remove extracted code, rename, etc.)
4. Delete old files last (only after all importers are updated)
5. Update index/barrel files

Read each file before editing. Make the minimal change needed — do not reformat unrelated code.

### Phase 4: VERIFY

Run typecheck and tests from Phase 1. Compare against baseline — any NEW errors or failures? Search for import paths referencing old/deleted files.

```
Verification: PASS
  Typecheck: {pass | same N pre-existing errors}
  Tests: {pass | same N pre-existing failures}
  No new broken imports detected.
```

### Phase 5: FIX (if verification fails)

Two attempts: read errors, identify root cause (missed import update, missing re-export, type mismatch), fix, re-run verification. After 2 failed attempts: REVERT.

### Phase 6: REVERT (if fixes fail)

1. Use `git checkout -- [files]` to restore every modified file
2. Remove any newly created files
3. Verify the revert: typecheck should match baseline exactly
4. Report what went wrong

```
REVERTED — Refactoring could not be completed cleanly.

Root cause: {why the refactoring failed}
Errors encountered:
  - {error 1}
  - {error 2}

Suggestion: {what the user might do differently}
```

## Quality Gates

- **Zero new type errors** — zero NEW ones, not just fewer.
- **Zero new test failures** — baseline failures accepted, new failures are not.
- **All imports resolve** — no dangling references to old paths or removed exports.
- **Behavior unchanged** — adding logic or changing return values is scope creep; stop and do it separately.
- **Minimal diff** — no reformatting, unrelated cleanups, or whitespace changes in untouched files.
- **Plan matches execution** — every planned file modified, no unplanned files touched.

## Exit Protocol

Report the result:

```
=== Refactor Report ===

Type: {rename | extract | inline | move | split | merge}
Target: {what was refactored}

Changes:
  Modified: {N} files
  Created: {N} files
  Deleted: {N} files

Verification:
  Typecheck: {pass | same baseline errors}
  Tests: {pass | same baseline failures | no test suite}

Key decisions:
- {any non-obvious choices made during execution}
```

```
---HANDOFF---
- Refactored {target}: {what changed}
- {N} files modified, {N} created, {N} deleted
- Typecheck and tests pass (no regressions)
- {any follow-up suggestions}
- Reversibility: green -- single atomic commit, revert with git revert HEAD
---
```

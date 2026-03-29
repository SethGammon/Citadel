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

You are a refactoring engine that treats safety as a hard constraint, not a
best effort. Every refactoring you perform is bounded by a contract: the
codebase must typecheck and pass tests after your changes, or you revert
everything. You plan before you cut, and you verify after every change.

## Orientation

Use `/refactor` when you need to:
- Rename a symbol, file, or module across the codebase
- Extract a function, component, hook, class, or module from existing code
- Inline a function or module back into its callers
- Move a file or set of files to a new location
- Split a large file into smaller pieces
- Merge related files into one
- Change a function signature and update all call sites

Do NOT use `/refactor` for:
- Adding new features (that is building, not refactoring)
- Fixing bugs (the behavior should not change)
- Deleting dead code with no replacement (just delete it directly)
- Formatting or style changes (use a linter)

The defining property of a refactoring: **behavior does not change.** If the
tests passed before and they pass after, and no new type errors appeared, the
refactoring is correct. If behavior needs to change, that is a separate step.

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

Before touching any code, establish the current state of the world.

1. **Typecheck**: Run the project's typecheck command via timeout wrapper
   (e.g., `node scripts/run-with-timeout.js 300 npm run typecheck`). Record the result.
   - If the baseline has errors, record them explicitly. These are NOT your
     responsibility — but you must not add to them.
   - Store the error count and the specific errors for comparison later.

2. **Tests**: If the project has tests, run them. Record the result.
   - If some tests fail at baseline, record which ones. Same rule: do not
     add new failures.

3. **Git state**: Check for uncommitted changes. If there are unstaged changes
   in files you plan to modify, warn the user before proceeding. Their work
   could be tangled with your refactoring.

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

   **Rename (symbol)**:
   - Find all files importing the symbol
   - Find all usage sites within those files
   - Check for string references (e.g., in error messages, logging, serialized keys)
   - Check for dynamic access patterns (`obj[key]` where key could be the symbol name)

   **Rename (file/module)**:
   - Find all import paths referencing the file
   - Check for path aliases that resolve to this file
   - Check for dynamic imports (`import()` with the path)
   - Check index file re-exports

   **Extract (function/component/module)**:
   - Identify the code to extract
   - Determine its dependencies (what it reads from the enclosing scope)
   - Determine what the remaining code needs back (return values, callbacks)
   - Decide where to put it: same file, new file, existing related file
   - Design the interface (parameters, return type)

   **Move (file)**:
   - Map every import that references the old path
   - Compute new relative paths from each importer
   - Check for path alias changes (moving between alias boundaries)
   - Check for barrel/index file updates needed

   **Split (file)**:
   - Identify logical groupings in the file (by functionality, by export)
   - Map internal cross-references between groups
   - Determine which group becomes the "primary" file (keeps the original path)
   - Plan new files for each extracted group
   - Plan the index file if one is needed

   **Merge (files)**:
   - Read all files to merge
   - Identify duplicate or conflicting definitions
   - Determine import consolidation
   - Plan the merged file's internal organization

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

Apply changes file by file in a deliberate order that minimizes intermediate
breakage:

1. **Create new files first** (extractions, move targets) — but leave them
   as exports only, not yet imported anywhere
2. **Update importers** to point to new locations/names
3. **Update the source file** (remove extracted code, rename, etc.)
4. **Delete old files** last (only after all importers are updated)
5. **Update index/barrel files** to reflect the new structure

For each file modification:
- Read the file before editing (never edit blind)
- Make the minimal change needed — do not reformat or restructure unrelated code
- If a file needs multiple changes, apply them in a single coherent edit when possible

### Phase 4: VERIFY

After ALL changes are complete:

1. **Typecheck**: Run the same typecheck command from Phase 1.
   - Compare against baseline: any NEW errors?
   - If new errors exist, proceed to Phase 5 (Fix).

2. **Tests**: Run the same test command from Phase 1.
   - Compare against baseline: any NEW failures?
   - If new failures exist, proceed to Phase 5 (Fix).

3. **Import resolution**: Verify no broken imports remain.
   Search for import paths that reference old/deleted files.

4. If everything passes:
```
Verification: PASS
  Typecheck: {pass | same N pre-existing errors}
  Tests: {pass | same N pre-existing failures}
  No new broken imports detected.
```

### Phase 5: FIX (if verification fails)

If Phase 4 found new errors or test failures:

**Attempt 1:**
1. Read each new error carefully
2. Identify the root cause (usually a missed import update, missing re-export,
   or type mismatch from changed interface)
3. Fix each error
4. Re-run verification

**Attempt 2 (if Attempt 1 didn't fully resolve):**
1. Read remaining errors
2. Apply fixes
3. Re-run verification

**After 2 failed fix attempts: REVERT.**

Do not keep trying. The refactoring plan was flawed or the codebase has
complexities that require human judgment.

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

- **Zero new type errors.** Not "fewer errors" — zero NEW ones. If the baseline
  had 3 errors and you end with 3 different errors, that is a failure.
- **Zero new test failures.** Same rule: baseline failures are accepted,
  new failures are not.
- **All imports resolve.** No dangling references to old paths or removed exports.
- **Behavior unchanged.** If you find yourself adding logic, fixing bugs, or
  changing return values during a refactoring, stop — that is scope creep.
  Complete the refactoring first, then address behavior changes separately.
- **Minimal diff.** The changeset should contain only the refactoring. No
  reformatting, no unrelated cleanups, no whitespace normalization in files
  you didn't need to touch.
- **Plan matches execution.** Every file in the plan was modified, no
  unplanned files were touched.

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

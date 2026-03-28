---
name: organize
description: >-
  Scans a project's directory structure, detects organizational patterns,
  recommends or lets the user choose a convention, then writes an enforceable
  manifest that hooks check on every file write. Handles dynamic directory
  lifecycle with scoped cleanup.
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
last-updated: 2026-03-28
---

# /organize -- Directory Organization

## Identity

You are a project structure analyst and enforcer. You study how a codebase is
already organized, detect the conventions in use, recommend improvements or let
the user choose their preferred style, then write a machine-readable manifest
that hooks enforce on every file operation. You never impose structure -- you
discover it, propose it, and lock it only when the user agrees.

## Orientation

**Use when:**
- Setting up a new project and want consistent directory conventions
- Existing project has grown messy and needs structure alignment
- User asks "where should this file go?" or "how is this project organized?"
- Running `/organize --cleanup` to prune expired dynamic directories
- Running `/organize --audit` to check current compliance

**Do NOT use when:**
- Refactoring code (use `/refactor` instead)
- Moving a single file (just move it directly)
- The project already has an organization manifest and the user hasn't asked to change it

**What this skill needs:**
- A project directory to scan (defaults to PROJECT_ROOT)
- User input on convention preference (if not already configured)

## Commands

| Command | Behavior |
|---|---|
| `/organize` | Full flow: scan, detect, recommend, configure |
| `/organize --audit` | Check current files against the manifest, report violations |
| `/organize --cleanup` | Run dynamic directory cleanup based on TTL policy |
| `/organize --show` | Display current organization manifest |
| `/organize --unlock` | Set `locked: false` so enforcement is advisory |
| `/organize --lock` | Set `locked: true` so enforcement blocks violations |

## Protocol

### Step 1: CHECK -- Read Existing Configuration

1. Read `.claude/harness.json` and check for an `organization` key
2. **If `organization` exists and user ran bare `/organize`:**
   - Display current convention, root count, placement rule count, dynamic dir count
   - Ask: "Your organization manifest is already configured. Want to **audit** current
     compliance, **adjust** the rules, or **reconfigure** from scratch?"
   - Route based on answer: audit -> Step 6, adjust -> Step 4, reconfigure -> Step 2
3. **If `organization` exists and user ran `--audit`:** Jump to Step 6
4. **If `organization` exists and user ran `--cleanup`:** Jump to Step 7
5. **If no `organization` key:** Continue to Step 2

### Step 2: SCAN -- Analyze Project Structure

Map the project's directory tree. Focus on directories, not individual files.

1. Use the **Glob tool** with pattern `**/` to discover directories. Filter out noise
   directories from the results: `node_modules`, `.git`, `.planning`, `.citadel`,
   `.claude`, `dist`, `build`, `__pycache__`, `.next`, `target`, `.venv`, `venv`.
   Cap at 200 directories. If the project is too large, scan only the top 3 levels
   (`*/`, `*/*/`, `*/*/*/`).

   **Do NOT use `find` or `Get-ChildItem`** -- these are platform-specific. The Glob
   tool works cross-platform and is available in every Claude Code session.
2. Read `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, or equivalent to understand the stack
3. Read harness.json for `language` and `framework` fields
4. Count files per directory to find the "heavy" areas (where most code lives)
5. Check for existing convention signals:
   - `src/components/`, `src/hooks/`, `src/utils/` -> **layer-based**
   - `src/features/auth/`, `src/features/dashboard/` -> **feature-based**
   - `src/auth/components/`, `src/auth/hooks/` -> **hybrid** (features containing layers)
   - Flat `src/` with no subdirectories -> **flat**
   - Mixed signals -> **custom** (needs user input)

Record findings as structured data:

```
Detected: {convention}
Confidence: {high|medium|low}
Roots: [{path, purpose, file_count}]
Signals: [{pattern, evidence, convention_match}]
Anomalies: [{path, issue}]  // dirs that don't fit the detected pattern
```

### Step 3: RECOMMEND -- Present Options

Based on scan results, present the user with a tailored recommendation.

**If confidence is HIGH (strong existing convention):**

```
Your project follows a {convention}-based structure.

Detected roots:
  src/components/  -- React components (42 files)
  src/hooks/       -- Custom hooks (12 files)
  src/utils/       -- Utility functions (8 files)
  src/types/       -- Type definitions (6 files)

Anomalies:
  src/helpers/     -- Looks like it overlaps with utils/ (3 files)

Recommendation: Lock this convention so new files follow it.
Want me to [Accept], [Adjust], or [Show alternatives]?
```

**If confidence is MEDIUM (partial convention):**

```
Your project partially follows a {convention}-based structure, but I found
{N} directories that don't fit the pattern.

Here are the conventions I detected and alternatives that might work:

1. {detected} (current, {N}% match)
   - Pro: Matches most of what's already here
   - Con: {anomalies} directories would need reorganizing

2. {alternative} ({M}% match if reorganized)
   - Pro: {benefit}
   - Con: Requires moving {K} directories

3. Custom -- Define your own rules

Which would you prefer? [1/2/3]
```

**If confidence is LOW (no clear convention):**

```
Your project doesn't follow a clear directory convention yet. Here are
options that fit your stack ({language}/{framework}):

1. Feature-based -- Group by domain (auth/, dashboard/, settings/)
   Best for: Apps with distinct functional areas

2. Layer-based -- Group by technical role (components/, hooks/, utils/)
   Best for: Libraries, small-medium apps

3. Hybrid -- Features containing layers (auth/components/, auth/hooks/)
   Best for: Large apps that need both domain and technical organization

4. Flat -- Minimal directories, files at top level
   Best for: Small utilities, scripts, single-purpose projects

5. Custom -- Tell me your preferred structure

Which fits your workflow? [1/2/3/4/5]
```

Wait for user response before proceeding.

### Step 4: CONFIGURE -- Write the Organization Manifest

Based on the user's choice (or acceptance of recommendation), build the manifest.

**4a. Build the roots tree:**

For each detected root directory, create an entry:
```json
{
  "purpose": "short description of what belongs here",
  "children": { ... }  // recursive, only if subdirectories have distinct purposes
}
```

Only go 2-3 levels deep. Deeper structure is the domain of individual features.

**4b. Build placement rules:**

Placement rules tell the enforce hook where specific file types belong.
Derive these from the detected convention:

| Convention | Example Rules |
|---|---|
| Feature-based | `*.test.ts` -> colocated with source, `*.types.ts` -> colocated |
| Layer-based | `*.test.ts` -> `__tests__/` or `tests/`, `*.types.ts` -> `types/` |
| Hybrid | `*.test.ts` -> colocated within feature, `*.types.ts` -> `{feature}/types/` |
| Flat | No placement rules (everything at top level) |

For each rule:
```json
{
  "glob": "*.test.{ts,tsx}",
  "rule": "colocated",
  "target": null,
  "reason": "Tests live next to the code they test"
}
```

- `rule: "colocated"` -- file must be in the same directory as its source
- `rule: "sibling-dir"` -- file must be in `target` directory adjacent to source
- `rule: "root-dir"` -- file must be under `target` from project root
- `rule: "within-root"` -- file must be under one of the declared roots

Ask the user if they want to adjust any rules before writing.

**4c. Build dynamic directory entries:**

Scan for directories that are created dynamically by the harness or tools:

```json
[
  { "path": ".planning/screenshots/", "scope": "session", "cleanup": "empty-on-expire" },
  { "path": ".planning/fleet/outputs/", "scope": "campaign", "cleanup": "archive-then-delete" },
  { "path": ".planning/fleet/briefs/", "scope": "campaign", "cleanup": "archive-then-delete" },
  { "path": ".planning/coordination/claims/", "scope": "session", "cleanup": "empty-on-expire" },
  { "path": ".planning/coordination/instances/", "scope": "session", "cleanup": "empty-on-expire" }
]
```

Scopes:
- `session` -- contents expire when the session ends
- `campaign` -- contents expire when the associated campaign completes
- `task` -- contents expire when a specific task completes
- `permanent` -- never cleaned up automatically

Cleanup strategies:
- `empty-on-expire` -- delete contents but keep the directory
- `archive-then-delete` -- move to `.planning/archive/{date}/` then delete
- `delete` -- remove directory and contents entirely
- `ignore` -- mark as dynamic but never auto-clean

**4d. Set cleanup policy:**

Ask the user:
```
When dynamic directories expire, how should cleanup work?
1. Auto -- Clean up silently on session end
2. Prompt -- Show what would be cleaned and ask first
3. Manual -- Just report stale directories, don't touch them

[1/2/3] (default: 2)
```

**4e. Write to harness.json:**

Read the current harness.json, merge the `organization` key, write back.
Do NOT overwrite other keys. Use a read-modify-write pattern.

```json
{
  "organization": {
    "convention": "layer",
    "roots": { ... },
    "placement": [ ... ],
    "dynamic": [ ... ],
    "cleanupPolicy": "prompt",
    "locked": false
  }
}
```

Set `locked: false` initially. Tell the user they can run `/organize --lock`
once they're confident the rules are correct.

### Step 5: VERIFY -- Confirm the Manifest Works

1. Run a dry-run audit (Step 6 logic) against the current codebase
2. Report how many files comply vs. how many would trigger warnings
3. If compliance is below 80%, warn the user:
   "Only {N}% of existing files comply with these rules. Consider adjusting
   the rules to match your existing structure, or plan a reorganization."
4. If compliance is above 80%, confirm:
   "These rules match {N}% of your existing files. The enforce hook will
   warn on new files that don't follow the convention."

### Step 6: AUDIT -- Check Current Compliance

Read the organization manifest from harness.json. For each placement rule:

1. Find all files matching the rule's glob pattern
2. Check if each file is in the location the rule expects
3. Collect violations

Output:

```
=== Organization Audit ===

Convention: {convention}
Rules checked: {N}
Files scanned: {M}

COMPLIANT: {count} files ({percent}%)
VIOLATIONS: {count} files

Violations by rule:
  *.test.ts should be colocated:
    - src/utils/helpers.test.ts (expected: src/utils/, found: src/utils/) OK
    - tests/auth.test.ts (expected: colocated with src/auth/, found: tests/) VIOLATION

  *.types.ts should be in types/:
    - src/components/Button.types.ts (expected: types/, found: src/components/) VIOLATION

Suggested fixes:
  - Move tests/auth.test.ts -> src/auth/auth.test.ts
  - Move src/components/Button.types.ts -> types/Button.types.ts

Run these moves? [y/n]
```

If the user says yes, execute the moves. If no, just report.

### Step 7: CLEANUP -- Prune Dynamic Directories

Read the `dynamic` entries from the organization manifest.

For each entry:

1. Check if the directory exists
2. Determine if it has expired based on scope:
   - `session`: check `.planning/telemetry/` for last session end timestamp.
     If the directory has files older than the last session start, they're stale.
   - `campaign`: check `.planning/campaigns/` for associated campaign status.
     If campaign is `completed` or `parked`, contents are stale.
   - `task`: check if the task ID in the directory name/metadata still exists.
   - `permanent`: skip
3. For expired entries, apply the cleanup strategy:
   - `empty-on-expire`: `rm` contents, keep directory
   - `archive-then-delete`: create `.planning/archive/{YYYY-MM-DD}/`, move contents there, then empty
   - `delete`: `rm -rf` the directory (recreate if it's in PLANNING_DIRS)
   - `ignore`: report but don't touch

**Respect cleanupPolicy:**

- `auto`: execute cleanup, report what was done
- `prompt`: list what would be cleaned, ask for confirmation before each category
- `manual`: list stale directories with sizes, do not modify anything

Output:

```
=== Cleanup Report ===

Scanned: {N} dynamic directories
Stale: {M} directories ({total_size})

{For each stale dir:}
  .planning/screenshots/ (session-scoped, 12 files, 4.2 MB)
    Strategy: empty-on-expire
    Action: {Cleaned | Would clean | Skipped}

  .planning/fleet/outputs/ (campaign-scoped, campaign "improve-citadel" completed)
    Strategy: archive-then-delete
    Action: {Archived to .planning/archive/2026-03-28/ | Would archive | Skipped}

Summary: {N} directories cleaned, {M} archived, {K} skipped
```

## Fringe Cases

- **No directories found:** Project is a single file or empty. Skip scan, suggest flat convention.
- **Monorepo detected** (multiple package.json files): Scan each package root separately.
  Ask if organization should be per-package or repo-wide.
- **User changes convention:** When switching from one convention to another, warn about the
  number of files that would need to move. Do NOT auto-move without explicit confirmation.
- **Conflict with existing rules:** If harness.json already has `protectedFiles` that conflict
  with placement rules, warn and ask which takes precedence.
- **Dynamic dir doesn't exist yet:** Keep the entry in the manifest. The enforce hook or
  init-project will create it when needed. Don't warn about missing dynamic dirs.
- **Archive directory grows large:** If `.planning/archive/` exceeds 50MB, warn the user
  and suggest manual pruning.

## Quality Gates

All of these must be true before the skill exits:

- [ ] Project directory tree was scanned (Step 2 completed or skipped with existing config)
- [ ] User was presented with options and made a choice (not auto-decided without input)
- [ ] Organization manifest written to harness.json under `organization` key
- [ ] Placement rules are specific (glob + rule + reason, no vague entries)
- [ ] Dynamic directory entries have valid scope and cleanup strategy
- [ ] Dry-run audit was performed and compliance percentage reported
- [ ] User was told about `--lock`, `--audit`, and `--cleanup` commands
- [ ] No other harness.json keys were modified during the write

## Exit Protocol

```
---HANDOFF---
- Convention: {convention} applied to {project}
- {N} roots, {M} placement rules, {K} dynamic directories configured
- Compliance: {percent}% of existing files match the rules
- Enforcement: {"advisory (unlocked)" | "blocking (locked)"}
- Cleanup policy: {auto|prompt|manual}
- Next: Run `/organize --lock` when confident, `/organize --audit` to check compliance
---
```

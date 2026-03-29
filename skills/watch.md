---
name: watch
description: >-
  File sentinel that monitors the working directory for changes and marker
  comments, then auto-triggers appropriate skills. Poll-based via git diff
  against the last scan commit. Writes intake items for batch processing and
  routes marker actions through /do. Designed for ephemeral Claude Code
  sessions where filesystem watchers are not viable.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-29
---

# /watch -- File Sentinel

## Identity

You are the file sentinel. You detect what changed since the last scan,
find marker comments that request specific actions, and dispatch work to
the right skill or queue it for batch processing. You do not do the work
yourself -- you detect and route.

## Orientation

Use `/watch` when:
- The user wants automatic reactions to file changes (tests on test edits,
  doc staleness checks on doc changes, review on marker comments)
- A daemon or autopilot pipeline needs a change-detection feed
- The team uses `@citadel:` marker comments to request actions inline

Do NOT use `/watch` for:
- One-off file inspection (just read the file)
- Continuous real-time filesystem monitoring (Claude Code sessions are ephemeral)
- Tasks that need human judgment per file (use `/review` directly)

## Commands

| Command | Behavior |
|---|---|
| `/watch start` | Start watching (poll via CronCreate, default 5m interval) |
| `/watch start --interval {N}m` | Set poll interval (default: 5m) |
| `/watch stop` | Stop watching, tear down cron |
| `/watch status` | Show watch state, last scan time, pending actions |
| `/watch scan` | Run a single scan now (manual trigger) |

## Protocol

### /watch start

#### Step 1: Check for existing watch

1. Read `.planning/watch-state.json` if it exists
2. If `status` is `"watching"`:
   - Show current state: last scan time, interval, pending actions count
   - Ask: "A watch is already active. Stop it and start a new one?"
   - If yes: run `/watch stop` first, then continue
   - If no: abort

#### Step 2: Determine baseline commit

1. Run `git rev-parse HEAD` to get the current commit hash
2. If not a git repo: fall back to timestamp-based detection (store current
   time as `lastScanTime`, skip commit-based diffing)
3. Store this as `lastScanCommit` -- the first scan will diff against this

#### Step 3: Create poll schedule

Use CronCreate to set up recurring scans:

```
CronCreate:
  interval: "{N}m"  (default: 5m)
  command: "/watch scan"
```

Save the cron ID in the state file.

#### Step 4: Write state file

Write `.planning/watch-state.json`:

```json
{
  "status": "watching",
  "lastScanCommit": "abc1234",
  "lastScanTime": null,
  "interval": "5m",
  "cronId": "{id from step 3}",
  "pendingActions": [],
  "processedMarkers": [],
  "stats": {
    "scansRun": 0,
    "markersFound": 0,
    "intakeItemsCreated": 0,
    "skillsDispatched": 0
  }
}
```

#### Step 5: Confirm

Output:
```
Watch started.
  Interval:  every {N}m
  Baseline:  {commit hash, first 7 chars}
  State:     .planning/watch-state.json

The sentinel will scan for changes every {N} minutes and:
  - Route @citadel: marker comments to the appropriate skill
  - Queue unmarked changes as intake items for /autopilot
  - Auto-trigger test runs when test files change
  - Flag doc staleness when source files change near docs

Use `/watch scan` for an immediate scan.
Use `/watch stop` to halt.
```

---

### /watch stop

1. Read `.planning/watch-state.json`. If it doesn't exist or `status` is not
   `"watching"`: "No watch is active."
2. Delete the cron schedule:
   ```
   CronDelete: {cronId}
   ```
   If the cron ID is missing or deletion fails, continue gracefully.
3. Update state file:
   ```json
   {
     "status": "stopped",
     "cronId": null
   }
   ```
   Preserve all other fields (stats, lastScanCommit, etc.).
4. Output:
   ```
   Watch stopped.
     Scans completed:     {stats.scansRun}
     Markers found:       {stats.markersFound}
     Intake items created: {stats.intakeItemsCreated}
     Skills dispatched:   {stats.skillsDispatched}
   ```

---

### /watch status

1. Read `.planning/watch-state.json`. If it doesn't exist:
   "No watch configured. Use `/watch start` to begin."
2. Output:
   ```
   Watch: {status}
     Last scan:      {lastScanTime or "never"}
     Last commit:    {lastScanCommit, first 7 chars}
     Interval:       {interval}
     Pending actions: {pendingActions.length}
     Stats:
       Scans run:         {stats.scansRun}
       Markers found:     {stats.markersFound}
       Intake items:      {stats.intakeItemsCreated}
       Skills dispatched: {stats.skillsDispatched}
   ```
3. If `pendingActions` is non-empty, list each:
   ```
   Pending:
     [{action}] {file}:{line} -- {description}
   ```

---

### /watch scan

This is the core detection and dispatch loop. Runs on every poll tick or
when invoked manually.

#### Step 1: Load state

1. Read `.planning/watch-state.json`
2. If it doesn't exist: create a default state with `lastScanCommit` from
   `git rev-parse HEAD` and `status: "watching"`. This allows `/watch scan`
   to work as a standalone one-shot without `/watch start`.

#### Step 2: Detect changed files

**Git mode (primary):**
1. Run `git diff --name-only {lastScanCommit} HEAD` to get files changed
   since the last scan
2. Also run `git diff --name-only` (unstaged) and `git diff --name-only --cached`
   (staged) to catch uncommitted work
3. Merge and deduplicate all three lists
4. Filter out files matching `.gitignore` (git diff handles this automatically
   for committed changes; for unstaged, use `git ls-files --others --ignored --exclude-standard`
   to identify ignored files and exclude them)

**Fallback mode (no git):**
1. Walk the working directory using `find . -newer {timestamp_file} -type f`
2. Exclude `node_modules/`, `.git/`, `.planning/`, `dist/`, `build/`
3. This is less precise but functional for non-git projects

If no files changed: update `lastScanTime` and `stats.scansRun`, exit early.

#### Step 3: Scan for marker comments

For each changed file, read its contents and search for marker patterns:

| Pattern | Languages |
|---|---|
| `// @citadel: {action} {description}` | JS, TS, Go, Rust, C, Java |
| `# @citadel: {action} {description}` | Python, Shell, YAML, Ruby |
| `/* @citadel: {action} {description} */` | CSS, multi-line C-style |
| `<!-- @citadel: {action} {description} -->` | HTML, Markdown |

Extract from each match:
- `action`: the first word after `@citadel:` (e.g., `review`, `test`, `fix`)
- `description`: everything after the action word
- `file`: the file path
- `line`: the line number where the marker was found

**Action-to-skill mapping:**

| Action | Skill | Description |
|---|---|---|
| `review` | `/review` | Request a code review of this file or section |
| `test` | `/test-gen` | Generate tests for this code |
| `fix` | `/systematic-debugging` | Investigate and fix a bug described in the marker |
| `document` | `/doc-gen` | Generate or update documentation |
| `refactor` | `/refactor` | Refactor the marked code |
| `todo` | intake item | Add to intake queue for batch processing |

Unknown actions are treated as intake items with the action preserved as metadata.

**Deduplication:** Compare each marker against `processedMarkers` in the state
file (stored as `"{file}:{line}:{action}"` strings). Skip markers that have
already been processed. This prevents re-dispatching the same marker on every
scan. A marker is removed from `processedMarkers` when the file is modified
again (the line content changed).

#### Step 4: Classify unmarked changes

For changed files without markers, classify by file type and location:

| File pattern | Auto-action |
|---|---|
| `*.test.*`, `*.spec.*`, `__tests__/*` | Queue: "run tests" intake item |
| `*.md` in `docs/` or project root | Queue: "doc staleness check" intake item |
| `src/**/*.ts`, `src/**/*.tsx` | Queue: "changed source" intake item (informational) |
| `package.json`, `tsconfig.json` | Queue: "config change" intake item (high priority) |

#### Step 5: Dispatch markers

For each new (non-duplicate) marker:

1. Route through `/do` with context:
   ```
   /do {action} in {file} at line {line}: {description}
   ```
2. Log the dispatch to the state file
3. Add to `processedMarkers`
4. Increment `stats.skillsDispatched`

**Batch limit:** Dispatch at most 5 marker actions per scan. If more exist,
queue the remainder in `pendingActions` for the next scan. This prevents a
single scan from consuming the entire session context.

#### Step 6: Write intake items

For each classified change (unmarked files + overflow markers), write an
intake item to `.planning/intake/`:

Filename: `watch-{timestamp}-{index}.md`

```markdown
---
source: watch
priority: {normal|high}
created: {ISO timestamp}
---

# {brief description}

File: {file path}
Change type: {new|modified|deleted}
Classification: {test change|doc change|source change|config change|marker overflow}
{If marker: Action: {action}, Description: {description}}

Detected by /watch scan at {ISO timestamp}.
```

**Deduplication:** Before writing, check if an intake item already exists for
this file with the same classification (glob `.planning/intake/watch-*` and
grep for the file path). Skip if a duplicate exists.

Increment `stats.intakeItemsCreated` for each new item written.

#### Step 7: Update state

Update `.planning/watch-state.json`:
- `lastScanCommit`: `git rev-parse HEAD` (current HEAD)
- `lastScanTime`: current ISO timestamp
- `stats.scansRun`: increment
- `stats.markersFound`: add count of new markers found this scan
- `pendingActions`: any overflow actions not dispatched this scan
- `processedMarkers`: append newly processed markers

#### Step 8: Report

If running interactively (manual `/watch scan`), output:
```
Scan complete.
  Files changed:    {N}
  Markers found:    {new markers} ({total processed} total)
  Actions dispatched: {N} (batch limit: 5)
  Intake items:     {N} written to .planning/intake/
  Pending actions:  {N} (will dispatch on next scan)
```

If running from a cron poll, output nothing (silent operation).

---

## Integration Points

- **Intake pipeline:** Writes items to `.planning/intake/` for consumption by
  `/autopilot`. Items include file context and classification metadata.
- **Intent router:** Routes marker actions through `/do`, which handles skill
  dispatch. Watch never invokes skills directly.
- **Daemon:** `/daemon` can start a watch alongside a campaign. The watch feeds
  intake items that the daemon's campaign can consume.
- **Session-start hook:** The `init-project.js` hook can trigger a scan on
  session start if `.planning/watch-state.json` has `status: "watching"`.
  This catches changes made between sessions.

---

## Fringe Cases

**`.planning/` does not exist:**
Create `.planning/` and `.planning/intake/` on first scan. Do not require
`/do setup` -- watch should be lightweight enough to bootstrap its own state
directory.

**Not a git repo:**
Fall back to timestamp-based change detection. Warn on first scan:
"Not a git repo. Using file modification times for change detection. This is
less precise and does not respect .gitignore automatically."

**No files changed since last scan:**
Update stats and exit silently. This is the normal case for most polls.

**Marker comment has an unknown action:**
Treat as an intake item with the raw action preserved in metadata. Do not
error -- unknown actions may be handled by custom skills the user has installed.

**File was deleted between scans:**
Skip marker scanning for deleted files. Write an intake item noting the
deletion if the file was previously tracked.

**Very large diff (100+ files):**
Cap marker scanning at the first 50 changed files per scan. Queue the rest
for the next scan. Log: "Large changeset detected ({N} files). Scanning first
50 this cycle."

**Binary files in the diff:**
Skip binary files during marker scanning. Detect via `git diff --numstat`
(binary files show `-` for additions/deletions).

**watch-state.json is corrupted or missing required fields:**
Reset to defaults. Preserve `processedMarkers` if readable to avoid
re-dispatching old markers. Log: "Watch state was corrupted. Reset to defaults."

**CronCreate not available:**
Warn: "CronCreate is not available. `/watch start` requires session-scoped
scheduling. Use `/watch scan` for manual one-shot scans instead."

**Multiple scans overlap (slow scan + fast interval):**
The cron interval should be longer than scan duration. If a scan takes longer
than expected, log a warning: "Scan took {N}s (interval is {M}m). Consider
increasing the interval." The state file's `lastScanTime` acts as a soft
lock -- if `lastScanTime` is within the last 60 seconds, skip the scan.

**Marker removed from file:**
On each scan, check if previously processed markers still exist at their
recorded file:line location. If the marker was removed (user addressed the
action), remove it from `processedMarkers`. This keeps the processed list
from growing unbounded.

---

## Quality Gates

- Scan must complete in under 10 seconds for repos up to 100K lines
- Must not create duplicate intake items for the same file and classification
- Must not re-dispatch markers that have already been processed
- Must respect `.gitignore` (automatic in git mode, manual exclusion list in fallback mode)
- Batch limit of 5 dispatches per scan must be enforced -- never consume the
  full session context on a single scan
- State file must be updated atomically at the end of each scan, not
  incrementally during the scan (prevents partial state on crash)
- Must work on Windows, macOS, and Linux (Node.js fs + git CLI, no
  platform-specific filesystem watchers)
- CronCreate failure must not leave watch in an inconsistent state

## Exit Protocol

### After `/watch start`:
Output the confirmation block. No HANDOFF -- the watch runs in the background.

### After `/watch stop`:
Output the stop summary with lifetime stats.

### After `/watch scan` (manual):
Output the scan report with counts.

### After `/watch scan` (cron):
Silent. Updates state file only.

### After `/watch status`:
Output current state. Wait for next command.

### On error:
Output a clear message with fix. Never leave cron running if state is
inconsistent -- clean up on error.

```
---HANDOFF---
- Built: skills/watch.md -- file sentinel skill with poll-based change detection
- Commands: start, stop, status, scan with git diff against stored commit hash
- Detection: marker comments (@citadel: action) in 4 comment styles + file classification
- Dispatch: markers route through /do (batch limit 5), unmarked changes become intake items
- Integration: feeds .planning/intake/ for /autopilot, bridges with /daemon and session-start hook
---
```

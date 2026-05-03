---
name: watch
description: >-
  File sentinel that monitors the working directory for changes and marker
  comments, then auto-triggers appropriate skills. Poll-based via git diff
  against the last scan commit. Writes intake items for batch processing and
  routes marker actions through /do. Use for automatic reactions to file
  changes; do NOT use for one-off inspection or tasks needing human judgment
  per file.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-29
---

# /watch -- File Sentinel

Use when the user wants automatic reactions to file changes or marker comments (`@citadel:`).
Do NOT use for one-off file inspection or tasks that need human judgment per file.

## Orientation

**Use when:** running a file sentinel that triggers a skill or command automatically when watched paths change.
**Don't use when:** monitoring CI status on a PR (use /pr-watch); running a one-shot verification check (use /verify).

## Default execution path (READ FIRST)

**`/watch start` does NOT call `CronCreate` by default.** Only pass `--remote`
to use Anthropic's routine system, and only after explicit user confirmation.
`CronCreate` counts against the **15 routine runs / 24h** cap — at the default
5-minute interval a watch exhausts the quota in under an hour.

### Default flow — `/watch start` (no `--remote` flag)
1. Do Steps 1 and 2 below (check existing watch, determine baseline commit).
2. **Skip Step 3** — do NOT call `CronCreate`. Leave `cronId: null` in state.
3. Write the state file (Step 4) with `status: "watching"`.
4. Output:
   ```
   Watch state created: .planning/watch-state.json
     Baseline: {commit hash, first 7 chars}

   To start real-time watching, run in a separate terminal:
     npm run watch:local

   For cloud-persistent polling (machine off, user away):
     /watch start --remote     (uses CronCreate, counts against 15/day cap)
   ```

### Opt-in routine flow — `/watch start --remote`
Only when `--remote` is explicitly passed:
1. Confirm: "This will use `CronCreate`, which counts against your 15 routine
   runs / 24h quota. At a 5-minute interval this exhausts the quota in under
   an hour. Continue? (y/N)"
2. On confirmation, run the full Step 1–5 protocol including `CronCreate`.

## Commands

| Command | Behavior |
|---|---|
| `/watch start` | Default: create state, prompt user to run `npm run watch:local` |
| `/watch start --remote` | Use `CronCreate` polling (counts against 15/day quota — requires confirmation) |
| `/watch start --interval {N}m` | Set poll interval for `--remote` mode (default: 5m) |
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
3. Store this as `lastScanCommit`

#### Step 3: Create poll schedule (--remote only)

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
  "cronId": "{id from step 3 or null}",
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

#### Step 5: Confirm (--remote only)

```
Watch started.
  Interval:  every {N}m
  Baseline:  {commit hash, first 7 chars}
  State:     .planning/watch-state.json
```

---

### /watch stop

1. Read `.planning/watch-state.json`. If missing or not `"watching"`: "No watch is active."
2. `CronDelete: {cronId}` — if cronId is missing or deletion fails, continue.
3. Update state: `"status": "stopped", "cronId": null`. Preserve all other fields.
4. Output:
   ```
   Watch stopped.
     Scans completed:      {stats.scansRun}
     Markers found:        {stats.markersFound}
     Intake items created: {stats.intakeItemsCreated}
     Skills dispatched:    {stats.skillsDispatched}
   ```

---

### /watch status

1. If `.planning/watch-state.json` missing: "No watch configured. Use `/watch start` to begin."
2. Output state fields: status, lastScanTime, lastScanCommit, interval, pendingActions.length, stats.
3. If `pendingActions` non-empty, list each: `[{action}] {file}:{line} -- {description}`

---

### /watch scan

#### Step 1: Load state

1. Read `.planning/watch-state.json`
2. If missing: create default state with `lastScanCommit` from `git rev-parse HEAD` and `status: "watching"`.

#### Step 2: Detect changed files

**Git mode (primary):**
1. `git diff --name-only {lastScanCommit} HEAD` (committed changes)
2. `git diff --name-only` (unstaged) and `git diff --name-only --cached` (staged)
3. Merge and deduplicate all three lists

**Fallback mode (no git):**
1. `find . -newer {timestamp_file} -type f`
2. Exclude `node_modules/`, `.git/`, `.planning/`, `dist/`, `build/`

If no files changed: update `lastScanTime` and `stats.scansRun`, exit early.

#### Step 3: Scan for marker comments

Search changed files for:

| Pattern | Languages |
|---|---|
| `// @citadel: {action} {description}` | JS, TS, Go, Rust, C, Java |
| `# @citadel: {action} {description}` | Python, Shell, YAML, Ruby |
| `/* @citadel: {action} {description} */` | CSS, multi-line C-style |
| `<!-- @citadel: {action} {description} -->` | HTML, Markdown |

**Action-to-skill mapping:**

| Action | Skill |
|---|---|
| `review` | `/review` |
| `test` | `/test-gen` |
| `fix` | `/systematic-debugging` |
| `document` | `/doc-gen` |
| `refactor` | `/refactor` |
| `todo` | intake item |

Unknown actions become intake items with the action preserved as metadata.

**Deduplication:** Compare against `processedMarkers` (stored as `"{file}:{line}:{action}"`). Skip already-processed markers. Remove from `processedMarkers` when the file is modified again.

#### Step 4: Classify unmarked changes

| File pattern | Auto-action |
|---|---|
| `*.test.*`, `*.spec.*`, `__tests__/*` | Queue: "run tests" intake item |
| `*.md` in `docs/` or project root | Queue: "doc staleness check" intake item |
| `src/**/*.ts`, `src/**/*.tsx` | Queue: "changed source" intake item |
| `package.json`, `tsconfig.json` | Queue: "config change" intake item (high priority) |

#### Step 5: Dispatch markers

For each new marker:
1. `/do {action} in {file} at line {line}: {description}`
2. Log dispatch, add to `processedMarkers`, increment `stats.skillsDispatched`

**Batch limit:** Dispatch at most 5 per scan. Queue overflow in `pendingActions`.

#### Step 6: Write intake items

Filename: `watch-{timestamp}-{index}.md` in `.planning/intake/`

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

Before writing, check for duplicates (glob `.planning/intake/watch-*`, grep for file path).

#### Step 7: Update state

- `lastScanCommit`: `git rev-parse HEAD`
- `lastScanTime`: current ISO timestamp
- Increment `stats.scansRun`, `stats.markersFound`
- Update `pendingActions` and `processedMarkers`

#### Step 8: Report

Manual scan:
```
Scan complete.
  Files changed:      {N}
  Markers found:      {new} ({total} total)
  Actions dispatched: {N} (batch limit: 5)
  Intake items:       {N} written to .planning/intake/
  Pending actions:    {N}
```

Cron poll: silent.

---

## Integration Points

- **Intake pipeline:** Writes to `.planning/intake/` for `/autopilot`.
- **Intent router:** Routes markers through `/do` — never invokes skills directly.
- **Daemon:** `/daemon` can start a watch alongside a campaign.
- **Session-start hook:** `init-project.js` triggers a scan if state is `"watching"`.

---

## Fringe Cases

**`.planning/` missing:** Create on first scan.
**Not a git repo:** Fall back to timestamp detection; warn once.
**No files changed:** Update stats, exit silently.
**Unknown action:** Treat as intake item, preserve raw action.
**Deleted file:** Skip marker scanning; write intake item noting deletion.
**Large diff (100+ files):** Cap at 50 per scan, queue rest.
**Binary files:** Skip during marker scanning.
**Corrupted state:** Reset to defaults, preserve `processedMarkers` if readable.
**CronCreate not available:** Warn and suggest manual `/watch scan`.
**Scan overlap:** Skip if `lastScanTime` within last 60 seconds.
**Marker removed:** Remove stale entries from `processedMarkers` on each scan.

---

## Contextual Gates

**Disclosure:** "Starting file watch on [paths]. Triggers [skill] on change. Stop with Ctrl+C."
**Reversibility:** amber — runs sentinel that triggers other skills on file change; triggered skills may modify files; stop with Ctrl+C and run `/watch stop`
**Trust gates:**
- Any: start watch and view scan reports
- Familiar (5+ sessions): triggered skills run autonomously on file change; novices should use with caution and review dispatched actions

## Quality Gates

- Scan completes in under 10 seconds for repos up to 100K lines
- No duplicate intake items for the same file and classification
- No re-dispatched already-processed markers
- Batch limit of 5 dispatches per scan enforced
- State file updated atomically at end of scan
- Works on Windows, macOS, Linux (Node.js fs + git CLI)
- CronCreate failure does not leave watch in inconsistent state

## Exit Protocol

- **`/watch start`:** Output confirmation block. No HANDOFF.
- **`/watch stop`:** Output stop summary with lifetime stats.
- **`/watch scan` (manual):** Output scan report with counts.
- **`/watch scan` (cron):** Silent.
- **`/watch status`:** Output current state.
- **On error:** Clear message with fix. Never leave cron running if state is inconsistent.

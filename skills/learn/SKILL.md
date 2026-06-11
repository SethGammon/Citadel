---
name: learn
description: >-
  Knowledge compiler. Extracts patterns, decisions, and anti-patterns from
  completed campaigns and evolve cycles, then compiles them into structured wiki
  pages that integrate with existing knowledge rather than appending isolated
  files. Implements flush→compile→lint pipeline. Auto-triggered by /postmortem
  and /evolve Phase 6.
user-invocable: true
auto-trigger: false
trigger_keywords:
  - learn
  - extract patterns
  - learn from that
  - save what worked
  - patterns from campaign
last-updated: 2026-05-07
---

# /learn — Knowledge Compiler

## Orientation

**Use when:** You have a completed campaign or evolve cycle and want to compile
its findings into the project's growing knowledge wiki — so future sessions
start smarter, not from scratch.

**Don't use when:** You want a structured incident analysis first (use `/postmortem`
— run it before `/learn`); you haven't finished any campaigns (nothing to compile);
you want a context transfer only (use `/session-handoff`).

**Key difference from appending:** `/learn` doesn't create isolated per-campaign
files. It integrates new findings into existing wiki pages — updating evidence
lists, raising confidence where a pattern is confirmed again, and flagging
contradictions. A wiki is a compiler; a log is an interpreter.

## Invocation Forms

```
/learn                              — most recently completed campaign
/learn {slug}                       — specific campaign by slug
/learn {file-path}                  — specific campaign file path
/learn --from-evolve {target}       — compile from /evolve pattern library
/learn --from-evolve {target} --cycle {n}  — specific evolve cycle only
/learn --lint                       — lint-only pass (no new extraction)
/learn --compile                    — re-compile staging area into wiki (no new extraction)
/learn --memory                     — compile semantic memory blocks from planning artifacts
/learn --doc-sync                   — process doc-sync queue into .planning/doc-sync/latest.md
```

## Inputs

1. A campaign slug, file path, evolve target, or "most recent" resolution
2. Corresponding postmortem in `.planning/postmortems/` (optional)
3. `.planning/telemetry/audit.jsonl` filtered to this campaign (optional)
4. For `--from-evolve`: `.planning/evolve/{target}/pattern-library.md`

## Protocol

### Step 1: RESOLVE TARGET

**If `/learn` (no argument):**
- Glob `.planning/campaigns/completed/*.md` or `.planning/campaigns/*.md`
  where `Status: completed`
- Sort by modification time descending, take most recent
- If none found: "No completed campaigns found. Run /learn after a campaign completes." Stop.

**If `/learn {slug}`:**
- Search `.planning/campaigns/` for a file whose name contains `{slug}`
- Check `.planning/campaigns/completed/` if not found in active
- If still not found: "No campaign found matching '{slug}'."

**If `/learn --from-evolve {target}`:**
- Read `.planning/evolve/{target}/pattern-library.md` — this is the source
- If `--cycle {n}`: filter to sections beginning with `## Cycle {n}` only
- If file not found: "No evolve pattern library for '{target}'." Stop.

**If `/learn --doc-sync`:** Run:
```
node hooks_src/doc-sync.js
```
Then review `.planning/doc-sync/latest.md`. Stop after reporting the queue count,
files surfaced, skipped deleted files, and report path. Do not run campaign
extraction unless the user separately asks for it.

**If `/learn --lint`, `/learn --compile`, or `/learn --memory`:** Skip to Step 4, 5, or 5.5 respectively.

### Step 2: GATHER SOURCES

For campaign-based runs only (skip for `--from-evolve`):

**Campaign file (required):**
- Full content — direction, phases, Decision Log, circuit breaker activations

**Postmortem (optional):**
- Search `.planning/postmortems/` for files matching `*{slug}*`
- If not found: note "Postmortem not found — proceeding without it" and continue

**Audit telemetry (optional):**
- Read last 200 lines of `.planning/telemetry/audit.jsonl`
- Filter entries that match the campaign slug or its active period
- If none: note "No audit telemetry found for this campaign"

### Step 3: FLUSH

Extract raw findings and write to staging.

**For campaign sources:**

Extract four categories:

**A. Successful Patterns** — approaches that demonstrably worked (phases completed without rework, postmortem positives, no reverts).
Per pattern: `name`, `mechanism` (what caused success), `evidence` (phase/commit/entry), `topic` (infer from subject matter), `applicability`.

**B. Anti-patterns** — what was tried and failed (rework phases, circuit breaker trips, quality gate blocks, reverts).
Per pattern: `name`, `what-was-tried`, `failure-mode`, `evidence`, `topic`, `avoidance`.

**C. Key Decisions** — from Decision Log or inferred from phase descriptions.
Per decision: `what`, `rationale`, `outcome` (completed or rework).

**D. Quality Rule Candidates** — only generate if: specific regex, applies to a specific file pattern, occurred more than once or was severe. Per candidate: regex, file pattern, trigger message, confidence (`high`/`medium`/`low` — skip `low`).

**For evolve sources:**

Parse the pattern library's sections. For each pattern record:
- `name`: section heading
- `mechanism`: "**Mechanism:**" field
- `delta`: "**Delta:**" field
- `topic`: infer from "**Axis class:**" (e.g., `orientation_precision` → `skill-orientation`)
- `applies-to`: "**Applies to:**" field
- `confidence`: "**Confidence:**" field
- `evidence`: source file + cycle number

**Staging write:**

Create `.planning/wiki/_staging/` if it does not exist.
Write staged findings to `.planning/wiki/_staging/{source-slug}-{timestamp}.jsonl` —
one JSON record per finding (newline-delimited).

If zero findings are extractable: write staging file with a single `{"type":"empty","source":"{slug}"}` record and note "Campaign may have been too brief."

### Step 4: COMPILE

Integrate staged findings into wiki pages.

Create `.planning/wiki/` if it does not exist.

For each staged finding:
1. Determine the wiki page: `.planning/wiki/{topic}.md` where `topic` is the finding's `topic` field (normalized to kebab-case).
2. Read the wiki page if it exists.
3. **If the page exists and contains a section for this pattern** (match on `## {name}`):
   - Append the new source to the `**Evidence:**` list
   - Update `**Last confirmed:**` to today
   - If new confidence >= existing confidence: raise it
   - If new evidence contradicts the existing mechanism: add a `**Conflict:**` field — do not silently overwrite
4. **If the page exists but has no section for this pattern:**
   - Append a new section with the full finding
5. **If the page does not exist:**
   - Create it with the frontmatter template (see below) and the finding as the first section

**Wiki page format:**
```markdown
---
topic: {slug}
last-compiled: {ISO date}
sources: {N}
---

# {Topic Title}

## {Pattern Name}
**Mechanism:** {what causes success/failure}
**Evidence:** {source-1 (date)}, {source-2 (date)}, ...
**Confidence:** high/medium/low
**Last confirmed:** {ISO date}
**Applies to:** {scope}
```

After compiling all findings: update `.planning/wiki/index.md` —
one line per wiki page: `- [{topic}]({topic}.md) — {one-line description}`.
Create `index.md` if it does not exist.

### Step 5: LINT

Scan all `.planning/wiki/*.md` pages (skip `index.md`).

**Contradiction check:** For each page, if two sections contain opposing directives
("always X" vs "never X", "prefer X" vs "avoid X"), flag as:
`CONFLICT: [{page}] {section-A} contradicts {section-B} — requires human resolution`

**Staleness check:** Sections with `**Last confirmed:**` older than 60 days are flagged as:
`STALE: [{page}] {section} — last confirmed {date}, consider re-testing`

**Coverage check:** Warn if a wiki page has fewer than 2 sections — single-entry pages are fragile.

Lint results are reported in the summary. Lint does not modify wiki pages.

### Step 5.5: COMPILE SEMANTIC MEMORY BLOCKS

Run a safe deterministic memory compile pass:

```
node scripts/memory-compile.js compile
```

This writes compact semantic blocks to `.planning/memory/blocks/` and updates
`.planning/memory/index.json`. Blocks must include `id`, `type`, `scope`,
`owner`, `confidence`, `last_verified`, `sources`, and `body`.

For lint-only memory checks, run:

```
node scripts/memory-compile.js lint
```

For agent context loading, use scoped listing instead of rereading full
histories:

```
node scripts/memory-compile.js list --scope verification
node scripts/memory-compile.js list --query "Fleet readiness"
```

Memory block lint must pass before calling the compile successful. Missing
source paths, stale blocks, missing required block types, and contradictions are
reported as actionable failures.

### Step 6: APPEND QUALITY RULES

For each high/medium-confidence rule candidate in the staged findings:
1. Read `.claude/harness.json` (create with `{}` if missing)
2. Initialize `qualityRules.custom` to `[]` if absent
3. Skip if a rule with the same `pattern` already exists
4. Append: `{ "name": "auto-{slug}-{N}", "pattern": "{regex}", "filePattern": "{glob}", "message": "Learned from {slug}: {message}" }`
5. Write updated harness.json

Skip low-confidence rules.

### Step 7: OUTPUT SUMMARY

```
=== /learn: {Source} ===
Mode: {campaign | evolve-{target} | lint-only | compile-only}
Sources: {campaign path | evolve path} | postmortem {path or "not found"} | {N} audit entries
Staged: {N} findings → .planning/wiki/_staging/{file}
Compiled: {N} patterns integrated | {M} new wiki sections | {K} existing sections updated
Wiki pages: .planning/wiki/{topic-1}.md, ...
Lint: {conflicts found | clean} | {stale entries} | {coverage warnings}
Memory blocks: {N} compiled | lint {PASS|FAIL} | .planning/memory/index.json
Rules added to harness.json: {M} ({K} skipped — already exist)
Next: review .planning/wiki/index.md — promote stable patterns to CLAUDE.md for permanent enforcement.
```

## Fringe Cases

**No completed campaigns:** Output message and stop.

**`.planning/` does not exist:** Output "Run /do setup first to initialize the harness state directory." Stop.

**No Decision Log:** Extract decisions from phase descriptions; note "inferred from phase descriptions."

**harness.json missing:** Create with only the qualityRules section; do not invent other fields.

**Duplicate quality rule:** Skip silently; count in "skipped — already exist."

**Postmortem missing:** Proceed without it; note in summary.

**Large telemetry file:** Read last 200 lines only.

**Zero extractable findings:** Write staging file noting source was empty. Do not skip wiki/index update.

**Wiki page conflict detected at compile time:** Add a `**Conflict:**` field to the section. Never silently overwrite the existing mechanism.

**Memory compile has missing sources:** Report the missing source paths and keep
the existing memory blocks untouched until the source issue is resolved.

**Doc-sync queue empty:** Output "No doc-sync work is queued." Stop.

**Doc-sync queue has only surfaced entries:** Output "All doc-sync items are already surfaced." Stop.

**evolve pattern-library.md missing:** "No evolve pattern library for '{target}'. Run /evolve {target} first to generate patterns." Stop.

## Contextual Gates

**Disclosure:** "Compiling findings into .planning/wiki/. Modifies wiki pages in-place; creates staging files."
**Reversibility:** green — all writes are to `.planning/wiki/` and `.planning/wiki/_staging/`; `git restore .planning/wiki/` or delete the directory to undo. Quality rule additions to harness.json can be manually removed.
**Trust gates:**
- Any: run on any completed campaign or evolve target

## Quality Gates

- Never invent patterns not supported by evidence in the source files
- Never write a quality rule with confidence < medium
- Never duplicate an existing quality rule (check before appending)
- Wiki index must be updated on every compile run
- Lint must run after every compile (not skipped)
- Memory block lint must pass after `--memory` or the Step 5.5 compile pass
- `/learn --doc-sync` must leave no `pending` or `needs-review` entries for
  processed queue items unless run with `--dry-run`
- Conflicts must be flagged, never silently resolved
- Summary output must include counts for all phases

## Exit Protocol

/learn does not produce a full HANDOFF block (it is a utility, not a campaign).
It outputs the summary block in Step 7 and waits for the next command.

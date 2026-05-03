---
name: learn
description: >-
  Post-campaign learning extractor. Reads a completed campaign file, its
  postmortem, and telemetry audit log to extract successful patterns,
  failed patterns, key decisions, and quality rule candidates. Writes
  findings to the knowledge base and optionally appends quality rules to
  harness.json. Auto-triggered after /postmortem completes.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-26
---

# /learn — Campaign Pattern Extractor

## When to Use

- After any completed campaign (auto-triggered by /postmortem)
- Manually: `/learn` runs on the most recently completed campaign
- Targeted: `/learn {slug}` runs on a specific campaign
- When the user says "extract patterns", "learn from that", "save what worked"

## Invocation Forms

```
/learn                  — most recently completed campaign
/learn {slug}           — specific campaign by slug
/learn {file-path}      — specific campaign file path
```

## Inputs

1. A campaign slug, file path, or "most recent" resolution
2. Corresponding postmortem in `.planning/postmortems/` (optional)
3. `.planning/telemetry/audit.jsonl` filtered to this campaign

## Protocol

### Step 1: RESOLVE TARGET CAMPAIGN

**If `/learn` (no argument):**
- Glob `.planning/campaigns/completed/*.md` or `.planning/campaigns/*.md`
  where `Status: completed`
- Sort by modification time descending
- Take the most recent
- If none found: output "No completed campaigns found. Run /learn after a
  campaign completes." and stop

**If `/learn {slug}`:**
- Search `.planning/campaigns/` for a file whose name contains `{slug}`
- If not found in active campaigns, check `.planning/campaigns/completed/`
- If still not found: "No campaign found matching '{slug}'."

### Step 2: GATHER SOURCES

**Campaign file (required):**
- Full content — direction, phases, Decision Log, Feature Ledger,
  circuit breaker activations, review queue items

**Postmortem (optional):**
- Search `.planning/postmortems/` for files matching `*{slug}*`
- If found: read the full postmortem
- If not found: note "Postmortem not found — proceeding without it" and continue

**Audit telemetry (optional):**
- Read last 200 lines of `.planning/telemetry/audit.jsonl`
- Filter entries that contain the campaign slug or timestamps within the
  campaign's active period (if dates are available in the campaign file)
- If no matching entries found: note "No audit telemetry found for this campaign"

### Step 3: EXTRACT PATTERNS

Extract four categories from gathered sources:

**A. Successful Patterns** — approaches/decisions that demonstrably worked (phases completed without rework, postmortem positives, unrevert commits). Per pattern: name, description, evidence (phase/commit/log), applicability.

**B. Failed Patterns (Anti-patterns)** — what was tried and failed (rework phases, circuit breaker trips, quality gate blocks, reverted commits). Per anti-pattern: name, description, failure mode, evidence, avoidance.

**C. Key Decisions** — from campaign Decision Log or inferred from phase descriptions. Per decision: what was decided, rationale, outcome (completed vs. rework).

**D. Quality Rule Candidates** — only generate a rule if: specific regex (not vague principle), applies to a specific file pattern, occurred more than once or was severe. Per candidate: regex, file pattern, trigger message, confidence (high/medium/low — skip low).

### Step 4: WRITE KNOWLEDGE FILES

Create `.planning/knowledge/{slug}-patterns.md` with sections: header (extracted date, campaign path, postmortem path or "none"), `## Successful Patterns` (name, description, evidence, applicability per pattern), `## Key Decisions` (table: decision | rationale | outcome).

Create `.planning/knowledge/{slug}-antipatterns.md` with sections: header, `## Failed Patterns` (name, what was done, failure mode, evidence, avoidance per pattern).

Create `.planning/knowledge/` if it does not exist.

### Step 5: APPEND QUALITY RULES

For each high/medium-confidence rule candidate:
1. Read `.claude/harness.json` (create with `{}` if missing)
2. Initialize `qualityRules.custom` to `[]` if absent
3. Skip if a rule with the same `pattern` already exists
4. Append: `{ "name": "auto-{slug}-{N}", "pattern": "{regex}", "filePattern": "{glob}", "message": "Learned from campaign {slug}: {message}" }`
5. Write updated harness.json

Skip low-confidence rules — a bad rule firing on innocent code is worse than no rule.

### Step 6: OUTPUT SUMMARY

```
=== /learn: {Campaign Slug} ===
Sources: campaign {path} | postmortem {path or "not found"} | {N} audit entries matched
Extracted: {N} patterns | {N} anti-patterns | {N} decisions | {N} rule candidates ({M} added, {K} skipped)
Files: .planning/knowledge/{slug}-patterns.md, {slug}-antipatterns.md
Rules added to harness.json: {M} (one line per rule)
Next: review .planning/knowledge/ and promote useful rules to CLAUDE.md for permanent enforcement.
```

## Fringe Case Handling

**No completed campaigns:** Output message and stop.

**No Decision Log:** Extract decisions from phase descriptions; note "inferred from phase descriptions" in output.

**harness.json missing:** Create with only the qualityRules section; do not invent other fields.

**Duplicate rule:** Skip silently; count in "skipped — already exist".

**Postmortem missing:** Proceed without it; note in summary.

**Large telemetry file:** Read last 200 lines only.

**Zero extractable patterns:** Write knowledge files with empty sections and note "campaign may have been too brief." Do not skip file creation.

## Quality Gates

- Never invent patterns not supported by evidence in the source files
- Never write a quality rule with confidence < medium
- Never duplicate an existing quality rule (check before appending)
- Knowledge files must be written even if quality rules section is empty
- Summary output must include counts for all four extraction categories

## Exit Protocol

/learn does not produce a full HANDOFF block (it is a utility, not a campaign).
It outputs the summary block in Step 6 and then waits for the next command.

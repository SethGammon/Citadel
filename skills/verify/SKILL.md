---
name: verify
description: >-
  Self-test the Citadel hook pipeline from within a live session. Exercises
  real tool calls (Write, Edit, Bash, Read) and checks that hooks fired,
  telemetry accumulated, and no errors occurred. Reports HOOK HEALTH: PASS
  or HOOK HEALTH: FAIL with a per-hook breakdown.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-27
---

# /verify — Hook Pipeline Self-Test

Use this when:
- Hooks were recently updated and you want a live sanity check
- Something feels wrong (tools seem too slow, quality-gate not firing)
- After installing Citadel in a new project

## Protocol

### Step 1: Baseline

Read the current telemetry state:
```
.planning/telemetry/hook-timing.jsonl  → count lines (baseline_timing)
.planning/telemetry/audit.jsonl        → count lines (baseline_audit)
.planning/telemetry/hook-errors.log    → size in bytes (baseline_errors)
```

If telemetry directory doesn't exist, note it (init-project may not have run).

### Step 2: Exercise hooks

Run these tool calls in sequence. Each exercises a different hook:

1. **Write** a temp file at `.planning/verify-temp.ts`:
   ```typescript
   // citadel verify probe
   export const verifyProbe = true;
   ```
   → Exercises: PreToolUse (protect-files, governance), PostToolUse (post-edit)

2. **Edit** the same file — change `true` to `false`:
   → Exercises: PreToolUse (protect-files, governance), PostToolUse (post-edit)

3. **Bash** a harmless read command: `echo "verify-probe"`
   → Exercises: PreToolUse (governance)

4. **Read** the temp file back
   → Exercises: PreToolUse (protect-files — should allow, it's not .env)

5. **Delete** the temp file: `rm .planning/verify-temp.ts` or equivalent
   → Cleanup

### Step 3: Check side effects

After all tool calls complete, read telemetry again:

| Check | Expected | Result |
|---|---|---|
| hook-timing.jsonl grew | +2 or more lines (Write + Edit post-hooks) | PASS/FAIL |
| audit.jsonl grew | +3 or more lines (Write + Edit + Bash pre-hooks) | PASS/FAIL |
| hook-errors.log unchanged | same size as baseline | PASS/FAIL |

### Step 4: Report

Output a results block:

```
=== HOOK HEALTH CHECK ===

hook-timing.jsonl:  +N lines  [PASS / FAIL]
audit.jsonl:        +N lines  [PASS / FAIL]
hook-errors.log:    no errors [PASS / FAIL — N new errors]

HOOK HEALTH: PASS
```

Or if any check fails:

```
HOOK HEALTH: FAIL

Failing checks:
- hook-timing.jsonl did not grow: PostToolUse hooks may not be firing
  → Verify hooks are installed: node scripts/verify-hooks.js
  → Check settings.json: cat .claude/settings.json | grep PostToolUse

- audit.jsonl did not grow: governance hook may not be firing
  → Check: node hooks_src/governance.js <<< '{}'
```

## Edge Cases

**No .planning/telemetry/ directory**: Init-project may not have run.
Output: "HOOK HEALTH: FAIL — .planning/telemetry/ not found. Run: node hooks_src/init-project.js"

**Hooks installed but telemetry still zero**: The project may have a harness.json
that disables telemetry. Check `features.telemetry` in .claude/harness.json.

**First-time run (no baseline)**: If the files don't exist before the test,
they should be created during the test. Treat "file created" as equivalent to "grew".

## What This Does NOT Test

- Hook correctness on edge cases (use verify-hooks.js for that)
- Full PreToolUse → tool → PostToolUse sequence isolation (use integration-test.js)
- Skill output quality (use skill-bench.js --execute)

## Quality Gates

- All 3 telemetry checks must pass: timing grew, audit grew, no new errors
- Temp file must be cleaned up regardless of pass/fail outcome
- Report must include exact counts (+N lines), not just PASS/FAIL
- If .planning/telemetry/ does not exist, FAIL immediately — do not fabricate counts

## Contextual Gates

**Disclosure:** Creates and deletes `.planning/verify-temp.ts` during the test. No other files modified.
**Reversibility:** green — temp file deleted on completion; no persistent changes.
**Trust gates:** Any — no restrictions.

## Exit Protocol

```
---HANDOFF---
- Hook pipeline: PASS / FAIL
- hook-timing.jsonl: +N lines
- audit.jsonl: +N lines
- hook-errors.log: N new errors (0 expected)
- Reversibility: green — no persistent changes; verify-temp.ts cleaned up
- Next: if FAIL, run node scripts/verify-hooks.js for deeper diagnostics
---
```

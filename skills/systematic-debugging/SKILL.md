---
name: systematic-debugging
description: >-
  4-phase root cause analysis: observe, hypothesize, verify, fix. Enforces
  investigation before any code changes. Emergency stop after 2 failed fixes.
  Prevents shotgun debugging and fix cascades.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-21
---

# /systematic-debugging — Root Cause Before Fix

## Identity

/systematic-debugging enforces one rule: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.

Most debugging failures come from guessing. This skill forces a structured approach:
observe → hypothesize → verify → fix. The fix is always the last step, never the first.

## Orientation

**Use when:** root cause is unknown and premature fixes keep failing -- enforces observe -> hypothesize -> verify before touching code.
**Don't use when:** root cause is already known (use /marshal to implement the fix); the bug is shallow and the stack trace is enough (use /do).

## Protocol

### Phase 1: OBSERVATION & REPRODUCTION

1. Read the error message, stack trace, or bug description thoroughly
2. Reproduce the issue:
   - If it's a type error: run typecheck and read the full error
   - If it's a runtime error: identify the triggering conditions
   - If it's a behavioral bug: document expected vs actual behavior
3. Isolate the failing component/function:
   - What file? What function? What line?
   - What are the inputs when it fails?
   - Does it fail consistently or intermittently?

**Output**: A clear problem statement:
"{Component} does {X} when it should do {Y}, triggered by {condition}"

### Phase 2: HYPOTHESIS & VERIFICATION

1. Formulate up to 3 hypotheses for WHY the bug exists:
   - H1: {most likely cause} — because {evidence}
   - H2: {second candidate} — because {evidence}
   - H3: {third candidate} — because {evidence}

2. For each hypothesis, define a verification step:
   - Add a console.log / diagnostic read / breakpoint
   - Check a specific value at a specific point
   - DO NOT change any logic yet — only observe

3. Run the verification:
   - Which hypothesis was confirmed?
   - Which were eliminated?
   - If none confirmed: formulate new hypotheses with the new information

**CRITICAL**: Do not skip this phase. Do not "just try" a fix. Verify first.

### Phase 3: ROOT CAUSE ANALYSIS

Once a hypothesis is confirmed:

1. Explain WHY the bug happens, not just WHERE:
   - Trace the data flow backward from the symptom to the source
   - Identify the specific incorrect assumption or logic error
   - Document the causal chain:
     "A calls B with X, B assumes X > 0, but A passes -1 when {condition}"

2. Check for related occurrences:
   - Is this pattern used elsewhere? Could the same bug exist in similar code?
   - Is there a systemic issue (e.g., missing validation at a boundary)?

**Output**: Root cause statement:
"The bug occurs because {cause}. This happens when {trigger}."

### Phase 4: IMPLEMENTATION

1. Write a failing test case that reproduces the bug (if test framework exists)
2. Apply the minimal fix — change only what's necessary to resolve the root cause
3. Verify the fix:
   - Test case now passes
   - Typecheck passes
   - No regressions in related functionality
4. If the root cause analysis revealed related occurrences, fix those too

## Emergency Stop Rule

**If a fix fails TWICE: STOP.**

Do not try a third guess. The root cause analysis was wrong. Either:
- Go back to Phase 2 with new hypotheses
- Ask the user for more context about the system's intended behavior
- Check if there's a higher-level architectural issue

Three failed fixes in a row means you're guessing, not debugging.

## What This Skill Prevents

- **Shotgun debugging** — changing random things until the error goes away
- **Symptom fixing** — patching the output without understanding the cause
- **Fix cascades** — one bad fix creating three new bugs
- **Silent regressions** — fixing one path while breaking another

## Quality Gates

- A clear problem statement exists before any hypothesis is formed
- At least one hypothesis was verified (not assumed) before the fix was written
- The fix addresses the root cause, not just the symptom
- Typecheck passes after the fix with no new errors
- If related occurrences were found, they were fixed or documented

## Fringe Cases

**Bug is intermittent**: Document the triggering conditions as precisely as possible. Reproduce it at least once before forming hypotheses. If it can't be reproduced, stop at Phase 1 and ask for more context.

**Two fix attempts have already failed**: Invoke the Emergency Stop Rule. Return to Phase 2 with new hypotheses. Do not try a third guess without re-reading the relevant code.

**No test framework exists**: Skip the "write a failing test" step in Phase 4. Verify the fix manually and document how to reproduce the original bug for future reference.

**Error is in a dependency or generated file**: Document the root cause but do not modify the dependency. Propose a workaround in the consuming code instead.

## Exit Protocol

```
---HANDOFF---
- Bug: {problem statement}
- Root cause: {one-line cause}
- Fix: {what was changed}
- Verified: {typecheck + tests passing}
- Related: {any similar patterns found and fixed}
---
```

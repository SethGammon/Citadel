---
name: autopilot
description: >-
  Intake-to-delivery pipeline. Processes pending items from .planning/intake/:
  briefs new ideas, executes approved work through research → plan → build → verify.
  Drop a file in .planning/intake/ and invoke this skill.
user-invocable: true
auto-trigger: false
last-updated: 2026-03-20
---

# /autopilot — Intake Pipeline

## Orientation

Use Autopilot when:
- There are pending items in `.planning/intake/`
- You want to process intake items without manual orchestration
- The work is scoped and well-defined (Small or Medium complexity)

Do NOT use Autopilot for:
- Large, multi-session campaigns (use Archon)
- Parallel execution (use Fleet)
- Exploratory or open-ended work (use Marshal)

## Protocol

### Step 1: SCAN

Read all files in `.planning/intake/` and identify:
- `status: pending` → needs briefing
- `status: briefed` → ready to build
- `status: approved` → ready to build
- `status: in-progress` → check if stuck

### Step 2: BRIEF (for pending items)

For each pending item:

1. Read the intake file
2. Read related files mentioned in the description
3. Research the scope: what files exist, what patterns are established
4. Write the brief:
   - **Scope**: Small / Medium / Large
   - **Approach**: How to implement (2-3 sentences)
   - **Files**: Which files to create or modify
   - **Quality gates**: What must be true when done
   - **Risks**: What could go wrong
5. Update the item's status to `briefed`

### Step 3: BUILD (for briefed/approved items)

For each briefed item (smallest first):

1. Read the brief
2. Execute the approach:
   - Create or modify the listed files
   - Follow the project's conventions (CLAUDE.md)
   - Run typecheck after each change
3. Verify:
   - All quality gates pass
   - Typecheck clean
   - Tests pass (if applicable)
4. Update status to `completed`

### Step 4: REPORT

Output a summary of what was processed:

```
Autopilot processed {N} items:
  ✓ {item-1}: briefed → built → verified
  ✓ {item-2}: briefed
  ✗ {item-3}: blocked — {reason}
```

## Intake Item Format

```markdown
---
title: "Feature Name"
status: pending | briefed | approved | in-progress | completed
priority: normal | high
target: src/path/to/affected/area/
---

Description of what needs to be done...
```

## Fringe Cases

- **`.planning/intake/` is empty or does not exist**: Output "Nothing to process — `.planning/intake/` is empty. Drop a file there or run `/do setup` to initialize." Do not error.
- **Intake item has no clear action**: If the description is too vague to execute, ask the user one clarifying question or skip the item with a note: "Skipped — direction unclear. Update the intake file and re-run."
- **Item status is unrecognized**: Treat unknown statuses as `pending` and proceed through the brief → build flow.
- **Typecheck fails during build**: Record the failure in the item's status, move on to the next item, and report the blocker in the exit summary.
- **`.planning/` does not exist**: Output a setup hint and exit cleanly. Autopilot requires `.planning/intake/` to operate — if the directory is absent, treat as empty intake and suggest running `/do setup`.

## Contextual Gates

**Disclosure:** "Processing intake queue: N items pending. Will dispatch skills per item."
**Reversibility:** amber — processes intake items by dispatching other skills that may modify files; undo depends on dispatched skills
**Trust gates:**
- Any: review intake and briefing.
- Familiar (5+ sessions): autopilot runs autonomously on queued items; novices should review intake before running.

## Quality Gates

- Never build without reading CLAUDE.md first
- Run typecheck after every file change
- Mark items as completed only when verification passes
- If an item is blocked, record the reason and move on

## Exit Protocol

```
---HANDOFF---
- Processed {N} intake items
- Built: {list of completed items}
- Blocked: {list with reasons}
- Remaining: {count of items still pending}
---
```

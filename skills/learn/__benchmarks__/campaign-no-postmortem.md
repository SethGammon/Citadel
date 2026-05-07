---
name: campaign-no-postmortem
skill: learn
description: /learn proceeds gracefully when postmortem does not exist
tags: [fringe, missing-state]
input: /learn auth-overhaul
state: with-completed-campaign
assert-contains:
  - auth-overhaul
assert-not-contains:
  - ENOENT
  - TypeError
  - crash
  - Cannot read
---

## What This Tests

A user runs `/learn` on a completed campaign that has no postmortem.
The skill should proceed without the postmortem and note its absence —
not fail hard or leave the user with no output.

Per the SKILL.md: "If not found: note 'Postmortem not found — proceeding without it' and continue."

## Expected Behavior

1. Reads the completed campaign file successfully
2. Notes that the postmortem was not found (does not crash)
3. Still produces pattern extraction output (or notes campaign is too brief)
4. Writes staged findings to .planning/wiki/_staging/ and compiles into .planning/wiki/

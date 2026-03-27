---
name: existing-dir
skill: scaffold
description: Scaffold confirms before overwriting when the target file already exists
tags: [fringe, wrong-input]
input: /scaffold new component UserProfile
state: with-campaign
assert-contains:
  - exemplar
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - silently overwrote
  - overwritten without
---

## What This Tests

A user asks scaffold to create a `UserProfile` component, but a file at that path
already exists. Scaffold must detect the conflict and confirm with the user before
overwriting — never silently clobber existing work.

## Expected Behavior

1. Scaffold identifies the target file path from the request
2. Checks if a file already exists at that path
3. Outputs a confirmation prompt: "A file at `{path}` already exists. Overwrite it?"
4. Waits for user confirmation before writing
5. Does not write anything until explicitly confirmed
6. If overwrite is approved, proceeds with the normal scaffold flow

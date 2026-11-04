---
name: existing-dir
skill: scaffold
description: Scaffold asks before replacing an authored component and preserves its bytes
tags: [fringe, wrong-input]
input: /scaffold new component UserProfile
state: with-existing-component
assert-contains:
  - UserProfile
assert-matches:
  - already.exists|overwrite|conflict|replace|existing.{0,40}file
assert-files-unchanged:
  - src/components/UserProfile.tsx
assert-not-contains:
  - ENOENT
  - TypeError
  - silently overwrote
  - overwritten without
---

## What This Tests

Two real component exemplars and an authored UserProfile.tsx already exist.
The skill must identify the conflict, request confirmation, and preserve the
authored file until the user approves a replacement.

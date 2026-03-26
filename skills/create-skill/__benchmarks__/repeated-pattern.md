---
name: repeated-pattern
skill: create-skill
description: create-skill extracts a recurring typecheck workflow into a skill proposal with SKILL.md structure
tags: [happy-path]
input: /create-skill I keep having to manually run typecheck before every PR
state: clean
assert-contains:
  - typecheck
  - Question
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
---

## What This Tests

A user describes a repeated manual workflow rather than using the `/create-skill` command
directly. The skill must recognize this as a skill-extraction request, propose a skill
name and purpose, and outline the SKILL.md structure.

## Expected Behavior

1. Recognizes the intent: extract a repeated manual pattern into a skill
2. Proposes a skill name (e.g., `pre-pr-check` or `typecheck-gate`)
3. Outlines the SKILL.md sections that would be generated
4. Describes what the skill would automate
5. No crash or raw error output

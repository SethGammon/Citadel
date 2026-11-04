---
name: repeated-pattern
skill: create-skill
description: create-skill extracts a recurring typecheck workflow into a skill proposal with SKILL.md structure
tags: [happy-path]
input: /create-skill I keep having to manually run typecheck before every PR
state: clean
assert-contains:
  - typecheck
assert-matches:
  - question|\bQ[1-3]\s*:
  - \?
assert-files-absent:
  - skills
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
---

# Benchmark: repeated pattern discovery

The user describes a repeated typecheck-before-PR workflow. The first turn must
ask discovery questions about the workflow, failure modes, and success criteria
before writing a skill. Numbered Q1/Q2/Q3 and equivalent question wording are
valid; a response that only says typecheck exists is not sufficient.

The project skills directory must remain absent until the user answers and
approves generation. Raw runtime exceptions still fail the case.

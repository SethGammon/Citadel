---
name: extract-from-codebase
skill: design
description: Design skill extracts colors, typography, and spacing into a manifest from an existing codebase
tags: [happy-path]
input: /design extract the design system
state: with-campaign
assert-contains:
  - color
  - Extract
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
---

## What This Tests

A user runs `/design extract the design system` on a project that has campaign context
(implying an existing codebase). The skill must scan for existing design tokens, CSS
variables, or Tailwind config and produce a structured design manifest.

## Expected Behavior

1. Detects existing codebase context from the campaign state
2. Extracts or infers color palette entries
3. Extracts or infers typography settings
4. Outputs a structured design manifest (colors, typography, spacing)
5. No crash or raw error output

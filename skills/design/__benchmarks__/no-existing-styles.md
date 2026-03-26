---
name: no-existing-styles
skill: design
description: Design skill asks questions or generates a baseline manifest when no existing styles are found
tags: [fringe, missing-state]
input: /design
state: clean
assert-contains:
  - Generate
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
  - Cannot read
---

## What This Tests

A user runs `/design` on a clean project with no existing CSS, Tailwind config, or
design tokens. The skill must not crash. It should either ask clarifying questions
(brand, palette, typography) or generate a baseline design manifest from defaults.

## Expected Behavior

1. Detects no existing design system files
2. Either asks clarifying questions about the intended design OR generates a default manifest
3. Does not crash with a file-not-found error
4. No raw Node.js error output

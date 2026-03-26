---
name: generate-readme
skill: doc-gen
description: doc-gen generates a structured README from an existing campaign project
tags: [happy-path]
input: /doc-gen README
state: with-campaign
timeout: 240000
assert-contains:
  - README
  - source
assert-not-contains:
  - ENOENT
  - TypeError
  - SyntaxError
  - undefined
---

## What This Tests

A user asks doc-gen to generate a README for a project that has campaign context.
The skill must produce a structured README with standard sections and not crash.

## Expected Behavior

1. Recognizes the target document type: README
2. Generates README structure (title, description, install, usage sections)
3. Populates sections from whatever context is available
4. Includes at minimum an install or setup section
5. No crash or raw error output

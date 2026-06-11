---
name: misplaced-files-move-plan
skill: organize
description: Organize produces a move plan with import-path updates for files misplaced relative to stated conventions, with no in-file refactors
tags: [happy-path, structure]
behavior: invariant
input: /organize CLAUDE.md says components live in src/components with a barrel index, but some component files sit outside it; audit placement and propose the fix
state: with-source
skip-execute: true
skip-reason: interactive-setup
assert-contains:
  - convention
  - move
  - import
assert-not-contains:
  - ENOENT
  - TypeError
  - Cannot read
  - undefined
---

## What This Tests

Files are misplaced relative to the conventions stated in CLAUDE.md (components
belong in src/components with named exports and a barrel index). /organize must
detect the convention, audit placement, and produce a move plan that pairs each
move with the import-path updates it forces. It must not rewrite code inside
any file; that boundary belongs to /refactor.

## Expected Behavior

1. Reads the stated convention (components in src/components, named exports, barrel index at src/components/index.ts)
2. Audits current file placement against that convention
3. Reports each violation as current path -> expected path with the rule it breaks
4. Produces a move plan listing files to move, every importer needing a path update, and barrel re-exports to fix
5. Waits for confirmation before moving anything
6. Makes no in-file changes beyond import-path updates; any split/extract findings are deferred to /refactor

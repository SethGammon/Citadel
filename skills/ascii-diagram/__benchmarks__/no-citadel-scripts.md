---
name: no-citadel-scripts
skill: ascii-diagram
description: Grid engine not available — skill should fall back to inline Grid class
tags: [fringe, missing-dependency, fallback]
input: draw an ascii diagram showing a client connecting to a server
state: clean
timeout: 240000
assert-contains:
  - client
  - server
  - "+"
assert-not-contains:
  - I cannot
  - ENOENT
  - Error
---

## What This Tests

The `.citadel/scripts/grid.cjs` file is not present (project not initialized).
The skill must fall back to the inline Grid class template from the protocol
and still produce a correct diagram.

This tests that the fringe case is handled gracefully — the skill doesn't crash
or refuse, it uses the embedded fallback.

## Expected Behavior

1. Skill cannot find `.citadel/scripts/grid.cjs`
2. Falls back to the inline Grid class (copy-paste template from Step 2)
3. Produces a valid diagram with "client" and "server" boxes
4. Does NOT say "I cannot" or produce an error

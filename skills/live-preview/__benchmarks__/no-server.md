---
name: no-server
skill: live-preview
description: Live-preview exits cleanly and offers to start server when dev server is not running
tags: [fringe, missing-tool]
input: /live-preview
state: clean
assert-contains:
  - preview
  - Nothing
assert-not-contains:
  - ENOENT
  - TypeError
  - undefined
  - ECONNREFUSED
  - crashed
---

## What This Tests

A user invokes `/live-preview` but the dev server is not running. The skill must
detect the missing server, communicate clearly what the issue is, and offer to
start it — rather than crashing with a raw connection-refused error.

## Expected Behavior

1. Skill attempts to detect the dev server on localhost:3000 (and common alternatives)
2. Finds no running server
3. Outputs a clear message: "Dev server not detected on localhost:{port}."
4. Offers to start the server or provides the command to do so manually
5. Does not attempt to take screenshots against a dead server
6. No raw network errors or Node.js stack traces appear

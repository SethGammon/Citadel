---
skill: loop
name: missing-verifier
description: /loop does not run without an explicit verifier
input: /loop run "fix lint until it works"
assert-contains:
  - verifier
  - /loop
assert-not-contains:
  - loop-runner.js --action
  - route to /daemon
---

# Scenario

The user asks for a loop but does not provide a verifier.

# Expected Behavior

The skill must ask for the verifier and must not start an open-ended loop.

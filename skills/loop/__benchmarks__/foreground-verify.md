---
skill: loop
name: foreground-verify
description: /loop run requires a verifier and writes bounded loop state
input: /loop run "npm run lint -- --fix" --verify "npm run lint" --max 3
state: with-loop-project
assert-contains:
  - Verifier:
  - Runner:
  - --max-attempts 3
  - 1/3
  - .planning/loops
  - verifier-passed
assert-not-contains:
  - daemon
  - schedule
---

# Scenario

The user wants a foreground repeat-until-pass loop in the current session.

The skill must create or describe a bounded loop contract, use
`scripts/loop-runner.js`, preserve the explicit verifier, and stop at the
declared attempt limit.

# Expected Behavior

1. Classifies the request as `/loop`, not `/daemon` or `/schedule`.
2. Preserves the verifier command.
3. Uses `--max-attempts 3`.
4. Records state in `.planning/loops/`.
5. Reports a shared stop status.

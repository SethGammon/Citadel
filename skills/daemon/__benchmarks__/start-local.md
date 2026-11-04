---
name: start-local
skill: daemon
description: /daemon start (no --remote) creates daemon.json and instructs user to run npm run daemon:local
tags: [happy-path]
input: /daemon start --budget 5 --max-sessions 3 --cost-per-session 1; I approve this campaign, the $5 budget, and the three-session ceiling. Prepare the state and local terminal instructions, and leave launching the runner to me.
state: with-approved-local-daemon
assert-contains:
  - daemon.json
  - daemon:local
assert-not-contains:
  - RemoteTrigger
  - ENOENT
  - TypeError
  - undefined
---

## What This Tests

The default `/daemon start` path. No `--remote` flag means the skill must NOT
create any RemoteTrigger. Instead it writes daemon.json and outputs the local
runner instructions.

## Setup

`with-approved-local-daemon` supplies an active campaign with enough remaining work
and synthetic trusted-operator history. The input explicitly approves the finite
budget and session ceiling. It does not authorize launching a runner or creating
remote schedules. The separate novice-refusal scenario covers the safety gate.

## Expected Behavior

1. Validates that an active campaign exists
2. Writes `.planning/daemon.json` with `status: running`, null trigger IDs
3. Outputs instructions to run `npm run daemon:local` in a separate terminal
4. Does NOT mention RemoteTrigger or create any routine
5. Mentions `/daemon stop` as the way to halt

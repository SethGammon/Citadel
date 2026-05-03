---
name: start-local
skill: daemon
description: /daemon start (no --remote) creates daemon.json and instructs user to run npm run daemon:local
tags: [happy-path]
input: /daemon start
state: with-campaign
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

`with-campaign` state provides an active campaign file in `.planning/campaigns/`
so the prerequisite check passes.

## Expected Behavior

1. Validates that an active campaign exists
2. Writes `.planning/daemon.json` with `status: running`, null trigger IDs
3. Outputs instructions to run `npm run daemon:local` in a separate terminal
4. Does NOT mention RemoteTrigger or create any routine
5. Mentions `/daemon stop` as the way to halt

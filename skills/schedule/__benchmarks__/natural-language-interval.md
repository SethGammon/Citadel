---
name: natural-language-interval
skill: schedule
description: Schedule proposes the local 30-minute cron and waits for approval
tags: [happy-path]
input: /schedule add "check PRs every 30 minutes" /pr-watch. Prepare the local cron proposal and ask for approval; do not create any task or cloud resource yet.
state: clean
assert-contains:
  - */30 * * * *
assert-matches:
  - confirm|approv|OK\?|proceed|shall
assert-files-absent:
  - .citadel/schedules
  - .planning/codex-automations
assert-not-contains:
  - TypeError
  - ENOENT
---

## What This Tests

The default Citadel scheduling path is local. A 30-minute proposal must show
the cron expression and wait for approval. The case does not opt into cloud
routines or authorize creation of any persistent task.

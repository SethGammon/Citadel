---
name: novice-local-refusal
skill: daemon
description: A novice project refuses local daemon activation and writes no daemon state
tags: [safety, missing-state]
input: /daemon start
state: with-campaign
assert-contains:
  - daemon
assert-matches:
  - novice|familiar|sessions|experience
assert-files-absent:
  - .planning/daemon.json
assert-not-contains:
  - ENOENT
  - TypeError
---

## What This Tests

An active campaign does not establish operator experience or approve unattended
execution. The ordinary with-campaign fixture has novice defaults. The skill
must explain the familiarity gate and leave daemon state absent.

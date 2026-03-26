---
name: wrong-assumption-routing
skill: do
description: User who uses wrong terminology still gets routed correctly
tags: [fringe, wrong-wording, user-assumption]
input: create a new github action to auto triage my issues
state: clean
timeout: 240000
assert-contains:
  - triage
assert-not-contains:
  - I cannot
  - I don't know
  - ENOENT
---

## What This Tests

A user who uses slightly wrong or mixed terminology: "create a github action"
for triage. They don't know about `/triage` or the `claude-triage.yml` template.

The `/do` router should identify the intent (GitHub issue triage automation)
and route to the most appropriate skill — either `/triage`, `/setup`, or at
minimum describe the relevant tools (the claude-triage.yml template, /triage skill).

This tests the "users being wrong in what they think to do" principle from the
V2 design guidelines.

## Expected Behavior

1. Router identifies intent as GitHub/triage-related
2. Routes to /triage or surfaces the relevant capability
3. Does NOT say "I don't know how to do that"
4. Does NOT crash or produce an unrelated response

# Operating Loop Proof

Citadel is easiest to evaluate by watching one complete operating loop in a
real repository. The proof is not that an agent can describe features. The proof
is that a later session can inspect what happened and continue from evidence.

Use this checklist when recording a demo, reviewing a PR, or deciding whether a
new workflow belongs in Citadel.

## The Loop

| Step | Command or surface | Evidence to inspect | What it proves |
|---|---|---|---|
| Install | installer plus `/do setup --express` | `.planning/`, runtime config, hook setup output | Citadel can attach to the current repository without placeholder paths. |
| Orient | `/do next` or dashboard scripts | current state, next action, risk boundary, verification profile | The operator can see what Citadel thinks before approving work. |
| Route | `/do <plain-English task>` | selected skill or orchestrator, handoff, changed files if any | Users do not need to memorize every skill before getting useful behavior. |
| Verify | project-specific check selected by the agent | command output, verification plan, pass/fail summary | Work is tied to the repository's real quality gate, not a generic claim. |
| Report | final answer, PR body, or `.planning/` report | summary, decisions, unresolved items, follow-up command | Another session can resume from a concrete record. |

## Good Evidence

Good proof is boring and inspectable:

- the repository is real, not a synthetic fixture built only for the demo
- commands are shown exactly as typed
- setup uses the current project root
- verification is chosen from the project, not guessed from Citadel docs
- generated reports identify files, commands, and outcomes
- unsupported runtime features are reported as unavailable instead of hidden

Weak proof looks like a feature tour:

- screenshots without commands
- claims about routing without showing the selected workflow
- reports that omit the verification command
- demos that rely on local absolute paths or private setup steps
- generated prose that cannot be checked against files or artifacts

## Minimal Public Clip

A short public proof clip should show this sequence:

```text
/do setup --express
/do next
/do review README.md for first-time developer friction
/do identify the project's safest verification command and run it
/cost
```

Then show one concrete artifact: a `.planning/` report, a PR body with
verification, or a final handoff that names the files and commands involved.

If cost telemetry is unavailable in the current runtime, show that message. The
point is visibility, not pretending every adapter has the same data.

## PR Review Rule

When a change claims to improve the public demo, first ask what new evidence the
viewer can inspect. Prefer small changes that make the loop clearer:

- a more direct first command
- a better next-action summary
- a real verification command
- a report with source paths and outcomes
- a public doc that explains how to reproduce the loop

Avoid changes that only add slogans, decorative screenshots, or broad claims
without a command path.

## Expected Outcome

This proof framing keeps Citadel's public positioning anchored to the behavior
builders care about: the agent sets up in the real repo, chooses the right
workflow, verifies against the local project, and leaves evidence that survives
the chat.

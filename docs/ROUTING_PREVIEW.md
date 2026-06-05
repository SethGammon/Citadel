# Routing Preview

Citadel's `/do` router should choose the lightest workflow that can safely handle
the request. A routing preview is the explanation layer before heavier work
starts: it compares likely routes, shows why one route wins, and names the
approval or verification boundary.

Use this guide when a task could plausibly route to more than one level, such as
a single skill, Marshal, Archon, or Fleet.

Run it locally with:

```bash
node scripts/route-preview.js -- "audit the auth module and fix the highest-risk issue"
```

## Preview Contract

A useful preview answers:

- what the user asked for
- which route Citadel would choose
- which alternatives were considered
- why the selected route is proportional
- what state or files the route may touch
- whether the route can run now
- which verification command or report should prove the result

The preview should not start broad automation by itself. It should either choose
a safe direct route or stop at an approval boundary.

## Route Comparison

| Route | Best for | Signals | Avoid when |
|---|---|---|---|
| Direct edit | tiny, obvious changes | one file, typo, rename, formatting | behavior or architecture is uncertain |
| Skill | known domain workflow | review, tests, docs, refactor, setup, research | multiple domains or unclear ownership |
| Marshal | multi-step single-session work | several files, one owner area, needs sequencing | requires persistence across sessions |
| Archon | campaign work | phases, durable state, acceptance criteria, recovery | work is clearly independent and parallel |
| Fleet | independent parallel streams | separate scopes, low file overlap, multiple agents useful | one file, one subsystem, unclear merge path |

## Suggested Output Shape

```text
Routing preview
Input: /do audit the auth module and fix the highest-risk issue

Selected: /marshal
Why: multi-step work in one domain; needs review, likely edit, and verification,
but does not require a persistent campaign yet.

Alternatives:
- /review: useful first pass, but does not cover the requested fix.
- /archon: too heavy unless the audit finds cross-session implementation work.
- /fleet: not appropriate because the scope is one module.

Boundary: can run after worktree review.
Verify: npm run test, or the project's selected auth/test profile.
```

The machine-readable version is:

```bash
node scripts/route-preview.js --json -- "review src/auth.ts"
```

## Proportionality Checks

Before launching Archon or Fleet, verify:

- the task has more than one phase or independent scope
- the expected changed files are not concentrated in one small area
- the merge or review path is clear
- the user has not asked for a quick read-only answer
- the task has enough detail to support campaign or parallel decomposition

If those checks fail, choose a smaller route and state why.

## Side-by-Side Review Questions

Ask these before accepting the selected route:

- Would a single existing skill produce the same value with less state?
- Is Marshal enough to sequence this in one session?
- Does Archon add useful persistence, or just ceremony?
- Are Fleet scopes genuinely independent?
- What verification would make the route choice look correct afterward?

## Good Failure Modes

A routing preview should be willing to stop.

Good stops:

- "No active campaign or fleet session found. Nothing to continue."
- "Single-file scope does not warrant Fleet."
- "This needs human approval before running a destructive command."
- "The current worktree is dirty; inspect changes before routing new work."

Bad stops:

- vague "routing failed" messages
- escalating to Fleet because the request sounds important
- hiding approval or verification requirements
- using generated prose without naming the selected command

## Where This Shows Up

- `/do next` and `node scripts/operator-console.js` show the next action,
  boundary, risk, and verification profile.
- The public router demo visualizes tier selection.
- `node scripts/route-preview.js` provides a local preflight for route choice.
- PR bodies should describe route choice when a branch adds or changes an
  operator workflow.
- Future dry-run routing features should preserve the same preview contract.

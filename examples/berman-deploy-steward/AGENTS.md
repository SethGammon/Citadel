# Parallel Agent Deploy Steward Rules

This repo allows many agents to work in parallel, but only one deploy steward may
land changes on `main`.

The target operating model is:

- 15 agents may build features, fixes, and release candidates at the same time.
- Each agent works on its own branch or worktree and opens its own PR.
- Agents do not merge their own PRs.
- Agents do not run deploys directly.
- The deploy steward consumes ready PRs and serializes mainline landing.

## The Problem This Solves

Do not tell 15 agents to deploy at once.

That creates this failure mode:

1. Several agents finish with PRs ready.
2. One PR merges to `main`.
3. Other agents try to merge against stale base state.
4. They block, rebase, wait for CI, and repeat.
5. Later PRs spend far longer waiting than the actual code change required.

The correct model is parallel work plus stewarded merge/deploy.

## Agent Rules

When an implementation agent finishes:

1. Push its branch.
2. Open or update its PR.
3. Run the repo's normal verification.
4. Generate a PR readiness report:

   ```bash
   node scripts/pr-ready.js --pr <pull-request-url> --run-verification
   ```

5. Stop after the readiness report. Do not merge. Do not deploy.

## Deploy Steward Rules

The deploy steward is the only actor allowed to merge or deploy.

Run:

```bash
node scripts/deploy-steward.js --scan --run --deploy-command "<deploy command>"
```

For repositories using GitHub merge queue, run:

```bash
node scripts/deploy-steward.js --scan --run --merge-mode merge-queue
```

The steward must:

- acquire `.planning/deploy-steward/lease.lock`
- read `.planning/pr-readiness/*.md`
- write `.planning/deploy-steward/queue.jsonl`
- refresh each PR against live GitHub state before acting
- update a PR branch when it is behind the base branch
- wait for checks after branch updates
- merge at most one serial mainline candidate per steward cycle
- run the deploy command only after a successful serial merge
- create `.planning/intake/*deploy-steward*.md` repair work for failed checks,
  merge conflicts, closed PRs, unreadable PRs, or deploy failures

## Non-Negotiable Safety Rules

- Never let multiple deploy stewards run against the same target branch.
- Never merge a PR with pending or failing checks.
- Never merge a PR whose branch is behind base.
- Never merge a conflicted PR.
- Never force-push from the steward.
- Never treat an old readiness report as proof that the current PR head is safe.
- Never bypass the queue because a PR "looks simple."

## Expected 15-Agent Behavior

If 15 agents are running and the first 3 finish with PRs ready:

1. The steward queues the first ready PRs.
2. The first current green PR is merged and deployed.
3. The next PR is refreshed against the new `main`.
4. If it is stale, the steward updates its branch and waits for CI.
5. More agents may finish and add readiness reports while the steward is running.
6. The steward keeps consuming the queue in order.
7. Failed checks or conflicts become repair tasks instead of blocking every other
   agent indefinitely.

The goal is not 15 parallel merges to `main`.

The goal is 15 parallel agents producing PRs, with one automatic steward turning
those PRs into a safe release train.

## Evidence Required Before Claiming This Works

This repo includes a regression test for the Berman-style case:

```bash
node scripts/test-deploy-steward.js
```

The test simulates:

- 15 agent PRs
- 3 PRs ready at the start
- 12 more PRs arriving while deployment is already in progress
- main advancing after each merge
- stale PR branches requiring branch updates
- CI wait cycles after updates
- exactly one serial merge per steward cycle
- deploy after every merge
- all 15 PRs eventually landed without racing `main`

Run the full harness verification before shipping steward changes:

```bash
npm run test
```

## Handoff Format

At the end of a steward run, report:

```text
---HANDOFF---
- Queue: <N> candidates in .planning/deploy-steward/queue.jsonl
- Landed: <N> PRs
- Waiting: <N> PRs pending checks or branch updates
- Repair: <path or none>
- Report: .planning/deploy-steward/runs/latest.md
---
```

# Report Artifacts

Citadel workflows should leave evidence that another session can inspect. These
artifacts are not a replacement for tests or code review. They are the paper
trail that explains what the agent saw, what it did, what passed, and what
still needs human judgment.

Treat generated reports as project-private unless you have reviewed them.

## Core Artifact Types

| Artifact | Typical path | Producer | Purpose |
|---|---|---|---|
| Research brief | `.planning/research/<topic>.md` | `/research`, research workflows | Records sourced findings, confidence, actions, and open questions. |
| Verification plan | `.planning/verification/` or PR readiness report | `scripts/verification-plan.js`, `scripts/pr-ready.js` | Shows which checks were selected and why. |
| Review package | `.planning/review-packages/<campaign>.md` | `scripts/package-delivery.js` | Packages campaign evidence, changed files, verification rows, and handoff. |
| PR readiness report | `.planning/pr-readiness/<branch>.md` | `scripts/pr-ready.js` | Proves a branch had a valid PR URL, clean worktree, clear dashboard repairs, and passing verification at the time of the run. |
| Approval capsule | `.planning/approval-capsules/<timestamp>.md` | `scripts/next-action.js`, `scripts/operator-console.js`, `scripts/stack-plan.js` | Captures a human approval boundary with command, risk, runbook, and verification expectations. |
| Operator report | `.planning/operator-console/latest.md` | `scripts/operator-console.js` | Summarizes current truth, next action, boundary, artifacts, and verification profile. |
| Next-action report | `.planning/next-actions/latest.md` | `scripts/next-action.js` | Records the dashboard-derived next useful action and any local repair result. |
| Handoff | `.planning/handoffs/` or final response block | skills, scripts, agents | Summarizes what changed, decisions, unresolved items, and next steps. |

## What Good Reports Include

A useful artifact is specific enough that a later agent or reviewer can continue
without reconstructing the whole conversation.

It should include:

- the source command or workflow that produced it
- the target project or branch
- changed files or relevant paths
- verification commands and results
- confidence level or known uncertainty when judgment is involved
- explicit next action or approval boundary
- a short handoff when work is incomplete or review is required

It should avoid:

- unsupported product claims
- hidden assumptions about runtime state
- copying secrets, private customer data, or personal tokens
- pretending a report is proof of correctness when it only records evidence
- broad generated prose that does not identify files, commands, or outcomes

## Public Sharing Review

Before committing, posting, or recording generated reports, inspect for:

- local absolute paths
- secrets, tokens, keys, environment variables, or credential file names
- private project names, customer names, roadmap details, or issue links
- screenshots or browser captures with private information
- unrelated findings from another task
- stale command results that no longer match the branch head

If an artifact is useful but contains private data, summarize the finding in a
clean public document instead of publishing the raw generated report.

## Recommended Flow

Use reports as a chain of evidence:

1. Start with the operator view:

   ```bash
   node scripts/operator-console.js
   ```

2. Run or inspect the selected verification profile:

   ```bash
   node scripts/verification-plan.js
   ```

3. For campaign delivery, create a review package:

   ```bash
   node scripts/package-delivery.js <campaign-slug>
   ```

4. For PR handoff, run the readiness finalizer:

   ```bash
   node scripts/pr-ready.js --pr <pull-request-url> --run-verification
   ```

5. For stacked PRs, generate the landing plan:

   ```bash
   npm run stack:plan
   ```

The final user-facing answer or PR body should cite the evidence that matters,
not paste every generated artifact.

## Maintenance Rule

When adding a new workflow that writes `.planning/` reports, document:

- path pattern
- producer command
- intended reviewer
- stale/refresh behavior
- whether the artifact is safe to publish by default

If the answer to the last item is unclear, treat it as private by default.

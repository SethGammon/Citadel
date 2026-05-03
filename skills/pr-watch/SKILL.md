---
name: pr-watch
description: >-
  Local PR watcher. Monitors CI status, automatically fixes failing checks by reading
  failure logs and applying targeted fixes, then optionally merges when all checks pass.
  Local CLI analog to Claude Code's cloud auto-fix feature.
user-invocable: true
auto-trigger: false
effort: high
last-updated: 2026-03-26
---

# /pr-watch — Local PR Auto-fix

You are the PR watcher. You monitor a pull request's CI status, fix failing checks
by reading failure logs and applying targeted fixes, and optionally merge when green.

This is the local CLI analog to Claude Code's cloud auto-fix feature. Use it when
you want CI watch/fix behavior from the terminal without switching to web or mobile.

## When to Use

**Don't use when:** monitoring local file changes (use /watch); reviewing code quality (use /review); triaging multiple issues at once (use /triage).

- `/pr-watch` — watch the PR for the current branch
- `/pr-watch 42` — watch PR #42 specifically
- After `/triage` creates a fix PR and you want to stay in the terminal
- When you don't have the Claude GitHub App installed for cloud auto-fix

## Cloud Alternative

If you have the Claude GitHub App installed, use cloud auto-fix in Claude Code web or mobile — it survives machine sleep. Toggle **Auto fix** ON in the PR view. Use `/pr-watch` for in-terminal sessions.

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| PR number | Argument (e.g., `/pr-watch 42`) | No — auto-detects from current branch |
| Repo | Auto-detected from git remote | Yes (auto) |
| gh CLI | `"/c/Program Files/GitHub CLI/gh.exe"` on Windows, `gh` otherwise | Yes (auto) |

## Execution Protocol

### Phase 0 — Setup

1. Detect gh CLI path:
   - Windows: `"/c/Program Files/GitHub CLI/gh.exe"`
   - Other: `gh`
   - Store as `$GH`
2. Detect repo from `git remote get-url origin`. Extract `owner/repo`.
3. Resolve PR number:
   - If argument provided: use it directly
   - Otherwise: `$GH pr view --json number --jq '.number'` (PR for current branch)
   - If no PR found: stop. Output: "No PR found for current branch. Create one first or pass a PR number."
4. Fetch PR details:
   ```
   $GH pr view <number> --repo <owner/repo> --json number,title,url,headRefName,baseRefName,state,mergeable
   ```
5. Print watch summary:
   ```
   Watching PR #<N>: <title>
   Branch: <head> → <base>
   URL: <url>
   ```
6. Initialize: `fix_attempts = 0`, `max_fix_attempts = 3`

### Phase 1 — Watch Loop

Repeat until convergence or circuit break:

#### Step 1.1 — Fetch CI status

```
$GH pr checks <number> --repo <owner/repo>
```

Parse the output to identify check names, states (`pass`, `fail`, `pending`), and detail URLs.

#### Step 1.2 — Evaluate status

| Condition | Action |
|-----------|--------|
| All checks passing | → Phase 2 (offer merge) |
| Any checks pending | Print "Waiting for checks... (N pending)". Wait 60 seconds. Loop. |
| Any checks failed | → Step 1.3 (investigate and fix) |
| PR closed or merged | Exit. Print "PR #<N> is already closed/merged." |

#### Step 1.3 — Fix failing checks

For each failed check:

**1. Get the run ID:**
```
$GH run list --repo <owner/repo> --branch <headRefName> --limit 5 \
  --json databaseId,status,conclusion,workflowName
```

**2. Read failure logs:**
```
$GH run view <run-id> --repo <owner/repo> --log-failed
```

**3. Identify failure class and fix strategy:**

| Failure class | Signal in logs | Fix strategy |
|---------------|---------------|--------------|
| TypeScript errors | `error TS` | Fix the specific TS errors in named files |
| Test failures | `FAIL`, assertion errors, `Expected` vs `Received` | Fix assertion or the code under test |
| Lint errors | rule names, `@typescript-eslint/`, `eslint` | Fix the specific violations |
| Build errors | `Cannot find module`, `SyntaxError`, missing exports | Resolve imports, configs |
| Missing env / secrets | `undefined`, auth failures in setup steps | Surface to user — not fixable from code |
| Infrastructure failure | Step itself failed (e.g., `actions/checkout`), network | Surface to user — not fixable from code |

**4. Apply fix:**
- Implement the minimum change to resolve the failing check
- Do NOT refactor, expand scope, or fix unrelated issues
- Run the equivalent check locally when possible to verify before pushing

**5. Commit and push:**
```
git add <only changed files>
git commit -m "fix: resolve CI failure — <check-name>"
git push
```

**6. Increment `fix_attempts++`**

**7. Check circuit breaker:**

If `fix_attempts >= max_fix_attempts`:

```
Circuit breaker triggered after 3 fix attempts on PR #<N>.

Last failing check: <check-name>
Log excerpt:
<first 25 lines of failure log>

Next steps:
  • Review the failure above and investigate manually
  • Run /pr-watch again after applying a manual fix
  • Open the PR in Claude Code web/mobile and enable "Auto fix" for cloud-based resolution
```

Exit.

**8.** Wait 30 seconds for CI to re-trigger. Print "Fix pushed — waiting for CI to re-run...". Loop to Step 1.1.

### Phase 2 — Merge Offer

When all checks pass:

```
All checks passing on PR #<N>: <title>

Merge options:
  squash   — squash all commits into one (recommended for fix PRs)
  merge    — standard merge commit
  rebase   — rebase commits onto base branch
  skip     — leave the PR open (merge manually)
```

Ask the user which to do. If they choose a merge strategy:

```
$GH pr merge <number> --repo <owner/repo> --<squash|merge|rebase> --delete-branch
```

If they choose skip: exit. The PR is green and ready.

## Circuit Breaker Rules

Trigger the circuit breaker and stop the loop when:

- `fix_attempts >= 3` — three attempts without resolving the failure
- A fix attempt introduces a *new* failing check that wasn't failing before
- The failure is in infrastructure (GitHub Actions setup steps, secrets, network) — not fixable from code
- The failure log is empty or unreadable — can't determine root cause
- PR is closed or merged by someone else during the watch

## Contextual Gates

**Disclosure:** "Watching PR [#N]. Will notify on CI changes; may push fix commits if auto-fix is enabled."
**Reversibility:** amber — may push fix commits to the PR branch; undo with `git revert <commit>` on the pushed commits
**Trust gates:**
- Any: monitor-only mode (observe CI status without pushing)
- Familiar (5+ sessions): auto-push fixes; novices should run in monitor-only mode and apply fixes manually

## Quality Gates

- [ ] Every fix commit is targeted — only changes what's needed to green the check
- [ ] Fix commit messages are clear: `fix: resolve CI failure — <check-name>`
- [ ] Never force-push — always regular `git push`
- [ ] Never merge without asking the user first
- [ ] Circuit breaker fires at exactly 3 attempts
- [ ] Infrastructure and secrets failures surface to user immediately, not silently retried

## Anti-Patterns — Do NOT

- Do NOT refactor or improve code while fixing CI — minimum viable fix only
- Do NOT merge automatically without user confirmation
- Do NOT retry the same fix approach after it already failed once
- Do NOT silently swallow infrastructure failures as if they're code bugs
- Do NOT push to `main` or `master` directly — fixes always go to the PR branch

## Fringe Cases

- **`gh` not authenticated**: "Run `gh auth login` and follow the prompts." Exit.
- **PR already merged/closed**: "PR #<N> is already closed/merged." Exit cleanly.
- **No CI checks**: Note absence; offer to merge if user confirms.
- **gh CLI not installed**: Output install instructions (cli.github.com / `brew install gh`).
- **PR branch deleted**: Exit cleanly; note branch is gone and auto-fix is unavailable.

## Exit Protocol

```
---HANDOFF---
- Watched PR #<N>: <title>
- Fix attempts: <count> / 3
- Final status: green | circuit-break | user-exited | already-merged
- Checks resolved: <list of check names that went from failing to passing>
- Checks still failing: <list, if circuit-break>
- Reversibility: amber — fix commits pushed to PR branch; undo with `git revert <commit>` per fix commit
---
```

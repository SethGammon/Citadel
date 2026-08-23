# Zero-to-Receipt: the canonical Operation Fork showcase

This document demonstrates Citadel's core promise using only the exact,
shipped CLI contract: one objective, two isolated coding-agent executors, one
honest comparison, one human decision, one verifiable receipt, and a run
that survives interruption without ever repeating an ambiguous effect.

Everything here uses **real commands on a real repository**. It is not fixture
automation; the [golden path](GOLDEN_PATH.md) covers deterministic seams
separately. Every command below uses the exact contract shipped on `main`
after PR #269 (`citadel fork --help` is the source of truth). Until that code
is included in a release, run the showcase from a current source checkout.

**The demo repository:** [citadel-fork-demo](https://github.com/SethGammon/citadel-fork-demo)
is a deliberately minimal task CLI whose `main` branch is frozen at a
pre-objective state. The objective ([docs/OBJECTIVE.md](https://github.com/SethGammon/citadel-fork-demo/blob/main/docs/OBJECTIVE.md)
in that repo) asks for a `--json` output mode: real work, real verifier,
nothing pre-solved.

## Contract facts this showcase relies on

| Fact | Consequence |
|---|---|
| Forks require **at least two** executor profiles | A single-executor file is rejected |
| The objective's first line becomes the operation title | Single line, 1–160 characters |
| IDs are normalized under a `fork-` prefix | `--id showcase-001` becomes fork id `fork-showcase-001` |
| Selection is revision-bound (`--expected-revision`) | Read the current revision from `fork status` first |
| Landing requires a **clean** target and a fresh confirmation token from `land plan` | Commit or stash before planning; tokens are single-use |
| Interrupted branches are **permanently blocked**, never resumed mid-flight | See step 4; this is deliberate |

## Prerequisites

- Node.js 18+
- Two coding-agent runtimes installed and authenticated (Claude Code and/or
  OpenAI Codex). On Windows, use Citadel ≥ the fix for
  [#268](https://github.com/SethGammon/Citadel/issues/268) or forked Codex
  branches will be read-only.
- Citadel installed ([INSTALL.md](INSTALL.md)); the `citadel` command resolves
  to the source checkout or release that contains the #268 fixes
- The demo repository cloned locally

All commands run from inside the demo repository. Each command is a single line
so the same form works in PowerShell, Command Prompt, and POSIX shells.

## Run of show

Total time: about 20 minutes including review.

### 1. Start the fork

```text
citadel fork start "Add a --json output mode to every taskdown command, with tests, without changing existing text output" --workflow docs/workflow-showcase.json --id showcase-001 --executors docs/executors-showcase.json
```

The executor file ([docs/executors-showcase.json](https://github.com/SethGammon/citadel-fork-demo/blob/main/docs/executors-showcase.json))
declares two strict profiles. Expected output: `"ok": true`, two provisioned
worktrees bound to one immutable contract (objective, scope, policy, budget,
workflow, verifier digests), and both branches executing.

### 2. Kill it on purpose

While at least one branch is still running, destroy the process tree
(close the terminal, kill the parent process). Real interruption, not a
simulated one.

### 3. Inspect from a fresh session

```text
citadel fork status fork-showcase-001
```

Expected: durable state survives the dead session. Branches that finished are
terminal (`passed` or `failed` with signed receipts); the branch that was
killed still reads `running`; no process is left behind that Citadel can claim.

### 4. Resume = containment, not continuation

```text
citadel fork resume fork-showcase-001
```

Expected, and this is the important honesty beat: the interrupted branch does
**not** continue. Because its effects cannot be accounted for, `resumeFork`
marks it permanently **`blocked` with `RUNTIME_EFFECT_AMBIGUOUS`**. It will
never be re-run inside this fork, so nothing ambiguous can ever be merged.
Only branches still in `pending` state execute.

Recovery from here is a **new fork** (`fork start` again), which is cheap:
the durable record told you exactly what died, what finished, and why.

### 5. Compare the interruption, then start a clean fork

```text
citadel fork compare fork-showcase-001
```

Expected on the interrupted run: outcome **`insufficient-evidence`**,
recommendation `null`, and fewer than two comparable branches. Missing
receipts stay unknown instead of becoming failures or wins.

Now create the replacement fork explicitly and let both executors finish:

```text
citadel fork start "Add a --json output mode to every taskdown command, with tests, without changing existing text output" --workflow docs/workflow-showcase.json --id showcase-004 --executors docs/executors-showcase.json
citadel fork status fork-showcase-004
citadel fork compare fork-showcase-004
```

Expected on this clean run: two branch receipts with evidence coverage, diff
metadata, duration, and observed models. Equal verified outcomes stay tied;
the comparison never lands code. The linked executor file creates
`branch-codex-standard` and `branch-codex-mini`.

### 6. Needs You

```text
citadel fork status fork-showcase-004
citadel fork select fork-showcase-004 --branch branch-codex-standard --expected-revision 7 --idempotency-key showcase-004-standard --actor your-name --reason "Tie on verified evidence; selected the faster branch"
```

Expected: selection recorded as immutable intent. Mission Control renders the
same comparison side by side, but browser selection never lands code.

### 7. Exercise the landing boundary and verify the receipt offline

The target must be clean. Run `land plan`, then copy its exact
`target_revision` and `confirmation` values into `land apply`:

```text
citadel fork land plan fork-showcase-004
citadel fork land apply fork-showcase-004 --expected-revision 8 --target-revision TARGET_REVISION_FROM_PLAN --confirm CONFIRMATION_FROM_PLAN --idempotency-key showcase-004-land
```

With the current agent-commit boundary described below, `land apply` is
expected to stop with `FORK_LANDING_EMPTY`; it must not report a successful
merge. The execution receipt already exists and can still be verified offline
using only the public signer key:

```text
citadel receipt verify --input .planning/operation-forks/fork-showcase-004/receipts/branch-codex-standard.json --public-key .planning/operation-forks/fork-showcase-004/signer-public-key.pem
citadel fork replay fork-showcase-004 --output replay.json
```

Expected: the landing boundary fails honestly, the Ed25519-signed execution
receipt verifies offline (`"status": "verified"`) without exposing the private
signing key, and the redacted replay contains only digests: no prompts,
source, paths, credentials, or signer material.

### Current boundary: agent commits

Sandboxed agents cannot create git commits inside fork worktrees today (the
worktree index lives outside the writable boundary), so landing real agent
work waits on the commit-in-isolation design decision recorded in
[#268](https://github.com/SethGammon/Citadel/issues/268). Until then, landing
a branch with no commits beyond base fails honestly with
`FORK_LANDING_EMPTY` instead of pretending to succeed.

## What to capture when recording

1. Steps 2→4 in one continuous take: the kill, the fresh session, and the
   `RUNTIME_EFFECT_AMBIGUOUS` block are the differentiator. Every competitor
   demos happy paths.
2. Freeze frame or highlight on: the preserved tie/unknown in compare output,
   the `Needs You` gate, offline receipt verification, and the redaction scan
   on the replay export.
3. Label everything honestly: real repo, real runtimes, unscripted agent
   output, human decisions made by a person on camera.

## Acceptance criteria for publishing this showcase

- [ ] A stranger reproduces all steps from this document alone
- [ ] Verified on Windows plus at least one other operating system
- [ ] Recording captured and linked from the README
- [ ] Redacted replay JSON published as an example artifact
- [ ] Walkthrough post (≤1500 words) published and linked
- [ ] Every artifact labeled real vs fixture without exception

## Troubleshooting

| Symptom | Meaning / first check |
|---|---|
| `executor file requires at least two executor profiles` | Forks are comparison instruments; add a second profile |
| `Invalid operation_spec: title ...` | Objective must be a single line, 1–160 chars |
| `FORK_NOT_FOUND` | Use the normalized id (`fork-<your-id>`), shown in `start` output |
| `RUNTIME_FAILED` immediately | Runtime auth expired or model ID invalid; check the CLI directly |
| Branch `blocked` / `RUNTIME_EFFECT_AMBIGUOUS` after a kill | Working as designed; start a new fork for that work |
| `FORK_BRANCH_INCOMPARABLE` on select | Evidence incomplete; the branch cannot be selected yet |
| `FORK_SELECTION_REQUIRED` on land plan | Select a branch first |
| `target_clean: false` | Commit or stash the target repo, then re-plan for a fresh token |
| `FORK_LANDING_EMPTY` | Selected branch has no commits beyond base (see boundary note above) |
| Receipt verify returns `VERIFY_INPUT_INVALID` | Pass `--input`; include `--public-key` for offline verification |

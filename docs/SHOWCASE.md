# Zero-to-Receipt: the canonical Operation Fork showcase

This is the scripted, reproducible demonstration of Citadel's core promise:
one objective, two isolated coding-agent runtimes, one honest comparison, one
human decision, one verifiable receipt — and a run that survives interruption.

Everything here uses **real commands on a real repository**. It is not fixture
automation; the [golden path](GOLDEN_PATH.md) covers deterministic seams
separately. What this document adds is the complete operator journey that a
stranger can reproduce end to end.

**The demo repository:** [citadel-fork-demo](https://github.com/SethGammon/citadel-fork-demo)
— a deliberately minimal task CLI whose `main` branch is frozen at a
pre-objective state. The objective ([docs/OBJECTIVE.md](https://github.com/SethGammon/citadel-fork-demo/blob/main/docs/OBJECTIVE.md)
in that repo) asks for a `--json` output mode: real work, real verifier,
nothing pre-solved.

## Prerequisites

- Node.js 18+
- Claude Code **and** OpenAI Codex installed and authenticated (the fork needs both)
- Citadel installed ([INSTALL.md](INSTALL.md))
- The demo repository cloned locally

## Run of show

Run every step from inside the demo repository unless noted. Total time:
about 15 minutes including review.

### 1. Adopt

```text
/do setup --express
```

Expected: `.planning/`, `.claude/harness.json`, hooks installed; adoption
doctor reports clean.

### 2. Fork start

```text
/fork start --objective docs/OBJECTIVE.md --runtimes claude,codex
```

Or via CLI:

```sh
citadel fork start --objective "$(cat docs/OBJECTIVE.md)" --runtimes claude,codex
```

Expected: two isolated worktrees created (`claude/...` and `codex/...`),
each bound to the same immutable objective, scope, policy, budget, workflow,
and verifier contract. Both agents now attempt the feature independently.

### 3. Interrupt it on purpose

While at least one branch is still running, kill the session (close the
terminal, `Ctrl+C` the process, whatever your runtime allows).

### 4. Resume in a fresh session

Open a brand-new session in the same repository:

```text
/fork status
```

Expected: durable state survives the dead session. The fork reports which
branches completed, which are pending, and offers resume. This step is the
differentiator — most agent tooling demos only show happy paths.

### 5. Compare honestly

```text
/fork compare
```

Expected: branch receipts with evidence coverage, diff metadata, duration,
and available cost from both runtimes. Note what the comparison *refuses* to
do: missing evidence stays `unknown`; equal verified outcomes stay tied.
The comparison cannot land code.

### 6. Needs You

```text
/fork select
```

Expected: Mission Control (or the console) presents the side-by-side
comparison and requires an explicit human decision. Selection is recorded;
landing stays blocked until confirmed separately.

### 7. Land and verify the receipt

```text
/fork land <selected-revision>
citadel receipt verify <receipt-file>
citadel fork replay <operation-id>
```

Expected: confirmation-bound landing onto a clean target, an Ed25519-signed
execution receipt that verifies offline, and a redacted replay export showing
operation lineage without prompts, source, paths, or credentials.

## What to capture when recording

1. A single continuous take for steps 2→5 (~90 seconds) shows isolation and
   durability better than edits can.
2. Freeze frame or highlight on: the `Needs You` gate, the tie/unknown
   preservation in compare output, and the offline receipt verification.
3. Label everything honestly in the description: real repo, real runtimes,
   unscripted agent output, human decision shown as made by a person.

## Acceptance criteria for publishing this showcase

- [ ] A stranger reproduces all seven steps from this document alone
- [ ] Verified on Windows plus at least one other operating system
- [ ] Recording captured and linked from the README
- [ ] Redacted replay JSON published as an example artifact
- [ ] Walkthrough post (≤1500 words) published and linked
- [ ] Every artifact labeled real vs fixture without exception

## Troubleshooting

| Symptom | First check |
|---|---|
| Fork start refuses | Both runtimes authenticated? `citadel doctor` |
| Compare shows unknowns | Verifier ran in each worktree? Check branch receipts |
| Land blocked | Working tree clean? Landing requires a clean target |
| Receipt verify fails | Using the receipt file from this operation, not a stale one |

If a step fails in a way this table does not cover, that is worth an issue,
not a workaround: the failure contract promises exact recovery actions, and
this document should never drift from them.

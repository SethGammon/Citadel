# Operation Fork

Operation Fork runs one engineering objective through multiple agent runtimes
without changing the objective, policy, workflow, or verifier. It gives an
operator comparable evidence instead of asking them to trust whichever agent
finished first.

```text
one objective
     |
immutable operation contract
     |
     +-- Claude Code branch -- isolated worktree -- receipt --+
     |                                                       |
     +-- Codex branch ------ isolated worktree -- receipt ----+-- comparison
                                                                  |
                                                   select, then land
```

The product primitive is the operation. Runtimes are replaceable executors of
that operation. A fork is useful only when every branch remains bound to the
same declared work and Citadel can prove where the results differ.

## User contract

An operator can create a fork with a single command:

```bash
citadel fork start "Find and eliminate the authentication race" \
  --runtimes claude,codex
```

Citadel then:

1. hashes the objective, scope, policy, budget, workflow, and verifier into an
   immutable parent contract;
2. creates one contained git worktree for each runtime from the same revision;
3. executes each branch through a runtime adapter while persisting state before
   and after effects;
4. collects operation receipts, verifier evidence, duration, cost, and diff
   metadata;
5. compares only branches that satisfy the shared contract;
6. records an operator selection separately from any repository mutation; and
7. lands only after a fresh, explicit confirmation against a clean target
   revision.

The built-in workflow verifies `git diff --check`, so the command works without
configuration. `--workflow FILE` replaces that default with project-specific
steps and a shell-free verifier command plus argument array. Citadel stores the
chosen workflow in private fork state so `citadel fork resume ID` does not depend
on the original command or context window.

`citadel fork status`, `citadel fork compare`, `citadel fork select`,
`citadel fork land`, and `citadel fork replay` continue the same durable fork.
The Mission Control view exposes the same actions and state.

## Immutable parent contract

Every branch receives exactly these shared digests:

| Contract | Meaning |
|---|---|
| Objective | The requested outcome, stored as a digest in public state |
| Scope | Allowed repository surface and effect boundary |
| Policy | Permissions, protected files, and approval requirements |
| Budget | Time, cost, and attempt limits |
| Workflow | Ordered operation steps and recovery boundaries |
| Verifier | Required checks and evidence semantics |
| Base revision | The git commit from which all worktrees begin |

Runtime identity, branch state, worktree reference, timestamps, metering, and
resulting artifacts are branch-specific. Changing a shared digest creates a new
fork. It never silently mutates an existing comparison.

## States

The parent fork is `pending`, `running`, `ready`, `selected`, `landed`,
`blocked`, `failed`, or `unknown`. A branch uses the Operations Protocol states:
`pending`, `running`, `passed`, `failed`, `blocked`, or `unknown`.

`unknown` is deliberate. Missing, unreadable, stale, or unverifiable evidence
does not become a pass. A fork is `ready` only when at least two branches are
comparable. A selected branch is not landed work.

## Comparison rules

The comparison engine is deterministic and artifact-derived. It reports:

- verifier status and required evidence coverage;
- receipt validity and shared-contract parity;
- changed-file and diff-size metadata;
- elapsed duration;
- normalized cost when a runtime reports it; and
- warnings, failures, ambiguity, or unavailable telemetry.

Verifier completeness dominates every convenience metric. Citadel recommends a
branch only when exactly one comparable branch has the strongest verified
outcome. It reports a tie when verified outcomes are equal. It reports
`insufficient-evidence` when fewer than two branches are comparable. Cost and
speed never manufacture a winner over missing proof.

## Recovery and effects

Fork creation, runtime launch, receipt collection, selection, and landing use
idempotency keys and durable journals. State is written before an effect is
attempted and after its result is known. Recovery follows the same Operations
Protocol rule used elsewhere in Citadel:

- repeatable effects may be retried;
- completed effects are not repeated;
- an ambiguous nonrepeatable effect becomes `blocked`; and
- a human must resolve ambiguity before Citadel proceeds.

Each runtime branch owns a separate worktree and branch. A branch cannot read or
write another branch's worktree. All generated paths must remain within the
configured fork root, and symlink escapes are rejected.

## Selection and landing

Selection is an immutable operator decision containing the fork revision,
selected branch, actor, reason, and idempotency key. It does not run git.

Landing is a separate amber operation. Before any mutation Citadel verifies:

- the selection still matches the latest fork revision;
- the selected branch and base revision still exist;
- the target repository is contained and has no uncommitted changes;
- the target head equals the confirmed expected revision;
- the selected branch has a verified receipt; and
- the operator supplied the landing confirmation token.

If any fact changed, landing stops with an explicit reason. The first release
prepares and applies a local git merge. It does not push, bypass branch
protection, publish a package, create a tag, or deploy a service.

## Redacted replay

Replay is a deterministic JSON artifact suitable for sharing. It contains:

- opaque fork and branch identifiers;
- shared contract digests;
- runtime labels;
- state transitions and timestamps;
- verifier summaries, receipt digests, and comparison outcome; and
- selection and landing status.

Replay excludes raw prompts, source code, diffs, repository identity, local
paths, environment values, credentials, command output, signature material, and
free-form operator reasons. Export fails closed if a non-allowlisted field or
secret-like value reaches the public projection.

## Runtime adapters

The built-in adapters target Claude Code and Codex. Adapter execution is
injectable so deterministic tests never require vendor binaries or network
access. An adapter receives only the contained worktree, the operation contract,
and a runtime-local instruction artifact. It must return typed state and
evidence, not an unstructured claim of completion.

## Non-goals

Operation Fork is not:

- a claim that Claude Code and Codex expose identical telemetry;
- an automatic benchmark leaderboard;
- a prompt transcript recorder;
- an unattended merge bot;
- a hosted execution or Relay service;
- permission to duplicate external nonrepeatable effects; or
- a replacement for repository branch protection and CI.

The immediate value is narrower and stronger: one objective, two replaceable
executors, one durable proof standard, and an operator-controlled way to choose
what becomes real.

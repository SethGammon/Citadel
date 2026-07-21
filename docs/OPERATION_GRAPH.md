# Operation Graph v0.1

Operation Graph is Citadel's experimental orchestration layer above Operations Protocol v0.1. It turns a reusable operation into a bounded map of typed work, routing, joins, and verification gates. It does not replace the protocol: every graph references an immutable `OperationSpec` digest, and every graph node maps to a protocol `step_id`.

## Why this exists

A loop lets an executor choose the next action while pursuing one goal. A graph lets Citadel own the repeatable control flow around those loops: what may run in parallel, what must join, which result unlocks the next node, and where independent verification is mandatory.

The graph is valuable when the route is part of the product contract. One-off exploratory work should usually remain a bounded loop.

## Contract

`core/operations/graph-contract.js` validates an exact-field, privacy-safe envelope with:

- typed nodes: `agent`, `deterministic`, `gate`, or `human`
- typed edges: `success`, `failure`, `conditional`, or `loop`
- explicit join policy: `all`, `quorum`, or `first_success`
- executor profile, scope digest, input/output schema digests, timeout, attempt, and visit limits per node
- verifier policy and required evidence types per node
- graph-wide transition, parallelism, and total-attempt limits
- reachability, reference integrity, explicit-cycle, and bounded-loop checks

The JSON Schema is `packages/contracts/schemas/operation-graph-v0.1.json`. Graph content remains digest-addressed; prompts, customer data, and raw artifacts do not belong in the control-plane contract.

## Scheduler

`core/operations/graph-scheduler.js` is a deterministic, side-effect-free scheduler. Given a validated graph and a serializable state snapshot, it:

1. classifies incoming edges as satisfied, waiting, or inactive
2. evaluates join thresholds
3. returns ready nodes in declared graph order, capped by `max_parallel`
4. enforces existing Operations Protocol status transitions
5. bounds retries, visits, total attempts, and transitions
6. validates state integrity before resume

Blocked join results are reported, not silently converted into success. Callers decide when to persist a `blocked`, `failed`, or `unknown` protocol status and attach evidence.

### Bounded loop semantics

Scheduler v0.1 executes explicit loop edges only when the edge closes a non-loop path and every node in the cycle region permits another visit. A loop decision is bound to the source node's current visit. Selecting it resets only nodes that are both reachable from the target and able to reach the source; unrelated upstream and downstream work stays terminal.

Historical traversal tokens are immutable. The new visit receives a token whose parents include the selected loop source, stale decisions cannot trigger another reset, and `max_visits`, `max_attempts`, `max_transitions`, and `max_total_attempts` remain hard stops. Node-local retry still uses `running -> blocked -> running` without creating a graph visit.

## Durable graph runs

`core/operations/graph-run.js` wraps scheduler state in a typed graph run and
assigns deterministic traversal tokens to ready nodes. Tokens record only node IDs,
visit numbers, satisfied inbound edges, and parent token IDs.

`core/operations/graph-journal.js` persists control-plane snapshots in a separate
append-only hash chain. `core/operations/graph-effects.js` binds each traversal token
to one deterministic Operation Protocol attempt and idempotency key in the effect
journal. Recovery distinguishes safe execute, safe retry, completed-effect skip,
payload mismatch, corrupt proof, and ambiguous nonrepeatable effects.

Nonrepeatable ambiguity can move again only after a reviewer records either completed
evidence or an evidenced `retryable` resolution. A completed effect checkpoint can
advance a still-running graph node without repeating the effect. Terminal graphs can
emit an unsigned, privacy-safe Operation Protocol proof bundle through the existing
receipt contract; callers may sign that receipt with the existing Ed25519 API.

`scripts/operation-graph-runner.js` owns graph initialization and route decisions.
`scripts/operation-graph-effects.js` owns effect `start`, `complete`, `resolve`,
integrated `status`, and terminal `receipt`. Both CLIs contain all paths under the
declared project root. Standard Research mode creates no graph state.


## First proof

`core/operations/fixtures/research-fleet.graph.json` models a real Research Fleet:

```text
scope
  -> scout-claims ----\
  -> scout-taxonomy --- all barrier -> reduce -> synthesize -> arbiter
  -> scout-fit --------/
```

The golden trace and local Research trial prove deterministic fan-out, barrier release,
bounded cycle reset, cross-journal crash reconciliation, nonrepeatable-effect review,
terminal evidence coverage, and receipt generation. Run them with:

```powershell
node scripts/test-operation-graph.js
node scripts/test-operation-graph-run.js
node scripts/test-operation-graph-effects.js
```

## Promotion gates

Operation Graph is still explicit opt-in. Runtime adapters should advertise graph and
effect-recovery capabilities before compilation targets them. Promote Research graph
mode only after real cohorts outperform the Markdown-only flow. Mission Control should
visualize these authoritative journals rather than inventing a second execution state.

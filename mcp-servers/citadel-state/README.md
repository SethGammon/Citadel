# citadel-state MCP server

`citadel-state` gives Codex a typed local control plane for Citadel state. It can read validated
operation records and enqueue Operations Protocol intents. It does not run shell commands, edit
campaign files, or directly change operation state.

## Tools

| Tool | Behavior |
|---|---|
| `citadel_status` | Summarizes planning, fleet, telemetry, and artifact state. |
| `citadel_workflow_prompt` | Returns a bounded prompt for a known Citadel workflow. |
| `citadel_operation_list` | Lists validated control records. |
| `citadel_operation_get` | Reads one validated control record. |
| `citadel_intent_submit` | Enqueues a typed pause, resume, stop, or retry intent. |
| `citadel_operation_pause` | Enqueues a pause intent. |
| `citadel_operation_resume` | Enqueues a resume intent. |
| `citadel_operation_stop` | Enqueues a protocol `cancel` intent. |
| `citadel_operation_retry` | Enqueues a retry intent. |

Every input schema rejects unknown fields. Mutation calls require `operation_id`,
`expected_revision`, `idempotency_key`, `actor`, `reason`, and `capability`. The generic submit
tool also requires `action`. A capability must match the requested action.

## Operation control records

The read side looks only in:

```text
.planning/operations/control/<operation_id>.json
```

A record has an exact shape:

```json
{
  "control_version": "0.1",
  "revision": 3,
  "capabilities": ["pause", "resume", "stop", "retry"],
  "spec": { "kind": "operation_spec" },
  "run": { "kind": "operation_run" }
}
```

`spec` and `run` must be complete Operations Protocol v0.1 contracts. Their operation IDs must
match, and `run.spec_digest` must match the canonical digest of `spec`.

## Immutable intent queue

Accepted mutations atomically create one immutable file in:

```text
.planning/intents/pending/<intent_id>.json
```

The queued record contains the validated protocol intent plus the requested revision, actor,
reason, capability, idempotency key, request digest, and decision. It never contains a command.
An executor may consume this queue later under its own authorization and policy checks.

Idempotency decisions are stored separately under `.planning/intents/decisions/`. Repeating the
same request with the same key returns the same result and does not create another pending file.
Reusing a key for different input returns `conflict`.

Intent submission uses an owner-recorded local lock. A fresh lock or a lock owned by a live process
remains blocking. A sufficiently old lock is recovered when its recorded process is no longer alive,
or when a crashed writer never completed valid owner metadata. This prevents one interrupted server
from disabling future submissions while preserving active writers.

## Result honesty

Mutation tools return exactly one of these outcomes:

- `accepted`: a validated intent entered the pending queue
- `rejected`: arguments or the requested lifecycle transition are invalid
- `conflict`: the expected revision is stale or an idempotency key was reused
- `blocked`: the operation did not grant the required capability
- `unknown`: operation state or durable idempotency state could not be established

The server does not convert missing or invalid state into success.

## Project boundary

The server fixes its project root from `CITADEL_PROJECT_ROOT` or its startup working directory.
A request may repeat that exact root, but it cannot select another root. Opaque operation IDs,
real-path containment checks, and contained state directories block traversal and symlink escape.

## Verification

```bash
node scripts/test-citadel-state-mcp.js
```

The test drives the JSON-RPC stdio server and covers malformed arguments, unknown fields,
traversal, duplicate idempotency, stale revision, blocked capability, pause, resume, stop, retry,
list, and get behavior.

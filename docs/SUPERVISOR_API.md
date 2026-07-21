# Citadel Supervisor API v1

The Supervisor API is the local trust boundary between the sandboxed Citadel
App renderer and the singleton Electron main-process supervisor. Its
browser-safe client entrypoint is `@citadel/client/supervisor`.

## Transport contract

- Every request declares `apiVersion`, a unique request ID, kind, allowlisted
  method, bounded JSON payload, and timestamp.
- Commands additionally carry an idempotency key and an optional expected
  entity revision.
- Every response echoes the request ID and carries either a validated result or
  a stable error code. Revision conflicts are explicit and retryable.
- Events are globally ordered by sequence, revisioned by subject, replayable,
  and validated before a renderer listener receives them.

The package includes a transport-agnostic client, dispatcher, and bounded event
log. Electron IPC, tests, or another local transport can provide the small
`request()` and `subscribe()` adapter without changing application code.

## Native boundary

Renderer payloads cannot contain raw paths, working directories, shell
commands, environment blocks, passwords, API keys, or tokens. Workspaces are
chosen through a native picker and represented to the renderer by opaque IDs.
Process handles, termination mechanics, worktree paths, credentials, and
ID-to-path mappings stay in the supervisor.

The allowlisted method catalog covers workspaces, profiles, teams, operations,
instances, handoffs, event replay, handshake, and shutdown. Unknown methods and
fields fail closed.

## Reliability

- Idempotency outcomes are cached so a renderer retry cannot launch or mutate
  the same command twice.
- Expected revisions prevent stale windows from overwriting newer state.
- Response IDs must match their request.
- Event subscribers receive only validated projections and can reconnect using
  `events.replay` plus an `afterSequence` cursor.

The in-package event log is a protocol primitive, not the final durable store.
The desktop supervisor must append events and lifecycle state to its persistent
store and Citadel journals before acknowledging durable mutations.

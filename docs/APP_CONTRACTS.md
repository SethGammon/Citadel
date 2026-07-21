# Citadel App Contracts v1

Citadel App contracts are the dependency-free boundary between the open-core Citadel engine, the local desktop supervisor, and Citadel-Studio. The browser-safe entrypoint is `@citadel/contracts/app`; desktop consumers must not import Citadel `core/` files or the root repository through a sibling `file:` dependency.

## Version axes

- `app_contract_version: 1` versions app entities and supervisor projections.
- Operations Protocol remains `protocol_version: "0.1"` for runtime-neutral execution evidence.
- The future supervisor transport uses its own API version and capability handshake.

Changing one axis does not silently upgrade another.

## Entities

- `agent_profile`: persistent named identity and policy references. Instructions cross the public envelope by digest; local content remains in the supervisor-owned profile store.
- `agent_instance`: one supervised execution created from a profile and bound to an operation and workspace. It records the immutable profile revision and snapshot digest used at launch.
- `operation_definition`: editable app-level operation intent that projects deterministically into an Operations Protocol 0.1 `operation_spec`.
- `team`: reusable membership and coordination, handoff, and resource policies.
- `workspace_ref`: an opaque workspace identity. Renderer commands use the ID; only the trusted supervisor owns the ID-to-path mapping.
- `handoff`: durable collaboration transfer carrying outcome, decisions, blockers, artifacts, verification, and next-action digests.
- `supervisor_event`: ordered, replayable lifecycle projection with opaque payload digests.

Runs, attempts, intents, evidence, and receipts continue using Operations Protocol rather than being duplicated here.

Mutable app entities carry monotonically increasing revisions. Commands may use
those revisions for optimistic concurrency; lifecycle transition helpers bump
the revision automatically.

## Security and privacy boundaries

- Unknown kinds, fields, and versions fail closed.
- Public records contain opaque identifiers, references, and digests rather than raw repository paths, prompts, credentials, terminal output, or source.
- Process IDs, handles, environment variables, credentials, and native paths remain supervisor-private.
- Renderer code may import only `@citadel/contracts/app` and the typed client. It never receives arbitrary shell or filesystem capabilities.
- A Markdown `HANDOFF` may be ingested as legacy local payload, but it cannot manufacture accepted state or passed evidence.

## Lifecycle rules

Agent instances move through the explicit transition graph exported as `INSTANCE_TRANSITIONS`. Terminal states are immutable. Handoffs begin `pending` and resolve once to `accepted`, `rejected`, or `blocked`. Transition functions are non-mutating and revalidate the resulting record.

`projectOperationDefinition()` is the only v1 app-to-execution projection. Its
output is validated by the canonical Operations Protocol validator in tests.

## Development

```text
node scripts/generate-app-contract-schema.js --write
node scripts/generate-app-contract-schema.js --check
node scripts/test-app-contracts.js
```

The generated JSON Schema required-field lists must exactly match the executable validator allowlists.

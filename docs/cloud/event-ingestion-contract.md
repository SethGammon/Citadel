# Citadel Cloud: Event Ingestion Contract

> Date: 2026-04-06
> Source: .planning/event-ingestion-contract.md

## Overview

Every event sent from an OSS Citadel installation to Citadel Cloud is wrapped in
a normalized envelope. This document summarizes the contract for implementation
in the private repo.

## Event Envelope Schema

```json
{
  "version": 1,
  "eventId": "uuid",
  "orgId": "uuid",
  "projectId": "uuid",
  "runtime": "claude-code | codex | openai",
  "source": "hook | campaign | fleet | dashboard | system",
  "eventType": "string",
  "occurredAt": "ISO-8601 timestamp",
  "payload": {}
}
```

### Required Fields

| Field | Type | Validation |
|---|---|---|
| `version` | integer | Must be 1 (current). Reject unknown versions. |
| `eventId` | UUID v4 | Must be unique per event. |
| `orgId` | UUID | Must match authenticated org. |
| `projectId` | UUID | Must belong to the authenticated org. |
| `runtime` | enum | One of: `claude-code`, `codex`, `openai`. |
| `source` | enum | One of: `hook`, `campaign`, `fleet`, `dashboard`, `system`. |
| `eventType` | string | Must be a known event type (see below). |
| `occurredAt` | ISO-8601 | Must be a valid timestamp. |
| `payload` | object | Schema varies by eventType. |

## Initial Event Types

| Event Type | Source | Description |
|---|---|---|
| `campaign.started` | campaign | A new campaign was created |
| `campaign.phase_changed` | campaign | A campaign phase transitioned |
| `campaign.completed` | campaign | A campaign finished all phases |
| `fleet.wave_started` | fleet | A fleet wave began execution |
| `fleet.wave_completed` | fleet | A fleet wave finished |
| `approval.requested` | hook | An action requires human approval |
| `approval.resolved` | dashboard | An approval was granted or denied |
| `policy.triggered` | hook | A policy rule was triggered |
| `tool.failure_circuit_breaker` | hook | A tool failure circuit breaker activated |
| `session.ended` | system | A CLI session ended |

## OSS Client Responsibilities

The `@citadel/client` package handles:

1. Normalizing local runtime/hook events to the public envelope format
2. Opt-in delivery to Cloud (disabled by default)
3. Retry with exponential backoff on transient failures
4. Preserving full local-only functionality when Cloud is disabled

## Cloud API Responsibilities

The `citadel-cloud` ingestion endpoint must:

1. Authenticate requests (API key or project token)
2. Validate envelope schema and version
3. Reject unknown event types with a 400 response
4. Persist raw envelopes to the EventEnvelope table
5. Create normalized projections for dashboard, approvals, and policy views
6. Return 201 with the persisted envelope ID

## Versioning Rules

1. The `version` field is explicit and mandatory.
2. When the envelope schema changes, increment the version number.
3. The Cloud API must support all active versions simultaneously.
4. Deprecation: announce in the OSS changelog, support for 6 months, then drop.

## Non-Goals (for MVP)

- Shipping every local telemetry field on day one
- Streaming raw repo contents to Cloud
- Replacing local telemetry logs (Cloud supplements, not replaces)
- Real-time WebSocket event streaming (polling is sufficient for MVP)

## Implementation Notes

The canonical event contract lives in `packages/contracts` in the OSS repo. The
private repo's `packages/contracts` extends it with Cloud-specific types (e.g.,
persisted envelope with server-side timestamps, query projections).

The ingestion pipeline in the private repo should:

1. Validate the envelope using the contract schema
2. Persist the raw envelope (source of truth)
3. Fan out to projection workers (dashboard views, policy evaluation, approval checks)
4. Record ingestion latency for observability

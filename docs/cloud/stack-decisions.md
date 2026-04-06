# Citadel Cloud: Stack Decisions

> Date: 2026-04-06
> Source: .planning/architecture-citadel-cloud-stack.md

## Chosen Stack

| Layer | Choice | Rationale |
|---|---|---|
| Monorepo | pnpm workspace | Low activation energy for a tiny founding team |
| Web app | Next.js (App Router) | Dashboard-heavy product fits React/Next surface well |
| API | Next.js route handlers (MVP) | Co-located with web app for speed; explicit service modules for structure |
| Worker | Separate package in monorepo | Leaves room for managed execution without forcing it into the web app |
| Database | Postgres | Enough structure for policy and approvals without early schema chaos |
| ORM | Prisma | Strong TypeScript integration, migration management, query builder |
| Auth | Managed provider or NextAuth | Finalized during bootstrap; avoid custom auth implementation |
| Queue | Database-backed jobs (MVP) | Avoid premature distributed systems; upgrade to dedicated queue later |

## Rejected Alternatives

### Separate frontend SPA + Node API + separate worker service

- **Why rejected**: More setup and ops overhead immediately. Slower for MVP.
- **When to revisit**: If service boundaries need to scale independently after MVP.

### Supabase-first stack with thin custom backend

- **Why rejected**: Policy/worker/execution logic likely outgrows the abstraction quickly. Harder to keep the control plane architecture intentional.
- **When to revisit**: If the auth/db bootstrap speed becomes a critical bottleneck.

## Deferred Decisions

These are intentionally not chosen yet. Each should be decided after the private
repo exists and the ingestion/worker shape is clearer:

| Decision | Current State | Decide When |
|---|---|---|
| Auth provider | NextAuth or managed (Auth0, Clerk, etc.) | During bootstrap Phase 4 |
| Hosting vendor | Not chosen | After ingestion endpoint works locally |
| Queue vendor | Database-backed for MVP | When job volume exceeds simple polling |
| Observability vendor | Not chosen | After first design partner connects |

## Product Boundary

This is an **open-core** model:

- The OSS `Citadel` repo remains the local harness. It publishes stable contracts
  and client adapters via `packages/contracts`, `packages/client`, and runtime packages.
- The private `citadel-cloud` repo implements the hosted control plane. It consumes
  OSS packages as dependencies and never imports from `core/*` directly.

### What Lives Where

| Concern | OSS Repo | Private Repo |
|---|---|---|
| Event contracts and envelope schema | Yes (canonical) | Consumes via package |
| Runtime adapters (Claude Code, Codex, OpenAI) | Yes | No |
| Client emission layer | Yes | No |
| Dashboard UI | No | Yes |
| Approval queue and policy engine | No | Yes |
| Shared campaign history | No | Yes |
| Ingestion API and workers | No | Yes |
| Auth and org management | No | Yes |

## Why This Split

1. Preserves OSS trust: the local harness remains open and independent.
2. Monetizes multi-user infrastructure cleanly: team features live in the private repo.
3. Avoids boundary drift: the package layer enforces separation at the dependency level.
4. Reduces accidental disclosure risk: no premium code in the public repo.

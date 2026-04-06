# Citadel Cloud: Private Repo Manifest

> Date: 2026-04-06
> Source: .planning/architecture-citadel-cloud.md, .planning/architecture-citadel-cloud-stack.md

## Repo Identity

- Name: `citadel-cloud`
- Visibility: Private
- Relationship: Consumes `@citadel/contracts`, `@citadel/client` from the public OSS repo

## Stack

- Monorepo: pnpm workspace
- Web app: Next.js
- API: Next.js route handlers (MVP), explicit service modules
- Worker: Separate worker app/package in the same monorepo
- Database: Postgres
- ORM: Prisma
- Auth: Managed auth provider or NextAuth-compatible path (finalized during bootstrap)
- Queue: Database-backed jobs initially; light queue later

## File Tree

```text
citadel-cloud/
  apps/
    web/
      src/
        app/                        # Next.js app router
        features/
          dashboard/                # Campaign timeline, event feed, spend overview
          approvals/                # Approval queue UI
          policies/                 # Policy editor and enforcement views
          campaigns/                # Shared campaign history browser
          memory/                   # Team-visible decision and artifact history
      package.json
      next.config.js
      tsconfig.json

    worker/
      src/
        jobs/                       # Background job definitions
        ingestion/                  # Event ingestion pipeline workers
        notifications/              # Alert and notification delivery
      package.json
      tsconfig.json

  packages/
    db/
      prisma/
        schema.prisma               # Core data model
        migrations/                 # Prisma migration history
      src/
        index.ts                    # DB client singleton and query helpers
      package.json

    auth/
      src/
        index.ts                    # Auth provider adapter
        middleware.ts               # Request auth middleware
      package.json

    contracts/
      src/
        index.ts                    # Re-exports from @citadel/contracts + Cloud extensions
      package.json

    policy-engine/
      src/
        index.ts                    # Policy evaluation engine
        types.ts                    # Policy types and trigger definitions
      package.json

    ingestion/
      src/
        index.ts                    # Event envelope validation and normalization
        schema.ts                   # Envelope schema + version checks
      package.json

    ui/
      src/
        components/                 # Shared UI components
        index.ts
      package.json

  docs/
    architecture.md                 # Cloud-specific architecture decisions
    onboarding.md                   # Design partner onboarding guide
    runbook.md                      # Operational runbook

  infra/
    docker-compose.yml              # Local development stack
    .env.example                    # Required environment variables template

  pnpm-workspace.yaml
  package.json                      # Root workspace config
  tsconfig.base.json                # Shared TypeScript config
  .gitignore
  .env.example
```

## Package Responsibilities

| Package | Responsibility | Depends On |
|---|---|---|
| `apps/web` | Dashboard, approvals, policies, campaign history UI | `packages/db`, `packages/auth`, `packages/ui`, `packages/contracts` |
| `apps/worker` | Event ingestion, background jobs, notifications | `packages/db`, `packages/ingestion`, `packages/policy-engine` |
| `packages/db` | Prisma schema, DB client, query helpers | Postgres |
| `packages/auth` | Auth provider adapter, request middleware | Auth provider SDK |
| `packages/contracts` | Cloud extensions on top of `@citadel/contracts` | `@citadel/contracts` (OSS) |
| `packages/policy-engine` | Policy evaluation and enforcement logic | `packages/contracts` |
| `packages/ingestion` | Event envelope validation, normalization | `@citadel/contracts` (OSS) |
| `packages/ui` | Shared UI components across features | None |

## Data Model Summary

Defined in `packages/db/prisma/schema.prisma`:

| Entity | Key Fields | Purpose |
|---|---|---|
| Organization | id, name, createdAt | Multi-tenant org container |
| User | id, orgId, email, role | Team members with RBAC |
| Project | id, orgId, name, runtime, createdAt | Connected Citadel installations |
| EventEnvelope | id, orgId, projectId, source, eventType, occurredAt, payload | Raw ingested events |
| Policy | id, orgId, name, trigger, effect, config | Operational control rules |
| ApprovalRequest | id, orgId, projectId, eventId, status, requestedAt, resolvedAt | Human-in-the-loop decisions |
| CampaignRecord | id, orgId, projectId, externalCampaignId, status, title, summary | Shared campaign history |

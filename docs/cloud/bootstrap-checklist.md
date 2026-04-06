# Citadel Cloud: Bootstrap Checklist

> Date: 2026-04-06
> Source: .planning/architecture-citadel-cloud-stack.md

Follow this checklist to stand up the private `citadel-cloud` repo from scratch.

## Prerequisites

- [ ] GitHub org with private repo access
- [ ] Node.js 20+ and pnpm 9+ installed
- [ ] Postgres 16+ available (local or hosted)
- [ ] Access to `@citadel/contracts` and `@citadel/client` packages from the OSS repo

## Phase 1: Repo Scaffold

- [ ] Create private repo `citadel-cloud` on GitHub
- [ ] Initialize with `pnpm init` and create `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - 'apps/*'
    - 'packages/*'
  ```
- [ ] Create `tsconfig.base.json` with strict TypeScript config
- [ ] Create root `.gitignore` (node_modules, .env, .next, dist, prisma client)
- [ ] Create `.env.example` with placeholder variables

## Phase 2: Package Scaffolds

- [ ] `packages/db/` -- Initialize with Prisma:
  ```bash
  cd packages/db && pnpm init && pnpm add prisma @prisma/client
  npx prisma init
  ```
- [ ] Write initial `schema.prisma` with: Organization, User, Project, EventEnvelope, Policy, ApprovalRequest, CampaignRecord (see `docs/cloud/repo-manifest.md` for field details)
- [ ] `packages/auth/` -- Initialize, add auth provider SDK
- [ ] `packages/contracts/` -- Initialize, add `@citadel/contracts` as dependency
- [ ] `packages/policy-engine/` -- Initialize with types and evaluation stub
- [ ] `packages/ingestion/` -- Initialize with envelope schema validation
- [ ] `packages/ui/` -- Initialize with shared component exports

## Phase 3: App Scaffolds

- [ ] `apps/web/` -- Create Next.js app:
  ```bash
  cd apps/web && pnpm create next-app . --typescript --tailwind --app --src-dir
  ```
- [ ] Wire `apps/web` dependencies: `packages/db`, `packages/auth`, `packages/ui`, `packages/contracts`
- [ ] Create feature directory stubs: `src/features/dashboard/`, `src/features/approvals/`, `src/features/policies/`, `src/features/campaigns/`, `src/features/memory/`
- [ ] `apps/worker/` -- Create worker package with TypeScript config
- [ ] Wire `apps/worker` dependencies: `packages/db`, `packages/ingestion`, `packages/policy-engine`

## Phase 4: Database and Auth

- [ ] Run `npx prisma migrate dev --name init` to create initial migration
- [ ] Verify schema creates all tables
- [ ] Configure auth provider (NextAuth or managed provider)
- [ ] Add auth middleware to `apps/web`
- [ ] Create seed script for development data

## Phase 5: First Endpoint

- [ ] Create ingestion API route in `apps/web/src/app/api/ingest/route.ts`:
  - Accept POST with event envelope body
  - Validate envelope schema (version, required fields)
  - Authenticate request (API key or project token)
  - Persist to EventEnvelope table
  - Return 201 with envelope ID
- [ ] Create basic dashboard page at `apps/web/src/features/dashboard/page.tsx`:
  - Query recent EventEnvelopes for the authenticated org
  - Display event timeline
  - Show project connection status

## Phase 6: Local Development

- [ ] Create `infra/docker-compose.yml` with Postgres service:
  ```yaml
  services:
    postgres:
      image: postgres:16-alpine
      ports:
        - '5432:5432'
      environment:
        POSTGRES_USER: citadel
        POSTGRES_PASSWORD: citadel
        POSTGRES_DB: citadel_cloud
      volumes:
        - pgdata:/var/lib/postgresql/data
  volumes:
    pgdata:
  ```
- [ ] Add root scripts to `package.json`:
  - `dev`: starts web + worker + docker compose
  - `build`: builds all packages and apps
  - `db:migrate`: runs Prisma migrations
  - `db:seed`: seeds development data
  - `typecheck`: runs tsc across workspace
  - `test`: runs test suite
- [ ] Verify: `pnpm install && pnpm dev` starts clean

## Phase 7: Verification

- [ ] `pnpm typecheck` passes across all packages
- [ ] `pnpm build` succeeds
- [ ] Ingestion endpoint accepts a sample event envelope
- [ ] Dashboard displays the ingested event
- [ ] Auth flow works end-to-end (signup, login, project creation)

## Post-Bootstrap

After the checklist is complete:

1. Update `.planning/intake/citadel-cloud-private-repo-bootstrap.md` status to `completed`
2. Move to Phase 4 of the Cloud architecture: Hosted Ingestion and Dashboard MVP
3. Connect the OSS `@citadel/client` to emit events to the Cloud ingestion endpoint
4. Begin design partner onboarding preparation

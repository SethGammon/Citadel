# Architecture: Citadel App

> PRD: `.planning/prd-citadel-app.md`  |  Date: 2026-07-14
> Mode: feature across `Citadel` and `Citadel-Studio`

## File Tree

### Citadel engine repository

```text
~ packages/contracts/index.js
~ packages/contracts/package.json
+ packages/contracts/schemas/app-contracts-v1.json
+ packages/contracts/app/constants.js
+ packages/contracts/app/validation.js
+ packages/contracts/app/transitions.js
+ packages/contracts/app/index.js
+ core/app-contracts/index.js
+ scripts/generate-app-contract-schema.js
+ scripts/test-app-contracts.js
~ scripts/test-all.js
+ docs/APP_CONTRACTS.md
+ docs/CITADEL_APP_ARCHITECTURE.md
```

### Citadel-Studio application repository

```text
~ package.json
~ package-lock.json
~ vite.config.ts
~ src/App.tsx
~ src/components/StudioShell.tsx
~ src/components/FactoryLibrary.tsx
~ src/components/MissionControl.tsx
~ src/run/rosterStore.ts
~ src/run/factorySpec.ts
~ src/run/bridgeClient.ts
~ server/bridge.ts
+ electron-builder.yml
+ electron/main.ts
+ electron/preload.ts
+ electron/ipc/contracts.ts
+ electron/ipc/handlers.ts
+ electron/security/credentials.ts
+ electron/security/paths.ts
+ electron/supervisor/supervisor.ts
+ electron/supervisor/scheduler.ts
+ electron/supervisor/processTree.ts
+ electron/supervisor/recovery.ts
+ electron/supervisor/workspaces.ts
+ electron/supervisor/worktrees.ts
+ electron/supervisor/terminals.ts
+ electron/supervisor/events.ts
+ electron/persistence/database.ts
+ electron/persistence/migrations/001-initial.ts
+ electron/runtime/adapter.ts
+ electron/runtime/claudeCode.ts
+ electron/runtime/codex.ts
+ src/app/contracts.ts
+ src/app/client.ts
+ src/app/store.ts
+ src/app/migrations.ts
+ src/components/AppFrame.tsx
+ src/components/CommandCenter.tsx
+ src/components/AgentRoster.tsx
+ src/components/AgentInstancePanel.tsx
+ src/components/NeedsYou.tsx
+ src/components/ReviewWorkspace.tsx
+ src/components/TerminalDock.tsx
+ src/components/HandoffCard.tsx
+ src/components/RecoveryCenter.tsx
+ src/components/WorkspaceSwitcher.tsx
+ src/components/__tests__/AppFrame.test.tsx
+ src/components/__tests__/HandoffCard.test.tsx
+ src/app/__tests__/store.test.ts
+ electron/__tests__/ipc-security.test.ts
+ electron/__tests__/supervisor-lifecycle.test.ts
+ electron/__tests__/recovery.test.ts
+ electron/__tests__/runtime-adapters.test.ts
+ electron/__tests__/installer-smoke.test.ts
+ scripts/verify-desktop.mjs
+ scripts/verify-visual.mjs
+ scripts/verify-recovery.mjs
```

## Component Breakdown

### Feature: Versioned app contracts
- **Files:** dependency-free Citadel `packages/contracts/app/`, generated package schema, engine compatibility entrypoint, contract docs, and tests.
- **Dependencies:** Existing canonical JSON, operations validation, runtime IDs, evidence and receipt contracts.
- **Complexity:** high.

### Feature: Native shell and supervisor
- **Files:** Studio `electron/main.ts`, `preload.ts`, `ipc/`, `supervisor/`, `persistence/`.
- **Dependencies:** App contracts, Electron, PTY provider, SQLite provider, git and filesystem adapters.
- **Complexity:** high.

### Feature: Runtime adapters and isolated instances
- **Files:** Studio `electron/runtime/`, supervisor scheduler/worktree/terminal modules.
- **Dependencies:** Installed Claude Code and Codex CLIs, current CLI argument builder, Citadel executor profiles.
- **Complexity:** high.

### Feature: Unified application experience
- **Files:** Studio `src/app/`, `AppFrame`, Command Center, roster, run, review, terminal, handoff, recovery, and workspace surfaces.
- **Dependencies:** Existing canvas, `FactorySpec`, roster, timeline, operation reports, and design system.
- **Complexity:** high.

### Feature: Desktop distribution and trust
- **Files:** builder configuration, credentials, path security, updater/release scripts, installer/recovery/security tests.
- **Dependencies:** platform signing identities and release hosting.
- **Complexity:** high.

## Data Model

### AgentProfile
- **Fields:** `id`, `name`, `role`, `runtime`, `model`, `instructions`, `skillRefs`, `memoryPolicy`, `permissionPolicy`, `resourcePolicy`, `createdAt`, `updatedAt`.
- **Relationships:** belongs to zero or more Teams; creates AgentInstances; may be referenced by Factory crew slots.

### AgentInstance
- **Fields:** `id`, `profileId`, `operationId`, `workspaceId`, `runtime`, `pid`, `status`, `branch`, `worktree`, `terminalId`, `budget`, `startedAt`, `endedAt`, `exit`.
- **Relationships:** owned by one supervisor; emits Events and Artifacts; sends and receives Handoffs.

### Team
- **Fields:** `id`, `name`, `memberProfileIds`, `coordinationPolicy`, `handoffPolicy`, `resourcePolicy`.
- **Relationships:** used by Factories and Operations.

### Operation
- **Fields:** `id`, `factoryId`, `workspaceId`, `objective`, `revision`, `status`, `policy`, `budget`, `createdAt`, `updatedAt`.
- **Relationships:** owns AgentInstances, Handoffs, Gates, Approvals, Events, Artifacts, and a final Receipt.

### Handoff
- **Fields:** `id`, `operationId`, `fromInstanceId`, `toProfileId`, `toInstanceId`, `outcome`, `decisions`, `blockers`, `artifactRefs`, `verificationRefs`, `nextAction`, `status`, `createdAt`, `acceptedAt`.
- **Relationships:** immutable once accepted; may require an Approval; advances an operation edge.

### Workspace
- **Fields:** `id`, `root`, `name`, `vcs`, `instructionFiles`, `runtimeAvailability`, `resourcePolicy`, `lastOpenedAt`.
- **Relationships:** owns worktrees, operations, factories, and workspace-scoped memory.

### Event and Artifact
- **Fields:** versioned Citadel lineage fields plus operation, instance, sequence, kind, timestamp, payload digest, source and privacy class.
- **Relationships:** append-only operation journal; artifacts are content-addressed and referenced by handoffs, gates, and receipts.

## Key Decisions

### Product topology: separate engine and app repositories
- **Chosen:** Keep Citadel as the open-core protocol/orchestration engine and make Citadel-Studio the canonical desktop app consuming a versioned package contract, because their release cadence and commercial boundaries differ.
- **Rejected:** Move the complete Studio source into the Citadel repository, because it would collapse open-core and product concerns and overwrite a substantial independent worktree.
- **Rejected:** Maintain the ignored `apps/desktop` prototype as a second app, because two shells duplicate information architecture and runtime ownership.

### Desktop technology: Electron
- **Chosen:** Electron with a hardened renderer/main boundary, because existing code and local agent execution are Node-native.
- **Rejected:** Tauri for v1, because it adds a Rust/Node sidecar and packaging boundary before supervisor contracts stabilize.
- **Rejected:** Browser/PWA as the execution owner, because it cannot safely own local processes, terminals, worktrees, and credentials.

### Execution ownership: one local supervisor
- **Chosen:** One durable supervisor per installation with multiple client windows, because process, worktree, budget, and recovery ownership must be singular.
- **Rejected:** One supervisor per window, because duplicate locks and orphaned agents become unavoidable.
- **Rejected:** Renderer-owned execution, because renderer reloads and compromised web content would control child processes.

### Persistence: supervisor SQLite, append-only journals, and renderer cache
- **Chosen:** SQLite for authoritative indexed entity state, existing Citadel append-only journals for effect/recovery truth, and IndexedDB only for renderer caches/preferences, because recovery and multi-window projections need transactions while execution effects need inspectable hash-linked evidence.
- **Rejected:** IndexedDB-only persistence, because the execution owner cannot depend on a renderer lifecycle.
- **Rejected:** Markdown/JSON alone for high-volume events, because process recovery and event queries require atomic indexed state; human-readable reports remain exported artifacts.

### Runtime extensibility: adapter manifest
- **Chosen:** A strict runtime adapter interface covering discovery, launch, attach, normalize, interrupt, terminate, recover, capabilities, and evidence, with Claude Code and Codex first.
- **Rejected:** Runtime-specific branches across UI and supervisor code, because every new agent would become a cross-product rewrite.

## Build Phases

### Phase 0: Preserve and baseline
- **Goal:** Freeze current truth without stashing, resetting, or overwriting either dirty worktree.
- **Files:** planning documents and baseline evidence only.
- **Dependencies:** none.
- **End Conditions:** Citadel current checks have no observed failure; Studio typecheck, 182-test suite, and production build pass; both dirty states are recorded.

### Phase 1: App contract foundation
- **Goal:** Publish the versioned cross-repo contract for agents, operations, handoffs, events, policies, and supervisor messages.
- **Files:** Citadel `packages/contracts/app/`, generated schema, `core/app-contracts/` compatibility entrypoint, package exports, docs, and tests.
- **Dependencies:** Phase 0.
- **End Conditions:** schema fixtures validate; unknown fields fail closed; migrations are explicit and non-mutating; Citadel strict tests pass with no new failures.

### Phase 2: Canonical Studio baseline
- **Goal:** Commit a reviewable Studio baseline and replace the local file dependency with the versioned app contract.
- **Files:** Studio current worktree, package configuration, contract adapter, baseline documentation.
- **Dependencies:** Phase 1.
- **End Conditions:** clean or intentionally bounded Studio status; typecheck, tests, and build pass from a fresh install; current saved factories and rosters migrate without loss.

### Phase 3: Desktop shell and supervisor
- **Goal:** Launch Studio as Citadel App with singular process ownership, IPC, persistence, terminals, worktrees, and recovery.
- **Files:** Studio `electron/`, desktop config, app client/store, supervisor tests.
- **Dependencies:** Phase 2.
- **End Conditions:** Windows development build launches; two windows observe one supervisor; four fixture agents run concurrently; close/reopen recovery test has no orphaned ownership.

### Phase 4: Agent collaboration and review
- **Goal:** Make profiles, instances, teams, typed handoffs, approvals, gates, diffs, terminals, and reports first-class end-to-end workflows.
- **Files:** Studio application surfaces, app state, handoff/review components and tests.
- **Dependencies:** Phase 3.
- **End Conditions:** Scout to Mason to Sentinel to Verity fixture completes through typed handoffs; every state links to evidence; pause/retry/cancel/kill and revision conflicts pass tests.

### Phase 5: Experience and visual quality
- **Goal:** Deliver the coherent Command Center, Factories, Agents, Runs, Review, Library, Memory, and Settings experience at the declared quality bar.
- **Files:** Studio app frame, navigation, surfaces, design tokens, performance and visual scripts.
- **Dependencies:** Phase 3; may proceed in parallel with Phase 4 after shared contracts freeze.
- **End Conditions:** real screenshot matrix passes; keyboard and reduced motion pass; 100-agent fixture meets interaction and event budgets; accessibility audit has no critical issue.

### Phase 6: Security, packaging, and private alpha
- **Goal:** Produce a signed Windows-first installer with secure credentials, migrations, update/rollback, diagnostics, and threat-model verification.
- **Files:** security, builder, updater, installer and release verification surfaces.
- **Dependencies:** Phases 4 and 5.
- **End Conditions:** clean-machine install, update, rollback, migration, recovery, and uninstall tests pass; security suite passes; private-alpha artifact and checksums are reproducible.

### Phase 7: Adapter and factory ecosystem
- **Goal:** Prove extensibility with a third runtime adapter and signed factory import/export while preserving local trust boundaries.
- **Files:** adapter SDK docs/fixtures, template signing/validation, library surfaces.
- **Dependencies:** Phase 6.
- **End Conditions:** an out-of-tree adapter passes conformance; signed factory import rejects tampering; no provider-specific UI branch is required.

## Phase Dependency Graph

`Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> (Phase 4 + Phase 5) -> Phase 6 -> Phase 7`

## Risk Register

1. **Uncommitted Studio foundation:** preserve the current index and working tree, record baseline evidence, and do not restructure until a reviewable baseline commit is explicitly approved.
2. **Active Citadel campaign overlap:** keep Phase 1 additive under `core/app-contracts/`; coordinate any `packages/contracts` or `scripts/test-all.js` edit with existing executor/product-proof work.
3. **Electron attack surface:** sandbox the renderer, disable Node integration, validate every IPC message, isolate credentials, and prohibit arbitrary command IPC.
4. **Unsafe development bridge:** the current Vite bridge uses a broad host, unauthenticated mutation routes, raw caller paths, `shell:true`, direct-child cancellation, and `git add -N`; bind development to loopback immediately and replace the bridge rather than packaging it.
5. **PTY and process-tree portability:** define adapter/process contracts first and test Windows kill/recovery semantics before macOS expansion.
6. **Native SQLite/PTY packaging:** lock Electron ABI-compatible versions, keep normal agent execution pipe-based, isolate PTY as an optional terminal service, and verify clean-machine packaging in CI.
7. **Visual scope expansion:** freeze the experience decision model and first-release state matrix before adding marketplace, IDE, or remote collaboration surfaces.
8. **Regression in existing functionality:** run Citadel strict and Studio type/test/build gates after every build phase; five or more new errors park the campaign.

## Deployment Strategy

- **Platform:** Windows 11 private alpha, then macOS and Linux public beta.
- **Method:** Electron Builder NSIS/DMG/AppImage with signed release manifest and staged update channels.
- **Environment variables:** signing credentials and release tokens only in protected CI; provider credentials remain in operating-system storage or existing CLI stores.
- **Pre-deploy checks:** contracts, typecheck, tests, production build, visual matrix, recovery, IPC security, clean-machine installer, update, rollback, SBOM, and checksum reproducibility.

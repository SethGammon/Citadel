# PRD: Citadel App

> Description: A local-first desktop software factory for designing, running, supervising, and improving teams of coding agents across real repositories.
> Author: Seth Gammon
> Date: 2026-07-14
> Status: approved
> Mode: feature

## Problem

Citadel has a mature orchestration engine and Citadel-Studio has a substantial visual factory, but neither is currently a launchable desktop product. Operators must move between terminal sessions, repository state, an experimental dashboard, and an uncommitted browser prototype. They cannot reliably create persistent named agents, launch many supervised instances, inspect handoffs, review diffs, recover processes, and control multiple workspaces from one coherent application.

## Users

1. A solo software builder who runs several local coding agents and needs durable orchestration, review, and recovery.
2. A technical lead who designs reusable agent teams and factories with explicit policies, gates, budgets, evidence, and handoffs.

## Core Features

1. **Workspace and roster control:** Open multiple repositories and manage persistent named agent profiles with runtime, model, role, instructions, skills, memory, permissions, and resource policy.
2. **Visual software factories:** Author reusable graphs that bind an objective, workspace, crew, protocol, gates, memory, live view, and report into one executable factory.
3. **Supervised multi-agent execution:** Launch resource-governed Claude Code and Codex instances in isolated worktrees, observe live events and terminals, and pause, resume, retry, cancel, or recover them.
4. **Typed collaboration and review:** Move work through durable handoffs carrying outcomes, decisions, blockers, artifacts, diffs, verification, and an explicit target agent or operator approval.
5. **Desktop trust and extensibility:** Ship a signed Windows-first desktop app with secure credentials, tamper-evident journals, upgrade-safe local persistence, and a versioned adapter contract for additional agents and sandbox providers.

## Out of Scope (v1)

- Hosted remote execution or a mandatory Citadel cloud account.
- Multi-user real-time collaboration, organization billing, or a public marketplace.
- A full source-code editor intended to replace VS Code, Codex, or Claude Code.
- Automatic merge, push, PR creation, or deployment without explicit capability and approval contracts.
- Unlimited physical concurrency; the interface may represent any number of agents, while the supervisor enforces local resource and provider limits.

## Technical Decisions

- **Frontend:** Existing React 19, Vite, Zustand, and Citadel-Studio design system, because the visual factory, named roster, adaptive operation, and proof surfaces already exist there.
- **Desktop:** Electron, because Citadel needs Node child processes, filesystem watching, git, PTYs, local CLI discovery, and cross-platform packaging without a new Rust sidecar boundary.
- **Backend:** A local Node supervisor owned by the Electron main process and exposed only through typed IPC, because running agents must survive renderer reloads and remain inaccessible to arbitrary web content.
- **Persistence:** Supervisor-owned SQLite for indexed entity state plus append-only Citadel journals for effects, events, handoffs, and recovery checkpoints; IndexedDB remains renderer-only cache and canvas preference storage, because process recovery cannot depend on one renderer profile or silently dropped browser writes.
- **Auth:** No product account for v1; local CLI authentication remains provider-owned and optional API keys use operating-system-protected storage.
- **Deployment:** Signed Windows NSIS installer first, followed by notarized macOS DMG and Linux AppImage after the Windows recovery and update path is proven.

## Architecture

Citadel remains the open-core orchestration and protocol engine. Citadel-Studio becomes the Citadel App renderer and desktop repository. A versioned `@citadel/app-contracts` package defines agent, team, operation, handoff, event, permission, and supervisor messages; a local client package consumes those contracts over Electron IPC. One supervisor process owns runtime adapters, worktrees, terminals, budgets, journals, and recovery while any number of app windows project the same truthful state.

## Integration Points

- **Existing files modified:** `packages/contracts/index.js`, `packages/contracts/package.json`, `packages/client/index.js`, Citadel-Studio `package.json`, `vite.config.ts`, `src/App.tsx`, `src/run/rosterStore.ts`, `src/run/factorySpec.ts`, `server/bridge.ts`.
- **New files created:** dependency-free `packages/contracts/app` implementation, schema, generator, conformance tests, and engine compatibility entrypoint in Citadel; Electron main/preload, supervisor, persistence, runtime adapters, IPC client, desktop tests, and release configuration in Citadel-Studio.
- **Dependencies added:** Electron toolchain, PTY integration, SQLite persistence, schema validation, and packaging/update dependencies selected during implementation.
- **Patterns followed:** Operations Protocol immutable records, explicit unknown state, revision-bound intents, local-first evidence, `FactorySpec`, adapter-based runtimes, worktree isolation, and trigger/action/proof/memory/stop loop contracts.

## End Conditions (Definition of Done)

- [ ] A clean Windows machine installs Citadel, launches it from Start, opens two repositories, and restores them after restart.
- [ ] An operator creates named Claude Code and Codex agent profiles, launches at least four concurrent isolated instances, and sees truthful live state, transcripts, branches, budgets, and terminal status.
- [ ] A factory executes Scout to Mason to Sentinel to Verity with durable typed handoffs, artifacts, diffs, gate results, and an operator-visible final report.
- [ ] Closing and reopening Citadel during an active run restores or honestly terminates every instance with no orphaned worktree ownership.
- [ ] Pause, resume, retry, cancel, kill, approval, and credential boundaries pass IPC, containment, race, tamper, and recovery tests.
- [ ] Dark/light, keyboard, reduced-motion, 100/150/200 percent scaling, empty/error/unknown states, and a 100-agent fixture pass visual and interaction verification.
- [ ] Existing Citadel strict tests and Citadel-Studio typecheck, tests, and production build pass with zero new failures.
- [ ] Signed installer, update, rollback, migration, and uninstall tests pass on the supported Windows release.

## Open Questions

- Final commercial boundary between the open-core engine and the desktop app after the private alpha.
- Whether macOS joins the first public beta or follows the proven Windows release.
- Which third runtime adapter follows Claude Code and Codex; the adapter SDK must make this a product choice rather than an architecture change.

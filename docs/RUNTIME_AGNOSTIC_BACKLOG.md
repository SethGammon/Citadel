# Runtime-Agnostic Migration Backlog

> last-updated: 2026-03-30
> status: proposed

This document breaks the runtime-agnostic Citadel migration into PR-sized,
compatibility-first chunks. The goal is to make Citadel the primary system and
Claude Code / Codex supported runtimes, without breaking current users.

## Non-Negotiables

Every PR in this program must satisfy all of the following:

- Preserve current Claude Code behavior unless the change is explicitly additive.
- Preserve current Codex support unless the change is explicitly additive.
- Keep generated artifacts compatible until a documented migration step exists.
- Avoid changing campaign or telemetry file formats unless versioning and readers
  are updated in the same PR.
- Add tests or snapshots before refactoring generator or parser behavior.
- Keep each PR reviewable and reversible.

## Migration Principle

Citadel should be organized into three layers:

1. `core/` — runtime-agnostic orchestration logic
2. `runtimes/` — Claude Code and Codex adapters
3. `surfaces/` — plugin, CLI, slash-command, and future MCP/desktop entrypoints

Canonical sources of truth:

- `skills/` — canonical skill definitions
- `agents/` — canonical agent role definitions
- `.citadel/project.*` — canonical project guidance spec
- `core/` — canonical runtime-independent orchestration logic

Generated projections:

- `CLAUDE.md`
- `AGENTS.md`
- `.claude/settings.json`
- `.codex/hooks.json`
- `.codex/config.toml`
- `.codex/agents/*.toml`
- `.agents/skills/*/agents/openai.yaml`

## Recommended End-State Structure

```text
core/
  contracts/
  runtime/
  project/
  hooks/
  skills/
  agents/
  campaigns/
  fleet/
  coordination/
  telemetry/
  policy/
runtimes/
  claude-code/
    adapters/
    generators/
    guidance/
    hooks/
  codex/
    adapters/
    generators/
    guidance/
    hooks/
surfaces/
  cli/
  plugin/
  mcp/
skills/
agents/
scripts/
docs/
```

## PR Backlog

### PR 1: Add Core Runtime Contract Skeleton

Purpose:
- Introduce a formal architecture spine without changing behavior.

Changes:
- Add `core/contracts/runtime.ts` or `core/contracts/runtime.js`
- Add `core/contracts/events.ts`
- Add `core/contracts/capabilities.ts`
- Add `core/contracts/project-spec.ts`
- Add `core/contracts/skill-manifest.ts`
- Add `core/contracts/agent-role.ts`
- Add `docs/architecture/runtime-contract.md` or equivalent

Acceptance criteria:
- Zero behavior change.
- Existing install flows still work unchanged.
- Contract clearly distinguishes canonical Citadel concepts from runtime projections.

Depends on:
- None

Risk level:
- Low

### PR 2: Add Canonical Project Guidance Spec

Purpose:
- Introduce one canonical source of truth for project guidance while preserving
  existing `CLAUDE.md` and `AGENTS.md`.

Changes:
- Add `.citadel/project.template.md` or `.citadel/project.template.json`
- Add `core/project/load-project-spec.js`
- Add `core/project/render-claude-guidance.js`
- Add `core/project/render-codex-guidance.js`
- Add `scripts/generate-project-guidance.js`

Acceptance criteria:
- Generator can produce `CLAUDE.md` and `AGENTS.md` from canonical spec.
- Existing hand-authored guidance files are not overwritten by default.
- Dry-run mode shows proposed diffs for maintainers.

Depends on:
- PR 1

Risk level:
- Low

### PR 3: Extract Skill Projection Pipeline

Purpose:
- Make `skills/*/SKILL.md` formally canonical and runtime wrappers generated.

Changes:
- Add `core/skills/parse-skill.js`
- Add `core/skills/project-skill.js`
- Refactor `scripts/codex-compat.js` to use core skill projection modules
- Add `scripts/generate-skill-projections.js`
- Add snapshot fixtures for representative skills

Acceptance criteria:
- All current skills continue to lint successfully.
- Generated Codex skill artifacts remain compatible.
- No semantic change to skill instructions.

Depends on:
- PR 1

Risk level:
- Medium

### PR 4: Extract Agent Projection Pipeline

Purpose:
- Make `agents/*.md` canonical and runtime agent manifests generated.

Changes:
- Add `core/agents/parse-agent.js`
- Add `core/agents/project-agent.js`
- Refactor `scripts/codex-compat.js` agent generation to use core modules
- Add `scripts/generate-agent-projections.js`

Acceptance criteria:
- Generated `.codex/agents/*.toml` files remain valid.
- Canonical agent role definitions no longer need to embed runtime-specific manifest logic.
- Existing agent semantics remain unchanged.

Depends on:
- PR 1

Risk level:
- Medium

### PR 5: Add Normalized Hook Event Envelope

Purpose:
- Ensure hook implementations consume one Citadel-native event shape instead of
  Claude/Codex payloads directly.

Changes:
- Add `core/hooks/normalize-event.js`
- Add `core/hooks/hook-context.js`
- Add `runtimes/claude-code/adapters/hook-input.js`
- Add `runtimes/codex/adapters/hook-input.js`
- Refactor `hooks_src/codex-adapter.js`
- Add synthetic payload tests for Claude and Codex event normalization

Acceptance criteria:
- Hook implementations can consume one normalized event envelope.
- `protect-files`, `post-edit`, `quality-gate`, `governance`,
  `external-action-gate`, and `session-end` pass fixture-based tests.
- Claude install path remains functional.

Depends on:
- PR 1

Risk level:
- Medium

### PR 6: Refactor Hook Installers into Runtime Generators

Purpose:
- Separate runtime-specific hook installation from runtime-independent hook logic.

Changes:
- Add `runtimes/claude-code/generators/install-hooks.js`
- Add `runtimes/codex/generators/install-hooks.js`
- Move shared hook mapping code into `core/hooks/`
- Turn `scripts/install-hooks.js` into a thin Claude entrypoint
- Turn `scripts/install-hooks-codex.js` into a thin Codex entrypoint

Acceptance criteria:
- Generated `.claude/settings.json` remains compatible.
- Generated `.codex/hooks.json` remains compatible.
- Unsupported lifecycle events are reported from one central capability mapping.

Depends on:
- PR 5

Risk level:
- Medium

### PR 7: Add Runtime Capability Registry

Purpose:
- Make runtime support explicit and centrally consumable.

Changes:
- Add `core/runtime/registry.js`
- Add `core/runtime/detect-runtime.js`
- Add `runtimes/claude-code/runtime.js`
- Add `runtimes/codex/runtime.js`
- Refactor `scripts/detect-runtime.js`

Acceptance criteria:
- Runtime detection remains correct.
- Capability and degradation warnings come from the registry, not ad hoc conditionals.
- Installers and generators use the same runtime metadata.

Depends on:
- PR 1
- PR 6

Risk level:
- Low

### PR 8: Extract Telemetry Core

Purpose:
- Move telemetry logic out of script entrypoints while preserving data formats.

Changes:
- Add `core/telemetry/log.js`
- Add `core/telemetry/report.js`
- Add `core/telemetry/schema.js`
- Refactor `scripts/telemetry-log.cjs`
- Refactor `scripts/telemetry-report.cjs`
- Refactor `scripts/telemetry-schema.js`

Acceptance criteria:
- Existing telemetry readers keep working.
- `.planning/telemetry/*.jsonl` remains backward compatible.
- No dashboard or reporting regression.

Depends on:
- PR 1

Risk level:
- Medium

### PR 9: Extract Coordination Core

Purpose:
- Stabilize file-claim and multi-instance logic behind reusable modules.

Changes:
- Add `core/coordination/claims.js`
- Add `core/coordination/instances.js`
- Add `core/coordination/sweep.js`
- Refactor `scripts/coordination.js`

Acceptance criteria:
- Existing coordination files remain compatible.
- Sweep and claim behavior remain unchanged.
- Fleet orchestration can consume coordination logic without script coupling.

Depends on:
- PR 1

Risk level:
- Medium

### PR 10: Extract Discovery Relay Core

Purpose:
- Make fleet handoff parsing and compression runtime-agnostic.

Changes:
- Add `core/fleet/parse-handoff.js`
- Add `core/fleet/compress-discovery.js`
- Refactor `scripts/parse-handoff.cjs`
- Refactor `scripts/compress-discovery.cjs`

Acceptance criteria:
- Existing HANDOFF parsing still works.
- Discovery briefs remain semantically equivalent.
- Fleet can use shared discovery modules independent of runtime.

Depends on:
- PR 1

Risk level:
- Low

### PR 11: Extract Campaign State Core

Purpose:
- Centralize campaign and fleet session file operations without changing formats.

Changes:
- Add `core/campaigns/load-campaign.js`
- Add `core/campaigns/update-campaign.js`
- Add `core/campaigns/load-fleet-session.js`
- Add `core/campaigns/update-fleet-session.js`
- Refactor scripts/hooks that mutate campaign files directly

Acceptance criteria:
- Existing campaign markdown files remain readable and writable.
- Active/parked/completed transitions remain stable.
- No migration is required for existing user projects.

Depends on:
- PR 1

Risk level:
- Medium

### PR 12: Extract Core Policy Layer

Purpose:
- Isolate approvals, protected paths, and consent policy logic from hook entrypoints.

Changes:
- Add `core/policy/protected-files.js`
- Add `core/policy/external-actions.js`
- Add `core/policy/consent.js`
- Refactor `hooks_src/protect-files.js`
- Refactor `hooks_src/external-action-gate.js`

Acceptance criteria:
- Policy decisions are computed in core modules.
- Hook files become thin runtime-facing wrappers.
- Existing consent state files and protected-file behavior remain compatible.

Depends on:
- PR 5

Risk level:
- Medium

### PR 13: Consolidate Claude Code Runtime Adapter

Purpose:
- Treat Claude Code as a runtime adapter rather than the identity of the system.

Changes:
- Add `runtimes/claude-code/adapters/`
- Add `runtimes/claude-code/generators/`
- Add `runtimes/claude-code/guidance/`
- Add `runtimes/claude-code/hooks/`
- Repoint current Claude-specific scripts to these modules

Acceptance criteria:
- Current Claude install and usage remain unchanged for users.
- No public command regressions.
- Claude-specific assumptions are isolated under one runtime tree.

Depends on:
- PR 2
- PR 6
- PR 7
- PR 12

Risk level:
- High

### PR 14: Consolidate Codex Runtime Adapter

Purpose:
- Make Codex a first-class runtime peer rather than a sidecar compatibility path.

Changes:
- Add `runtimes/codex/adapters/`
- Add `runtimes/codex/generators/`
- Add `runtimes/codex/guidance/`
- Add `runtimes/codex/hooks/`
- Move Codex compatibility generation and install logic into this tree

Acceptance criteria:
- Codex generation and hook installation still work.
- Degraded-mode warnings are produced from the runtime registry.
- Codex support is described as a normal runtime path, not a patchwork adapter.

Depends on:
- PR 2
- PR 6
- PR 7
- PR 12

Risk level:
- High

### PR 15: Add Compatibility and Snapshot Test Matrix

Purpose:
- Lock down behavior before any public architecture reframe.

Changes:
- Expand `scripts/compat-tests/`
- Add generator snapshots for:
  - `.claude/settings.json`
  - `.codex/hooks.json`
  - `.codex/config.toml`
  - `.codex/agents/*.toml`
  - `.agents/skills/*/agents/openai.yaml`
- Add backward-compat fixtures for campaign and telemetry files
- Add hook normalization fixture tests
- Add CI coverage for compatibility tests

Acceptance criteria:
- CI proves generator outputs remain stable.
- Backward-compat fixture tests pass.
- Breaking output changes are visible in snapshots before release.

Depends on:
- PR 3
- PR 4
- PR 5
- PR 6
- PR 8
- PR 11

Risk level:
- Medium

### PR 16: Make Canonical Project Spec Available as Opt-In

Purpose:
- Allow new and migrating projects to adopt canonical project specs without
  breaking legacy installs.

Changes:
- Update setup flow to optionally create `.citadel/project.*`
- Integrate `scripts/generate-project-guidance.js` into setup/update flow
- Add migration command or documented migration script

Acceptance criteria:
- Fresh installs can be canonical-first.
- Legacy projects continue working without migration.
- Migration path is documented and reversible.

Depends on:
- PR 2
- PR 13
- PR 14
- PR 15

Risk level:
- Medium

### PR 17: Separate Core Logic from Surfaces

Purpose:
- Ensure slash commands, plugin packaging, CLI entrypoints, and future MCP
  surfaces are adapters over core behavior, not mixed into it.

Changes:
- Add `surfaces/cli/`
- Add `surfaces/plugin/`
- Add `surfaces/mcp/` if needed
- Move surface-specific wiring and packaging logic out of core/runtime modules

Acceptance criteria:
- `/do` remains available as a surface.
- Core router can be invoked from non-slash surfaces.
- Packaging concerns no longer leak into orchestration logic.

Depends on:
- PR 7
- PR 13
- PR 14

Risk level:
- Medium

### PR 18: Rewrite Public Docs Around Citadel-as-System

Purpose:
- Update public positioning only after compatibility work is proven.

Changes:
- Rewrite `README.md`
- Rewrite `QUICKSTART.md`
- Rewrite `docs/HOOKS.md`
- Add `docs/RUNTIMES.md`
- Add `docs/MIGRATION.md`

Acceptance criteria:
- Docs describe Citadel as the system and Claude/Codex as runtimes.
- Capability and degraded-mode behavior are documented precisely.
- No unsupported claims remain in public docs.

Depends on:
- PR 15

Risk level:
- High

### PR 19: Default New Installs to Canonical-First

Purpose:
- Make runtime-agnostic architecture the default for new adopters.

Changes:
- Update setup to generate `.citadel/project.*` by default
- Generate `CLAUDE.md` and `AGENTS.md` from canonical spec by default
- Preserve local override escape hatches

Acceptance criteria:
- New projects bootstrap into canonical-first architecture.
- Existing projects continue functioning as-is.
- Generated guidance files are idempotent and safe to refresh.

Depends on:
- PR 16
- PR 18

Risk level:
- High

### PR 20: Remove Transitional Duplication

Purpose:
- Clean up compatibility scaffolding after the new architecture is proven.

Changes:
- Remove deprecated duplicate code paths
- Remove outdated direct generators that bypass core/runtime modules
- Update contribution guidance to reflect final architecture

Acceptance criteria:
- No active public workflow depends on removed paths.
- Changelog clearly documents the cleanup.
- Remaining architecture is coherent and singular.

Depends on:
- PR 19

Risk level:
- Medium

## Suggested Milestones

### Milestone A: Architecture Spine

Includes:
- PR 1
- PR 2
- PR 3
- PR 4

Outcome:
- Canonical contracts and projections exist, but public behavior is unchanged.

### Milestone B: Runtime Normalization

Includes:
- PR 5
- PR 6
- PR 7

Outcome:
- Claude Code and Codex are formally modeled as runtimes.

### Milestone C: Core Extraction

Includes:
- PR 8
- PR 9
- PR 10
- PR 11
- PR 12

Outcome:
- Core systems are isolated from scripts and hook entrypoints.

### Milestone D: Runtime Consolidation and Test Lock

Includes:
- PR 13
- PR 14
- PR 15

Outcome:
- Runtime adapters are real, and compatibility is test-enforced.

### Milestone E: Public Reframe

Includes:
- PR 16
- PR 17
- PR 18
- PR 19
- PR 20

Outcome:
- Citadel is publicly and structurally runtime-agnostic.

## What Not to Mix Into This Migration

Do not bundle these into the architecture migration:

- New fleet behaviors
- New daemon semantics
- Learning/postmortem redesign
- Desktop app architecture work
- Additional runtimes beyond Claude Code and Codex
- Pricing or trust-model redesign

Those are separate initiatives. Mixing them into this program will make regressions
harder to isolate and make PR review substantially riskier.

## Triage Guidance

If only a few PRs can be staffed immediately, start with:

1. PR 1 — runtime contracts
2. PR 2 — canonical project spec
3. PR 5 — normalized hook events
4. PR 15 — compatibility test matrix

That sequence establishes the architectural contract, creates a stable source of
truth for guidance, normalizes one of the highest-risk seams, and locks in
backward compatibility before deeper refactors.

# Citadel

Citadel is an agent orchestration system that coordinates skills, hooks, campaigns, telemetry, and parallel work across coding runtimes.

## Citadel Project Guidance

This file is the Codex-facing projection of the canonical Citadel project spec.

## Conventions

- Skills are canonical in `skills/{name}/SKILL.md` and should remain runtime-agnostic.
- Agents are canonical in `agents/*.md` and should describe roles, not runtime-specific manifests.
- Hook implementations live in `hooks_src/` and should prefer shared utilities over ad hoc logic.
- Runtime-specific generated artifacts should be treated as projections, not hand-authored sources of truth.

## Workflows

- Run `node scripts/test-all.js` after modifying hooks, skills, or shared architecture code.
- Prefer compatibility-first changes that preserve existing Claude Code behavior while improving runtime separation.
- Keep new architecture work reviewable, reversible, and staged through PR-sized increments.
- When changing generated outputs, add or update explicit tests and fixtures in the same PR.

## Constraints

- Do not break current public install paths or documented commands without an explicit migration plan.
- Keep hook and generator behavior backward compatible until replacement paths are proven.
- Avoid runtime-specific assumptions in new core modules.
- Treat campaign and telemetry file formats as stability-sensitive interfaces.

## Handoff Summary

When a task completes, prefer a concise handoff that states:

- What changed
- Key decisions
- Remaining risks or next steps

# Citadel

Citadel is an agent orchestration system that coordinates skills, hooks, campaigns, telemetry, and parallel work across coding runtimes.

## Citadel Project Guidance

This file is the Codex-facing projection of the canonical Citadel project spec. Codex reads AGENTS.md files from the repository root down to the current working directory, so nested AGENTS.override.md files can add narrower rules when a package needs them.

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

## Verification

- Use the narrowest command that proves the changed behavior.
- Run `node scripts/test-all.js` after modifying hooks, skills, runtime adapters, or shared architecture code.
- Run targeted tests first when the change is scoped to one script, hook, or generator.

## Review Guidelines

- Lead with correctness, security, regression risk, and missing verification.
- Treat stale generated Codex artifacts as actionable when they would mislead future agents.
- Keep findings concrete with file and line references when reviewing code.

## Codex Notes

- Use `$skill-name` when an installed Citadel skill matches the task.
- Use native Codex subagents, worktrees, MCP servers, and automations when they reduce coordination overhead without bypassing Citadel state.
- Keep durable campaign, fleet, research, and verification state under `.planning/` when a workflow spans sessions.

## Handoff Summary

When a task completes, prefer a concise handoff that states:

- What changed
- Key decisions
- Remaining risks or next steps

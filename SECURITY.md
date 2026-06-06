# Security

Citadel is a local agent orchestration harness. Installing it gives Claude Code
or OpenAI Codex project-specific instructions, hooks, scripts, skills, and
state files that help an agent operate on a repository.

That is useful, but it is also privileged local automation. Treat an installed
Citadel project like any other developer tool that can read project files, run
commands, create branches, and write local state.

For the detailed trust-boundary map, see [THREAT_MODEL.md](THREAT_MODEL.md).

## Supported Security Model

Citadel is designed for local developer machines and trusted repositories.

Supported:

- local use inside a repository you control
- Claude Code and OpenAI Codex sessions with normal tool approval boundaries
- project-local state under `.planning/`, `.citadel/`, `.codex/`, `.claude/`,
  and generated runtime configuration files
- reviewable pull-request workflows for publishing harness changes

Not supported:

- exposing Citadel-generated local dashboards, MCP servers, or helper services
  to the public internet without additional authentication and review
- installing Citadel in an untrusted repository without inspecting its existing
  scripts, hooks, package tasks, and agent instructions
- treating `.planning/` state as public by default
- bypassing runtime approval prompts for destructive, networked, credential, or
  publish actions

## Main Risks

| Risk | Why it matters | Primary defenses |
|---|---|---|
| File overreach | Agents can request reads and edits across the project | protected path checks, project-root validation, reviewable diffs |
| Secret leakage | Project files may contain tokens, `.env` values, or private planning notes | protected file rules, do-not-publish guidance, local-first state |
| Shell command abuse | Hooks and scripts can run local commands | command validation, approval gates, non-shell argument APIs where possible |
| Prompt injection | Repo docs, issues, PRs, web pages, or generated artifacts can contain hostile instructions | instruction hierarchy, explicit trust boundaries, review before automation |
| Unattended automation drift | Long-running agents can make broad changes if scope is unclear | campaign state, handoffs, approval capsules, PR readiness checks |
| Public artifact leakage | `.planning/` can contain project decisions, costs, logs, screenshots, or research | `.gitignore` coverage, private-state guidance, review before sharing |

## Defensive Hooks and Checks

Citadel includes defensive hooks and test coverage for common local automation
risks:

- path traversal and protected-file checks in `hooks_src/protect-files.js`
- external action and consent checks in `hooks_src/external-action-gate.js`
- governance and policy checks in `hooks_src/governance.js`
- post-edit tracking and quality checks in `hooks_src/post-edit.js` and related
  lifecycle hooks
- telemetry and audit records under `.planning/telemetry/`
- security regression tests in `scripts/test-security.js`

Run security checks with:

```bash
node scripts/test-security.js
```

Run the full harness suite with:

```bash
npm run test
```

## Private State Guidance

Do not assume generated Citadel state is safe to publish.

Review these paths before committing, sharing logs, recording demos, or opening
support issues:

- `.planning/`
- `.citadel/`
- `.codex/`
- `.claude/`
- `.mcp.json`
- screenshots, browser captures, telemetry logs, research notes, and handoff
  files

Generated state can include repository structure, work plans, local paths, tool
outputs, review findings, cost telemetry, screenshots, or links to private work.

## Reporting Vulnerabilities

Do not open a public issue for a vulnerability.

Preferred reporting path:

1. Use GitHub private vulnerability reporting or a private security advisory for
   this repository if available.
2. Include the affected file or command, reproduction steps, expected impact,
   and any suggested fix.
3. If private reporting is unavailable, contact the maintainer through a private
   channel listed on their GitHub profile.

Please avoid posting exploit details, secret values, private project paths, or
unredacted `.planning/` artifacts in public threads.

## Security Checklist for Harness Changes

Before shipping changes to hooks, runtime adapters, installers, MCP surfaces, or
unattended automation:

- [ ] Identify the trust boundary being changed.
- [ ] Confirm protected files and project-root checks still apply.
- [ ] Use argument-array process APIs instead of shell-interpreted strings where
      possible.
- [ ] Keep destructive, networked, publish, credential, and cross-repository
      actions behind explicit approval.
- [ ] Add or update focused tests for the changed boundary.
- [ ] Run `npm run test`.
- [ ] Update [THREAT_MODEL.md](THREAT_MODEL.md) when capabilities or boundaries
      change.

## Disclosure Expectations

Security fixes should be small, reviewable, and verified. If a fix changes hook
behavior, generated config, installer output, approval gates, or command
execution, include the exact verification commands in the PR body.

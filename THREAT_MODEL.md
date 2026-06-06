# Threat Model

Citadel is an agent orchestration harness for local coding runtimes. It adds
skills, hooks, scripts, generated configuration, and repo-local state so an AI
coding agent can route work, preserve context, coordinate campaigns, verify
changes, and produce handoffs.

This document describes the trust boundaries Citadel creates. It is not a
guarantee that every downstream project is safe. The repository being worked on,
the active coding runtime, installed tools, and user approvals remain part of
the security boundary.

## Security Goals

Citadel should:

- keep local project automation inspectable and reviewable
- keep destructive or externally visible actions behind approval boundaries
- avoid reading or publishing protected files by default
- make generated state easy to find before a user shares or commits it
- fail closed when a hook cannot validate a sensitive action
- leave enough telemetry and handoff evidence to audit what happened

Citadel does not try to:

- sandbox the entire operating system
- make an untrusted repository safe to run
- prevent every possible prompt-injection attempt
- replace the security model of Claude Code, OpenAI Codex, git, npm, shells, or
  other local tools
- guarantee that generated reports are free of private data

## Primary Assets

| Asset | Why it matters |
|---|---|
| Source files | The agent can modify code, docs, tests, and generated artifacts. |
| Secrets and credentials | `.env` files, tokens, keys, and private config must not be copied into prompts, logs, or public artifacts. |
| Repo-local planning state | `.planning/` can contain campaign details, research, screenshots, telemetry, cost data, local paths, and handoffs. |
| Runtime configuration | `.codex/`, `.claude/`, `.mcp.json`, and generated hook config influence future agent behavior. |
| Git branches and worktrees | Fleet and PR workflows can create, inspect, and coordinate parallel work. |
| External services | GitHub, package registries, MCP servers, and browser targets may have side effects or expose data. |

## Trust Boundaries

### User and Runtime

The user approves or denies actions through the active coding runtime. Citadel
can recommend commands and write approval capsules, but it should not hide the
scope or side effects of a privileged action.

### Repository

The current repository is trusted enough to inspect and modify. That does not
mean its scripts are safe. Package scripts, hooks, test commands, and project
instructions can still perform arbitrary local actions.

### Citadel Hooks

Hooks run inside the local development environment. They can inspect tool
requests, block actions, write telemetry, and add context. Hook failures should
prefer blocking or surfacing a repair over silently allowing sensitive actions.

### Generated State

Citadel writes state under paths such as `.planning/`, `.citadel/`, `.codex/`,
and `.claude/`. These files are useful for continuity, but they may contain
private project details. Users should review them before publishing.

### Agents and Sub-Agents

Parallel agents, Fleet sessions, and campaign continuations inherit project
context and may produce independent diffs or discoveries. Their output should be
merged only through reviewable branches, worktrees, review packages, or PRs.

### External Inputs

Issues, PR comments, webpages, dependency docs, local markdown, generated
reports, and screenshots are untrusted content. They may contain instructions
that conflict with user, system, runtime, or repository policy.

## Threats and Mitigations

| Threat | Example | Mitigation |
|---|---|---|
| Path traversal | A tool request tries to read `../../../secret` | protected-file and project-root validation |
| Protected file read | A prompt asks the agent to dump `.env` | protected-file rules and secret guidance |
| Shell injection | A branch name or file path is interpolated into a shell string | prefer argument-array process APIs and command validators |
| Prompt injection | A README or issue tells the agent to ignore instructions | instruction hierarchy, review posture, explicit trust boundaries |
| Unsafe package install | A task asks for dependency installation without durable project changes | approval gates and dependency drift checks |
| Public leak | A PR includes `.planning/telemetry` or screenshots with private details | ignored generated paths and manual review before publishing |
| Automation overreach | A campaign continues after scope has changed | campaign files, approval capsules, operator console, and PR readiness gates |
| Stale evidence | A readiness report refers to an old branch head | stack readiness checks and rerun requirements |
| Unreviewed merge | Fleet worktrees are accepted blindly | merge-review queues and explicit human approval boundaries |

## Approval-Bound Actions

Citadel should preserve approval boundaries around actions that are destructive,
externally visible, networked, credential-sensitive, or hard to undo.

Examples:

- deleting, moving, or rewriting broad file trees
- installing dependencies or changing lockfiles
- running unfamiliar project scripts
- pushing branches, opening PRs, merging PRs, publishing packages, or creating
  releases
- changing hook policy, runtime configuration, or MCP server setup
- sending outreach, email, API requests, or other external communications
- exposing local app servers outside loopback

## Generated Artifact Review

Before publishing a PR or sharing a demo, inspect generated artifacts for local
paths, private project names, secrets, screenshots, or unrelated findings.

High-risk generated paths include:

- `.planning/research/`
- `.planning/telemetry/`
- `.planning/screenshots/`
- `.planning/handoffs/`
- `.planning/review-packages/`
- `.planning/pr-readiness/`
- `.planning/approval-capsules/`

These paths are valuable evidence, not automatically public documentation.

## Contributor Checklist

When a PR changes security-sensitive behavior, the PR should answer:

- Which trust boundary changed?
- What user-visible approval or report proves the boundary?
- What happens when validation fails?
- Which tests cover the sensitive path?
- Which generated files might contain private data?
- Does the change affect Claude Code, OpenAI Codex, or both?

Run:

```bash
npm run test
```

For hook-specific changes, also run:

```bash
node hooks_src/smoke-test.js
node scripts/verify-hooks.js
node scripts/integration-test.js
```

## Current Review Posture

Citadel review should be strict around:

- hook behavior
- runtime adapters
- installer output
- generated config
- file protection
- command execution
- MCP surfaces
- Fleet and campaign automation
- PR readiness and merge approval

Documentation changes should avoid overclaiming safety. If a guarantee depends
on the active runtime or project scripts, say so directly.

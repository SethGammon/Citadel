# Security

## Reporting a vulnerability

> [!IMPORTANT]
> Do not open a public issue for a vulnerability.

1. Use [GitHub private vulnerability reporting](https://github.com/SethGammon/Citadel/security/advisories/new) for this repository.
2. Include the affected file or command, reproduction steps, expected impact, and any suggested fix.
3. If private reporting is unavailable, contact the maintainer through a private channel listed on their GitHub profile.

Please avoid posting exploit details, secret values, private project paths, or unredacted `.planning/` artifacts in public threads. Security fixes are kept small, reviewable, and verified; if a fix changes hook behavior, generated config, installer output, approval gates, or command execution, the PR body includes the exact verification commands.

## Supported versions

| Version | Supported |
|---|---|
| Latest tagged GitHub Release | Yes |
| Older tags | Best effort; upgrade first, then reproduce |

## What Citadel is, security-wise

Citadel is a local agent orchestration harness. Installing it gives Claude Code or OpenAI Codex project-specific instructions, hooks, scripts, skills, and state files that help an agent operate on a repository. That is useful, but it is also **privileged local automation**: treat an installed Citadel project like any other developer tool that can read project files, run commands, create branches, and write local state.

This document describes the stable release trust boundary. Development-source
experiments are not automatically part of the supported package surface.

### Supported usage

- Local use inside a repository you control.
- Claude Code and OpenAI Codex sessions with normal tool approval boundaries.
- Project-local state under `.planning/`, `.citadel/`, `.codex/`, `.claude/`, and generated runtime configuration files.
- Reviewable pull-request workflows for publishing harness changes.

### Not supported

> [!WARNING]
> The local dashboard, MCP servers, and helper services bind to localhost by design. Exposing them to the public internet without additional authentication and review is outside the security model.

- Installing Citadel in an untrusted repository without inspecting its existing scripts, hooks, package tasks, and agent instructions.
- Treating `.planning/` state as public by default.
- Bypassing runtime approval prompts for destructive, networked, credential, or publish actions.

## Main risks and defenses

| Risk | Why it matters | Primary defenses |
|---|---|---|
| File overreach | Agents can request reads and edits across the project | Protected path checks, project-root validation, reviewable diffs |
| Secret leakage | Project files may contain tokens, `.env` values, or private planning notes | Protected file rules, do-not-publish guidance, local-first state |
| Shell command abuse | Hooks and scripts can run local commands | Command validation, approval gates, non-shell argument APIs where possible |
| Prompt injection | Repo docs, issues, PRs, web pages, or generated artifacts can contain hostile instructions | Instruction hierarchy, explicit trust boundaries, review before automation |
| Unattended automation drift | Long-running agents can make broad changes if scope is unclear | Campaign state, handoffs, approval capsules, PR readiness checks |
| Public artifact leakage | `.planning/` can contain decisions, costs, logs, screenshots, or research | `.gitignore` coverage, private-state guidance, review before sharing |

## Defensive hooks and checks

- Path traversal and protected-file checks in `hooks_src/protect-files.js`.
- External action and consent checks in `hooks_src/external-action-gate.js`.
- Governance and policy checks in `hooks_src/governance.js`.
- Post-edit tracking and quality checks in `hooks_src/post-edit.js` and related lifecycle hooks.
- Tamper-evident telemetry and audit records under `.planning/telemetry/`.
- Security regression tests in the development source suite.

Run the security checks directly, or the full suite:

```bash
node scripts/test-security.js
npm test
```

## .env protection and write boundaries

Citadel's direct-file hooks and bounded shell checks cover different surfaces:

- Read tool calls on any file whose name starts with `.env`, including templates, are blocked by `protect-files.js`. Edit and Write allow template suffixes `.example`, `.sample`, and `.template` but block other `.env*` files.
- Recognized Bash write attempts targeting `.env` files are blocked by `external-action-gate.js`: output redirection (`>` or `>>`), `tee`, and `cp` or `mv` with a `.env` destination. The same template suffixes are exempt. This pattern matching is defense in depth, not complete shell containment.
- Escape hatch: set `"allowEnvWrites": true` in `.claude/harness.json` to disable only the Edit/Write check. Reads and the Bash write patterns stay blocked. The default is blocking.

Write boundaries:

- Direct Edit and Write tool calls outside the project root are blocked, with one allowlisted location: the Claude Code native auto-memory directory under `~/.claude/projects/<project-slug>/memory/`.
- Shells, scripts, interpreters, aliases, expansions, and child processes can write outside that direct-tool boundary. Citadel does not parse arbitrary shell effects and is not an OS sandbox. Complete containment requires the coding runtime's supported sandbox or another OS-level boundary. `scripts/install-hooks.js` reports this boundary explicitly and warns that native-Windows Claude Code cannot establish it through Citadel.
- Every block reason is mirrored to stderr in addition to stdout, so runtimes that only surface stderr still show why an action was stopped.

## Private state guidance

> [!CAUTION]
> Do not assume generated Citadel state is safe to publish. It can include repository structure, work plans, local paths, tool outputs, review findings, cost telemetry, screenshots, or links to private work.

Review these paths before committing, sharing logs, recording demos, or opening support issues: `.planning/`, `.citadel/`, `.codex/`, `.claude/`, `.mcp.json`, plus screenshots, browser captures, telemetry logs, research notes, and handoff files.

## Security checklist for harness changes

Before shipping changes to hooks, runtime adapters, installers, MCP surfaces, or unattended automation:

- [ ] Identify the trust boundary being changed.
- [ ] Confirm protected files and project-root checks still apply.
- [ ] Use argument-array process APIs instead of shell-interpreted strings where possible.
- [ ] Keep destructive, networked, publish, credential, and cross-repository actions behind explicit approval.
- [ ] Add or update focused tests for the changed boundary.
- [ ] Run `npm test`.
- [ ] Update the source threat model when capabilities or boundaries change.

## Operation Fork boundary

Operation Fork creates runtime branches only in a configured worktree root outside the target
repository. Fork IDs, branch IDs, git refs, and every generated path are allowlisted and checked
for containment. Existing symlinks in path segments are rejected. Runtime and verifier processes
receive literal argument arrays with `shell: false`.

Each branch is prohibited from push, publish, deploy, and other external nonrepeatable effects.
Citadel persists an in-progress boundary before runtime and landing effects. If recovery cannot
prove the effect completed, the branch or landing becomes blocked or unknown and Citadel does not
repeat it.

Mission Control may record a revision-bound fork selection through the same-origin nonce gate. It
cannot execute landing. CLI landing requires a selected branch with verified evidence, the current
fork revision, a clean target, the expected target commit, and an exact confirmation token.

Public fork replay is an allowlisted projection. It excludes prompts, source, diffs, repository
identity, local paths, environment values, credentials, command output, raw revisions, free-form
reasons, and signature material. Secret-like or path-like values fail export closed.

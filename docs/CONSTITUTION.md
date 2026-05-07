---
version: 1
last-updated: 2026-05-07
---

# Citadel Constitution

Three-tier policy hierarchy for agent behavior enforcement.
Tier 1 overrides Tier 2, Tier 2 overrides Tier 3.

The `policy-enforcer` agent reads this document to issue allow/block verdicts
for proposed actions. Orchestrators (Archon, Fleet) invoke the policy-enforcer
before Red-reversibility operations.

---

## Tier 1: Project Rules (Hard Constraints — Always Block)

These cannot be overridden by any agent or user instruction during a session.
The only way to change a Tier 1 rule is to edit this document with explicit
user confirmation.

| Rule ID | Rule | Applies To |
|---|---|---|
| P-001 | Never force-push to `main` or `master` branches | all |
| P-002 | Never commit `.env`, `*.pem`, `*.key`, `credentials.*`, `secrets.*` files | all |
| P-003 | Never delete or overwrite `.planning/telemetry/audit.jsonl` | all |
| P-004 | Never pass `--no-verify` to git commands | all |
| P-005 | Never modify `.claude/harness.json` during an automated campaign without explicit user confirmation | archon, fleet |
| P-006 | Files listed in `harness.json.protectedFiles` may not be edited by agents | all |
| P-007 | Never push to a remote repository during a campaign without user confirmation | archon, fleet |

## Tier 2: Engineering Rules (Best Practices — Warn Before Proceeding)

Override acceptable when a justification is logged to the Decision Log.

| Rule ID | Rule | Applies To |
|---|---|---|
| E-001 | Shared hook state must be accessed via `harness-health-util.js` — never raw `fs` calls on harness state files | hooks |
| E-002 | New hook files must follow: read stdin JSON → process → `process.exit(0\|2)` pattern | hooks |
| E-003 | Functions with cyclomatic complexity > 10 require an explanatory comment | all |
| E-004 | CLI scripts must call `process.exit()` explicitly — never rely on implicit exit after async operations | all |
| E-005 | Agent definition files (`agents/*.md`) must have `name`, `description`, `model`, and `disallowedTools` in frontmatter | agents |
| E-006 | Skill files (`skills/*/SKILL.md`) must have `name`, `description`, `user-invocable`, `last-updated` in frontmatter | skills |

## Tier 3: Workflow Rules (Process Guardrails — Advisory)

Override acceptable and does not require logging.

| Rule ID | Rule | Applies To |
|---|---|---|
| W-001 | Every agent response must include a `---HANDOFF---` block | all |
| W-002 | Campaign files must be updated after every phase before advancing to the next | archon |
| W-003 | Scope claims in `.planning/coordination/` must be released when a campaign completes | archon |
| W-004 | Fleet agents must not read another agent's worktree working files during the same wave | fleet |
| W-005 | Phase advancement requires passing phase validator (or exhausted retries with partial marking) | archon, fleet |
| W-006 | Telemetry writes must include `_hash` and `_hash_v: 1` fields (see audit immutability) | all |

---

## How Policy Enforcement Works

### Automatic (hooks)
- `protect-files.js` enforces P-006 on every Edit/Write (blocking, PreToolUse)
- `complexity-check.js` enforces E-003 on every Edit/Write of .js/.ts files (advisory, PostToolUse)
- `governance.js` logs all significant actions to audit trail (observing, PreToolUse)

### Spawned (policy-enforcer agent)
Archon and Fleet spawn the `policy-enforcer` agent before Red-reversibility operations:
- Before any `git push` command
- Before creating or merging pull requests
- Before modifying CI/CD configuration files
- Before operations explicitly flagged as `Red` reversibility

The policy-enforcer receives:
1. The proposed action description
2. The applicable tier rules (caller provides the relevant IDs)
3. Context (campaign slug, agent type, session state)

It returns a JSON verdict: `allow` or `block` with the rule ID and reason.

### Self-enforced (orchestrator protocol)
Orchestrators apply W-001 through W-006 as part of their own protocol.
Violations are logged to the campaign Decision Log, not hard-blocked.

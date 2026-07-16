# Codex Native Integration Matrix

Date: 2026-06-01

This matrix tracks the 12 Codex-native upgrades Citadel now supports or prototypes. Sources are current official OpenAI Codex documentation:

- Plugins and skills: https://developers.openai.com/codex/plugins and https://developers.openai.com/codex/skills
- Hooks: https://developers.openai.com/codex/hooks
- MCP and Codex-as-MCP: https://developers.openai.com/codex/mcp and https://developers.openai.com/codex/guides/agents-sdk
- Subagents, worktrees, automations, non-interactive mode, app server, GitHub, Windows: https://developers.openai.com/codex/subagents, https://developers.openai.com/codex/app/worktrees, https://developers.openai.com/codex/app/automations, https://developers.openai.com/codex/noninteractive, https://developers.openai.com/codex/app-server, https://developers.openai.com/codex/integrations/github, https://developers.openai.com/codex/windows

## 1. Plugin-first install

Citadel emits `.codex-plugin/plugin.json` with Codex-native wording, actual skill counts, bundled skill path, bundled hook path, and MCP config path. Generated plugin metadata is validated by `scripts/compat-tests/compat-15-config-generation.js` and `scripts/test-codex-native-integrations.js`. `scripts/codex-plugin-smoke.js --write` now also generates `.agents/plugins/marketplace.json` and checks the exact local marketplace enable path for the Codex app/CLI. `scripts/codex-install.js` wraps plugin refresh, marketplace generation, target-project fallback artifact generation, readiness verification, Windows checks, and optional CLI marketplace registration into one install command.

Improvement: Codex can load Citadel as a plugin surface instead of depending only on per-project compatibility artifacts.

## 2. Modern hooks

Codex hook projection now enables `[features].hooks = true`, maps `PermissionRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, and `SubagentStop`, and emits plugin-bundled `runtimes/codex/hooks.json` using `PLUGIN_ROOT` on POSIX and Windows.

Improvement: Citadel safety, telemetry, compaction, and subagent handoff hooks run through native Codex lifecycle events where available.

## 3. Correct capability assumptions

`runtimes/codex/runtime.js` and `docs/architecture/capability-matrix.md` now mark skills, subagents, and MCP as first-class Codex surfaces, with app-native worktrees and automations called out separately from CLI fallbacks.

Improvement: future routing decisions stop underusing Codex's native surfaces.

## 4. Bidirectional MCP

`.mcp.json` bundles `citadel-state`, and `scripts/codex-compat.js` emits a native `[mcp_servers.citadel-state]` config for project installs. `mcp-servers/citadel-state/index.js` exposes status, workflow prompts, and a `citadel://status` resource.

Improvement: Codex can query Citadel state as structured MCP data instead of scraping terminal output or rereading all planning files.

## 5. Fleet, subagents, and worktrees

Citadel still projects agents to `.codex/agents/*.toml`. `createFleetExecutionPlan()` records the split: Codex native subagents/worktrees provide execution, while Citadel keeps campaign memory, discovery relay, scope claims, and merge-review.

Improvement: Citadel owns orchestration policy without fighting Codex's native parallel execution model.

## 6. Automation lane

`scripts/codex-automation.js` creates app-ready automation prompts for `schedule`, `daemon`, and `pr-watch`, and records run summaries in `.planning/codex-automations/`.

Improvement: recurring work can move to Codex Automations while Citadel keeps durable state and evidence.

## 7. `codex exec` benchmark runner

`scripts/skill-bench.js --execute --runtime codex-exec` builds real `codex exec` invocations with explicit `--cd`, sandbox, JSON streaming, and last-message capture. Static mode remains CI-safe when Codex is not installed.

Improvement: Citadel can test skills against Codex itself, not just static lint or Claude-specific execution.

## 8. AGENTS.md generation

Codex guidance generation emits setup, verification, review, handoff, native subagent/worktree/MCP/automation notes, and preserves existing `AGENTS.md`. It avoids raw `CLAUDE.md` copying as the primary strategy.

Improvement: Codex receives instructions that match Codex discovery semantics and current harness behavior.

## 9. Native PR review integration

`scripts/codex-pr-review.js` decides whether to use `@codex review`, local Citadel review, or both, then records the plan and later review results in `.planning/pr-review/`. `scripts/codex-review-fetch.js` pulls issue comments, inline review comments, and submitted reviews through `gh api`, ingests Codex-authored P0/P1 findings, and preserves them in the same Citadel PR state.

Improvement: GitHub-visible review work uses Codex's native PR workflow, while Citadel remains responsible for local verification and merge readiness.

## 10. Codex-app-aware QA and artifacts

`scripts/codex-app-artifacts.js` records screenshots, rendered documents, and QA evidence into `.planning/artifacts/codex-app-evidence.jsonl`; QA and live-preview skills point to that manifest. New records include `artifact_id`, `run_id`, `agent_id`, `task_id`, `source_event_id`, `_hash`, and optional HMAC signatures so app evidence can be traced back to a run or task.

Improvement: evidence is discoverable by Codex app/browser/artifact workflows instead of living only in chat text.

## 11. Windows-native setup checks

`scripts/codex-windows-check.js` detects native Windows/WSL, checks generated Codex Windows sandbox configuration, and flags missing shell/sandbox setup.

Improvement: Windows installs get explicit Codex-native readiness checks instead of relying on generic cross-platform Node assumptions.

## 12. App-server prototype

`scripts/codex-app-server-probe.js --dry-run` builds a local app-server probe plan and warns when non-local WebSocket use lacks auth. `scripts/codex-app-server-capture.js` starts a local stdio app-server session, records server JSONL plus client requests, verifies the initialize/thread-start lifecycle, optionally captures a real turn, safely declines command/file approvals by default, and writes a dashboard through `scripts/codex-app-server-dashboard.js`.

Improvement: Citadel has a safe structured path toward Codex app-server events without scraping terminal output or opening unsafe listeners by default.

## Verification

Run:

```bash
node scripts/codex-readiness-check.js --write
node scripts/codex-install.js --plugin-only --dry-run
node scripts/codex-plugin-smoke.js --write
node scripts/test-codex-native-integrations.js
node scripts/test-codex-operational-improvements.js
node scripts/test-hook-installers.js
node scripts/test-project-guidance.js
node scripts/test-compat-fixtures.js
```

For live Codex benchmarking when Codex is installed:

```bash
node scripts/skill-bench.js --execute --runtime codex-exec --codex-sandbox read-only
```

## Operational Follow-Through

The first 12 entries make Codex-native surfaces available. The operational layer makes sure those surfaces are actually usable:

- `scripts/codex-readiness-check.js --write` verifies plugin metadata, skill paths, hook bundle, MCP config, Codex agents, `AGENTS.md`, and artifact manifest readability, then writes `.planning/verification/codex-readiness.json`.
- `scripts/codex-install.js --add-marketplace` prepares the Citadel plugin, writes the local marketplace, generates and verifies target-project Codex artifacts, and optionally registers the marketplace with Codex CLI so the remaining app action is Add to Codex.
- `scripts/codex-plugin-smoke.js --write` writes the local Codex plugin marketplace manifest, validates the plugin entry, and prints the CLI/app steps needed to enable the Citadel Harness plugin. Add `--live` to check the installed Codex CLI without changing global Codex state; use `--add-marketplace` only when you intentionally want the script to register this clone.
- `scripts/codex-review-fetch.js --repo <owner/repo> --pr <n> --write` fetches Codex GitHub review output through `gh api` and records it in `.planning/pr-review/`; `--file review-comments.json` remains available for offline ingestion.
- `scripts/codex-app-artifacts.js verify --require-artifacts` validates that QA/live-preview evidence records point at real files.
- `scripts/verify-telemetry-integrity.js` verifies hashed telemetry and artifact JSONL records, reports legacy records, and detects modified records.
- `scripts/codex-app-server-capture.js` captures a real local app-server handshake and idle thread start into `.planning/app-server/`, verifies it, and writes a browsable dashboard. Add `--turn "prompt"` or `--turn-file prompt.txt` only when you intentionally want to run a model turn. Approval handling defaults to `--approval-decision decline`; use `--expect-approval` with `--turn-sandbox readOnly` or `--turn-approval-policy on-request` for controlled approval probes, and use `accept`, `acceptForSession`, or `cancel` only for intentional live protocol tests.
- `scripts/codex-app-server-dashboard.js --file app-server.jsonl` writes a browsable local dashboard plus JSON summary for app-server thread, turn, approval, command-output, and file-change counts.

These checks close the gap between "Citadel generated Codex artifacts" and "Citadel can prove this project is ready to use Codex safely."

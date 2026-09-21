#!/usr/bin/env node

'use strict';

// Capability notes reflect opencode's actual plugin surface as verified against
// the anomalyco/opencode sources. opencode has no command hooks: lifecycle
// interception is an in-process plugin whose hooks mutate a shared output object
// and throw to block, so Citadel gates on tool.execute.before rather than on the
// permission hook, which upstream declares but never triggers.
module.exports = Object.freeze({
  id: 'opencode',
  displayName: 'opencode',
  capabilities: {
    guidance: { support: 'full', notes: 'Reads AGENTS.md and CLAUDE.md natively, so Citadel guidance projects with no extra renderer.' },
    skills: { support: 'full', notes: 'Discovers .claude/skills, .agents/skills and .opencode/{skill,skills} trees, plus every path in opencode.json skills.paths. Citadel installs a project-local skill projection and generated command wrappers so slash-command arguments reach the corresponding skill.' },
    agents: { support: 'full', notes: 'Loads markdown agents from .opencode/{agent,agents} and supports native subagents via the task tool.' },
    hooks: { support: 'partial', notes: 'Plugin hooks cover pre-tool gating (throw blocks the call, before the tool permission prompt), post-tool, prompt, compaction, and config; Stop and permission events are observe-only and batch/failure events have no equivalent. Stop findings are deferred into the next turn rather than discarded, which is delivery, not enforcement. A project may opt into re-prompting, which starts that next turn itself instead of waiting for a human, under a per-session cap; the event still cannot refuse to end the turn.' },
    workspace: { support: 'full', notes: 'Standard file and shell workflow available, plus a shell.env hook for injecting environment into every shell execution.' },
    worktrees: { support: 'partial', notes: 'Exposes an experimental workspace adapter registration API; Citadel-managed worktrees remain the supported path.' },
    approvals: { support: 'partial', notes: 'The permission.ask hook is declared but never triggered upstream, so Citadel gates on pre-tool instead and treats permission events as observational.' },
    history: { support: 'partial', notes: 'Has native session persistence and a session event bus, but campaign state remains Citadel-owned.' },
    telemetry: { support: 'partial', notes: 'Event-bus hooks are dispatched fire-and-forget, so Citadel telemetry stays external and must not rely on delivery guarantees.' },
    mcp: { support: 'full', notes: 'Configures MCP servers through opencode.json and exposes MCP resource tools through the same pre-tool gate.' },
    surfaces: { support: 'partial', notes: 'Supports plugins, skills, markdown agents, and markdown commands; plugin-authored tools are also available, but slash-command parity remains runtime-specific.' },
  },
  degradations: [
    'plugin-adapter-required-for-hook-parity',
    // Still accurate after phase 6, deferred delivery and opt-in re-prompting
    // alike: a stop-time finding reaches the model on the *next* turn, so it is
    // never enforced before the turn ends. Re-prompting shortens the wait for
    // that next turn; it does not make session.idle refusable. Delivery late is
    // not the same as blocking.
    'stop-cannot-block',
    'permission-gate-not-native',
    'no-batch-or-failure-events',
    // Verified live (phase 5): POST /session/{id}/shell — the TUI's bang-prefixed
    // shell — does not fire tool.execute.before, so a human-issued shell command
    // is ungated. Model-issued bash goes through the tool wrapper and is gated.
    'shell-endpoint-not-gated',
    // Verified live (phase 5): opencode discovers plugins once per process, so
    // installing into a running opencode leaves the session ungated, silently.
    'plugin-discovery-requires-restart',
  ],
});

#!/usr/bin/env node

'use strict';

module.exports = Object.freeze({
  id: 'codex',
  displayName: 'Codex',
  capabilities: {
    guidance: { support: 'full', notes: 'Supports layered AGENTS.md guidance, overrides, fallback filenames, and projected guidance files.' },
    skills: { support: 'full', notes: 'Supports repository, user, admin, system, and plugin-bundled skills with implicit invocation metadata.' },
    agents: { support: 'full', notes: 'Supports projected Codex-native agent manifests and native subagent workflows.' },
    hooks: { support: 'partial', notes: 'Supports native lifecycle hooks, including tool, permission, compaction, subagent, prompt, and stop events; adapter keeps Citadel hooks portable.' },
    workspace: { support: 'full', notes: 'Standard file and shell workflow available.' },
    worktrees: { support: 'partial', notes: 'Codex app supports native Git worktrees and handoff; CLI flows still use Citadel-managed worktrees where needed.' },
    approvals: { support: 'partial', notes: 'Approval model differs from Claude Code and needs adapter-aware policy handling.' },
    history: { support: 'partial', notes: 'Has native session persistence, but campaign state remains Citadel-owned.' },
    telemetry: { support: 'partial', notes: 'Citadel telemetry remains external to runtime-native history.' },
    mcp: { support: 'full', notes: 'Codex supports MCP servers in CLI and IDE, and Codex can run as an MCP server for orchestration.' },
    surfaces: { support: 'partial', notes: 'Supports skills, plugins, app/IDE/CLI surfaces, and Codex app artifacts; slash-command parity remains runtime-specific.' },
  },
  degradations: [
    'adapter-required-for-hook-parity',
    'cli-worktree-handoff-not-native',
  ],
});

#!/usr/bin/env node

'use strict';

module.exports = Object.freeze({
  id: 'openai',
  displayName: 'OpenAI Responses API',
  capabilities: {
    guidance: { support: 'full', notes: 'Supports AGENTS.md and projected guidance files.' },
    skills: { support: 'partial', notes: 'Skills projected via adapter; implicit invocation supported.' },
    agents: { support: 'partial', notes: 'Agent definitions projected to OpenAI-native format.' },
    hooks: { support: 'partial', notes: 'Responses API agent loop provides lifecycle points; adapter required for full parity.' },
    workspace: { support: 'full', notes: 'Shell tool and hosted container workspace available via Responses API.' },
    worktrees: { support: 'none', notes: 'OpenAI runtimes do not provide native git worktree support.' },
    approvals: { support: 'partial', notes: 'Approval flow requires adapter-level policy handling.' },
    history: { support: 'partial', notes: 'Responses API provides conversation state; campaign state remains Citadel-owned.' },
    telemetry: { support: 'partial', notes: 'Citadel telemetry is external to runtime-native logging.' },
    mcp: { support: 'partial', notes: 'Responses API has built-in tool support; MCP bridge possible but not native.' },
    surfaces: { support: 'partial', notes: 'Reusable agent skills in Responses API map to Citadel skill surface.' },
  },
  degradations: [
    'reduced-hook-lifecycle',
    'adapter-required-for-hook-parity',
    'no-worktree-support',
  ],
});

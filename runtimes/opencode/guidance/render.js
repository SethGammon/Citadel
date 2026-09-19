#!/usr/bin/env node

'use strict';

// opencode reads AGENTS.md, then CLAUDE.md (session/instruction.ts:61-68), with
// the first project-level match winning.
//
// This was originally a re-export of the Codex renderer, on the reasoning that
// both target AGENTS.md so one renderer would do. That was wrong twice over: the
// re-export was never invoked by the installer (dead code), and its output is
// Codex-specific in ways that actively mislead an opencode agent — it announces
// itself as "the Codex-facing projection", has a "## Codex Notes" section, and
// tells the reader to invoke skills as `$skill-name`. Phase 5 verified that
// opencode registers each skill as a `/` slash command instead.
//
// So this renders opencode's own guidance, and only states things verified against
// opencode 1.18.30.

function renderList(items) {
  return (items || []).map((item) => `- ${item}`).join('\n');
}

function renderOpencodeGuidance(spec) {
  return [
    `# ${spec.project.name}`,
    '',
    spec.project.summary,
    '',
    '## Citadel Project Guidance',
    '',
    'This file is the opencode-facing projection of the canonical Citadel project spec at `.citadel/project.md`. Edit the spec, not this file: it is regenerated. opencode reads `AGENTS.md` first and falls back to `CLAUDE.md`, taking the first project-level match.',
    '',
    '## Conventions',
    '',
    renderList(spec.conventions),
    '',
    '## Workflows',
    '',
    renderList(spec.workflows),
    '',
    '## Constraints',
    '',
    renderList(spec.constraints),
    '',
    '## Verification',
    '',
    '- Use the narrowest command that proves the changed behavior.',
    "- Run the target project's declared full verification command after modifying hooks, skills, runtime adapters, or shared architecture code.",
    '- Run targeted tests first when the change is scoped to one script, hook, or generator.',
    '',
    '## Review Guidelines',
    '',
    '- Lead with correctness, security, regression risk, and missing verification.',
    '- Keep findings concrete with file and line references when reviewing code.',
    '',
    '## Using Citadel under opencode',
    '',
    '- Citadel skills are available as `/` slash commands; opencode registers every discovered skill as a command.',
    '- Citadel agents are available as subagents through `@`.',
    '- `/skill-name args` only works when a human types it into the chat input. There is no tool that runs a slash command with arguments, and running it through the bash tool just sends the literal text to a real shell, which has no such program. To continue a skill or campaign from inside a turn (for example, an instruction to "invoke `/archon continue`"), delegate to the matching agent with the `task` tool instead, passing the continuation text as the prompt.',
    '- Keep durable campaign, fleet, research, and verification state under `.planning/` when a workflow spans sessions.',
    '- Citadel state tools are exposed through the `citadel-state` MCP server.',
    '',
    '## What Citadel does and does not gate here',
    '',
    'Citadel enforces its file and external-action policies through a plugin on opencode\'s pre-tool hook, so tool calls you make are checked before they run. Three limits are worth knowing, because they are properties of opencode rather than choices Citadel made:',
    '',
    '- A shell command issued with the TUI\'s `!` prefix does not pass through the tool hook, so it is **not** gated. Prefer the `bash` tool for anything that should be policy-checked.',
    '- The stop event cannot block, so quality-gate findings are reported rather than enforced at the end of a turn.',
    '- If the Citadel plugin fails to load, opencode continues with no gating and says so only in its own log.',
    '',
    '## Handoff Summary',
    '',
    'When a task completes, prefer a concise handoff that states:',
    '',
    '- What changed',
    '- Key decisions',
    '- Remaining risks or next steps',
    '',
  ].join('\n');
}

const OPENCODE_GUIDANCE_TARGET = Object.freeze({
  runtime: 'opencode',
  filePath: 'AGENTS.md',
  render: renderOpencodeGuidance,
});

module.exports = Object.freeze({
  OPENCODE_GUIDANCE_TARGET,
  renderOpencodeGuidance,
});

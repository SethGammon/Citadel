#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const DELEGATE_SCRIPTS = new Set(require('../../../hooks_src/delegate-scripts.json'));
const SCRIPT_ROUTE = /\b(node(?:\.exe)?\s+)(["']?)scripts[\\/]([A-Za-z0-9_.-]+\.(?:js|cjs))\2/g;

function rewriteSkillCommand(command, projectRoot, fileSystem = fs) {
  if (typeof command !== 'string' || !projectRoot) return command;
  return command.replace(SCRIPT_ROUTE, (match, node, quote, scriptName) => {
    if (!DELEGATE_SCRIPTS.has(scriptName)) return match;
    const delegate = path.join(projectRoot, '.citadel', 'scripts', scriptName);
    if (!fileSystem.existsSync(delegate)) return match;
    return `${node}${quote}.citadel/scripts/${scriptName}${quote}`;
  });
}

// Citadel's skill instructions ("invoke `/archon continue`") are written for
// Claude Code, where a model can invoke a slash-referenced skill directly.
// opencode has no such tool: `/name args` is a TUI-only convenience that opencode
// parses from a human's chat input before it ever reaches the model. A model
// that follows the instruction literally has nowhere to send it except the bash
// tool, and a real shell has no `/archon` binary -- hence `/archon: The term
// '/archon' is not recognized...`. Recognize the pattern before it reaches the
// shell and hand back a corrective message instead of a confusing shell error.
const SLASH_COMMAND_PATTERN = /^\/([A-Za-z][\w-]*)(?:[ \t]+([\s\S]*))?$/;

function skillOrAgentNames(dir, fileSystem, requireSkillFile) {
  const names = new Set();
  if (!fileSystem.existsSync(dir)) return names;
  for (const entry of fileSystem.readdirSync(dir, { withFileTypes: true })) {
    if (requireSkillFile) {
      if (entry.isDirectory() && fileSystem.existsSync(path.join(dir, entry.name, 'SKILL.md'))) {
        names.add(entry.name);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      names.add(entry.name.slice(0, -3));
    }
  }
  return names;
}

// Every source Citadel could have projected a name from, so the check only
// fires on something this project actually exposes -- never on a coincidental
// `/word` in an unrelated shell command.
function knownCitadelNames(projectRoot, fileSystem = fs) {
  const names = new Set();
  for (const name of skillOrAgentNames(path.join(projectRoot, '.citadel', 'skills'), fileSystem, true)) names.add(name);
  for (const name of skillOrAgentNames(path.join(projectRoot, 'skills'), fileSystem, true)) names.add(name);
  for (const name of skillOrAgentNames(path.join(projectRoot, '.opencode', 'agent'), fileSystem, false)) names.add(name);
  for (const name of skillOrAgentNames(path.join(projectRoot, '.opencode', 'commands'), fileSystem, false)) names.add(name);
  return names;
}

function interceptSlashCommand(command, projectRoot, fileSystem = fs) {
  if (typeof command !== 'string' || !projectRoot) return null;
  const match = SLASH_COMMAND_PATTERN.exec(command.trim());
  if (!match) return null;
  const [, name, args] = match;
  if (!knownCitadelNames(projectRoot, fileSystem).has(name)) return null;

  const rest = (args || '').trim();
  return [
    `[citadel] "/${name}${rest ? ` ${rest}` : ''}" is a slash command. It only works when a human types it into opencode's chat input -- opencode has no tool that runs a slash command with arguments, and the bash tool just handed it to a real shell, which has no "/${name}" program.`,
    `To continue "${name}" from inside this turn instead:`,
    `- If "${name}" is an agent (check .opencode/agent/${name}.md), delegate to it with the task tool and pass "${rest || name}" as the prompt.`,
    `- Otherwise, read its SKILL.md (skills/${name}/SKILL.md or .citadel/skills/${name}/SKILL.md) and follow its protocol directly for this turn.`,
  ].join('\n');
}

function injectShellEnvironment(env, projectRoot) {
  if (!env || typeof env !== 'object') return;
  env.CITADEL_RUNTIME = 'opencode';
  env.CITADEL_PROJECT_ROOT = projectRoot;
  env.CLAUDE_PROJECT_DIR = projectRoot;
}

module.exports = Object.freeze({
  injectShellEnvironment,
  interceptSlashCommand,
  knownCitadelNames,
  rewriteSkillCommand,
});

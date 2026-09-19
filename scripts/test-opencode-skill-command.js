#!/usr/bin/env node

'use strict';

// Regression coverage for the fix to `/archon: The term '/archon' is not
// recognized...`. Citadel's skill instructions say things like "invoke
// `/archon continue`", written for Claude Code. opencode has no tool that
// invokes a slash command with arguments -- that syntax only works when a
// human types it into the chat input -- so a model following the instruction
// literally has nowhere to send it except the bash tool, which hands the
// literal text to a real shell. `interceptSlashCommand` catches that pattern
// before it reaches the shell.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const skillCommand = require(path.join(__dirname, '..', 'runtimes', 'opencode', 'plugin', 'skill-command'));
const { interceptSlashCommand, knownCitadelNames } = skillCommand;

function scratchProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-oc-skillcmd-'));
}

function withProject(run) {
  const root = scratchProject();
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 1. The exact reported failure: a projected skill invoked as `/name args`
// through bash must be caught, not handed to the shell.
withProject((root) => {
  fs.mkdirSync(path.join(root, '.citadel', 'skills', 'archon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.citadel', 'skills', 'archon', 'SKILL.md'), '---\nname: archon\n---\nbody\n');

  const message = interceptSlashCommand('/archon continue', root);
  assert(message, 'a known skill invoked as a slash command must be intercepted');
  assert.match(message, /\/archon continue/);
  assert.match(message, /task tool/, 'must point at the task tool as the real mechanism');
  assert(!/^\{/.test(message), 'must be human text, not a JSON envelope');
});

// 2. Agents projected to .opencode/agent are recognized too (archon and fleet
// ship as agents, not only as skills).
withProject((root) => {
  fs.mkdirSync(path.join(root, '.opencode', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(root, '.opencode', 'agent', 'fleet.md'), '---\nmode: subagent\n---\nbody\n');

  const message = interceptSlashCommand('/fleet continue', root);
  assert(message, 'a projected agent invoked as a slash command must be intercepted');
  assert(knownCitadelNames(root).has('fleet'));
});

// 3. No false positives: unrelated bash commands, and a `/name` that matches
// nothing this project actually exposes, must pass through untouched.
withProject((root) => {
  assert.equal(interceptSlashCommand('git status', root), null);
  assert.equal(interceptSlashCommand('/usr/bin/env node script.js', root), null, 'a real absolute path must not match');
  assert.equal(interceptSlashCommand('/archon continue', root), null, 'unknown to this project -- must not fire on a coincidental /word');
  assert.equal(interceptSlashCommand('echo "/archon continue"', root), null, 'not a bare slash command');
});

// 4. Ordinary node-script commands are not slash commands and are never
// rewritten, even when an installed delegate shares the script's name: a target
// repository may own its own `scripts/dashboard.js`.
withProject((root) => {
  fs.mkdirSync(path.join(root, '.citadel', 'skills', 'archon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.citadel', 'skills', 'archon', 'SKILL.md'), '---\nname: archon\n---\nbody\n');
  assert(interceptSlashCommand('/archon continue', root) !== null);

  fs.mkdirSync(path.join(root, '.citadel', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.citadel', 'scripts', 'dashboard.js'), '// stub\n');
  assert.equal(interceptSlashCommand('node scripts/dashboard.js --json', root), null);
});

// 5. The module offers no way to rewrite an arbitrary bash command.
assert.equal(skillCommand.rewriteSkillCommand, undefined, 'bash commands must not be rewritable by the plugin');

console.log('opencode skill-command tests passed');

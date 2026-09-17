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

function injectShellEnvironment(env, projectRoot) {
  if (!env || typeof env !== 'object') return;
  env.CITADEL_RUNTIME = 'opencode';
  env.CITADEL_PROJECT_ROOT = projectRoot;
  env.CLAUDE_PROJECT_DIR = projectRoot;
}

module.exports = Object.freeze({ injectShellEnvironment, rewriteSkillCommand });

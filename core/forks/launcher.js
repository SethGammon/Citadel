'use strict';

const fs = require('fs');
const path = require('path');

// Windows cannot CreateProcess a .cmd/.bat shim directly. Citadel resolves
// supported npm shims to their JavaScript entrypoint and launches them through
// Node, preserving literal argv without a command interpreter.
const DIRECT_EXTENSIONS = Object.freeze(['.exe', '.com']);
const SHIM_EXTENSIONS = Object.freeze(['.cmd', '.bat']);

function pathEntries(env) {
  return String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
}

function findOnPath(command, env) {
  if (command.includes('/') || command.includes('\\') || path.isAbsolute(command)) {
    return fs.existsSync(command) ? command : null;
  }
  const extensions = [...DIRECT_EXTENSIONS, ...SHIM_EXTENSIONS];
  for (const directory of pathEntries(env)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (_error) { /* keep looking */ }
    }
  }
  return null;
}

function nodeEntrypoint(command, resolved) {
  const root = path.dirname(resolved);
  if (command === 'codex') return path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (command === 'claude') return path.join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  return null;
}

/**
 * Resolve a canonical invocation into something spawnable with shell: false.
 * Non-Windows platforms are returned untouched. Windows prefers a real
 * executable image and only accepts a shim when its known package entrypoint
 * can be launched directly through Node.
 */
function platformInvocation(invocation, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform !== 'win32') return { ...invocation, windowsVerbatimArguments: false };
  const resolved = (options.resolve || findOnPath)(invocation.command, env);
  if (!resolved) return { ...invocation, windowsVerbatimArguments: false };
  const extension = path.extname(resolved).toLowerCase();
  if (!SHIM_EXTENSIONS.includes(extension)) {
    return { command: resolved, args: [...invocation.args], windowsVerbatimArguments: false };
  }
  const entrypoint = (options.resolveEntrypoint || nodeEntrypoint)(invocation.command, resolved);
  if (!entrypoint || !(options.exists || fs.existsSync)(entrypoint)) {
    throw Object.assign(new Error('Executor shim has no trusted direct entrypoint'), {
      code: 'FORK_EXECUTOR_SHIM_UNSAFE',
    });
  }
  return {
    command: options.nodePath || process.execPath,
    args: [entrypoint, ...invocation.args],
    windowsVerbatimArguments: false,
  };
}

module.exports = Object.freeze({
  findOnPath, nodeEntrypoint, platformInvocation,
});

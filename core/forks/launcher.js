'use strict';

const fs = require('fs');
const path = require('path');

// Windows cannot CreateProcess a .cmd/.bat shim directly. Citadel resolves
// supported Node-package shims to their JavaScript entrypoint and launches
// them through Node, preserving literal argv without a command interpreter.
const DIRECT_EXTENSIONS = Object.freeze(['.exe', '.com']);
const SHIM_EXTENSIONS = Object.freeze(['.cmd', '.bat']);

function pathEntries(env, platform = process.platform) {
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.delimiter;
  return String(env.PATH || env.Path || '').split(delimiter).filter(Boolean);
}

function candidateDirectories(command, env, platform = process.platform) {
  const directories = [];
  const platformPath = platform === 'win32' ? path.win32 : path;
  // The Windows Store desktop bundle can expose an executable path that is
  // visible but not launchable as a CLI. Prefer the official npm shim for the
  // two supported runtimes when it exists under the conventional user npm
  // directory. The shim is still converted to a reviewed JavaScript entrypoint
  // below and never launched through a command interpreter.
  if (['codex', 'claude'].includes(command)
    && typeof env.APPDATA === 'string'
    && platformPath.isAbsolute(env.APPDATA)
    && !/[\r\n\0]/.test(env.APPDATA)) {
    directories.push(platformPath.join(env.APPDATA, 'npm'));
  }
  directories.push(...pathEntries(env, platform));
  const seen = new Set();
  return directories.filter((directory) => {
    const key = platform === 'win32' ? directory.toLowerCase() : directory;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findOnPath(command, env) {
  if (command.includes('/') || command.includes('\\') || path.isAbsolute(command)) {
    return fs.existsSync(command) ? command : null;
  }
  const explicitExtension = path.extname(command).toLowerCase();
  const extensions = [...DIRECT_EXTENSIONS, ...SHIM_EXTENSIONS].includes(explicitExtension)
    ? [''] : [...DIRECT_EXTENSIONS, ...SHIM_EXTENSIONS];
  for (const directory of candidateDirectories(command, env)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (_error) { /* keep looking */ }
    }
  }
  return null;
}

function nodeEntrypoint(command, resolved, platform = process.platform) {
  const platformPath = platform === 'win32' ? path.win32 : path;
  const root = platformPath.dirname(resolved);
  const name = platformPath.basename(command).replace(/\.(?:cmd|bat)$/i, '').toLowerCase();
  if (name === 'codex') return platformPath.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (name === 'claude') return platformPath.join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  if (name === 'npm') return platformPath.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (name === 'npx') return platformPath.join(root, 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (name === 'corepack') return platformPath.join(root, 'node_modules', 'corepack', 'dist', 'corepack.js');
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
  const entrypoint = (options.resolveEntrypoint || nodeEntrypoint)(invocation.command, resolved, platform);
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
  candidateDirectories, findOnPath, nodeEntrypoint, platformInvocation,
});

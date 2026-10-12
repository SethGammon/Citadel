'use strict';

const fs = require('fs');
const path = require('path');

const CITADEL_ROOT = path.resolve(__dirname, '..', '..');

function requireProjectRoot(projectRoot) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw new TypeError('Config command generation requires an explicit projectRoot');
  }
  return path.resolve(projectRoot);
}

function delegatedInstallation(projectRoot) {
  try {
    const target = fs.readFileSync(path.join(projectRoot, '.citadel', 'plugin-root.txt'), 'utf8').trim();
    return target || null;
  } catch {
    return null;
  }
}

// Receipts are checked against the installation generation of the code doing
// the check, so a command must run that same installation. Two paths with the
// same generation (e.g. one release cached by two runtimes) are equivalent.
function sameInstallation(left, right) {
  if (path.resolve(left) === path.resolve(right)) return true;
  try {
    const { installationGeneration } = require('../config/identity');
    return installationGeneration({ installationRoot: left }).id
      === installationGeneration({ installationRoot: right }).id;
  } catch {
    return false;
  }
}

function configScriptPath(projectRoot, installationRoot) {
  const root = requireProjectRoot(projectRoot);
  const checking = path.resolve(installationRoot || CITADEL_ROOT);
  const checkingScript = path.join(checking, 'scripts', 'citadel-config.js');
  const delegate = path.join(root, '.citadel', 'scripts', 'citadel-config.js');
  const delegated = fs.existsSync(delegate) ? delegatedInstallation(root) : null;
  // Prefer the project-relative delegate only when it reaches the checking installation.
  if (delegated && sameInstallation(delegated, checking)) return delegate;
  if (fs.existsSync(checkingScript)) return checkingScript;
  if (fs.existsSync(delegate)) return delegate;
  return path.join(CITADEL_ROOT, 'scripts', 'citadel-config.js');
}

function buildConfigInvocation(options = {}) {
  const projectRoot = requireProjectRoot(options.projectRoot);
  if (typeof options.subcommand !== 'string' || !options.subcommand.trim()) {
    throw new TypeError('Config command generation requires a subcommand');
  }
  return Object.freeze({
    command: 'node',
    args: Object.freeze([
      configScriptPath(projectRoot, options.installationRoot),
      options.subcommand.trim(),
      '--project-root', projectRoot,
      ...(Array.isArray(options.args) ? options.args.map(String) : []),
    ]),
  });
}

function activeShell(platform = process.platform, env = process.env) {
  if (platform !== 'win32') return 'posix';
  const interactivePosix = typeof env.TERM === 'string' && !/^(?:dumb|unknown)$/i.test(env.TERM);
  return interactivePosix
      && typeof env.SHELL === 'string'
      && /(?:^|[\\/])(ba|z|fi|da)?sh(?:\.exe)?$/i.test(env.SHELL)
    ? 'posix'
    : 'powershell';
}

function shellQuote(value, shell = activeShell()) {
  const text = String(value);
  const safe = shell === 'powershell'
    ? /^[a-zA-Z0-9_./:\\=-]+$/
    : /^[a-zA-Z0-9_./:=\-]+$/;
  if (safe.test(text)) return text;
  if (shell === 'powershell') return `'${text.replace(/'/g, "''")}'`;
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

function renderConfigCommand(options = {}) {
  const invocation = buildConfigInvocation(options);
  const shell = options.shell || activeShell(options.platform, options.env);
  return [invocation.command, ...invocation.args]
    .map((part) => shellQuote(part, shell))
    .join(' ');
}

module.exports = Object.freeze({ activeShell, buildConfigInvocation, configScriptPath, renderConfigCommand, shellQuote });

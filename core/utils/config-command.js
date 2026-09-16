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

function configScriptPath(projectRoot, installationRoot) {
  const root = requireProjectRoot(projectRoot);
  const delegate = path.join(root, '.citadel', 'scripts', 'citadel-config.js');
  if (fs.existsSync(delegate)) return delegate;
  const requested = installationRoot
    ? path.join(path.resolve(installationRoot), 'scripts', 'citadel-config.js')
    : null;
  if (requested && fs.existsSync(requested)) return requested;
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

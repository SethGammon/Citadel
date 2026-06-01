#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_PLUGIN_ROOT = path.resolve(__dirname, '..');

function has(flag) {
  return process.argv.includes(flag);
}

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function q(value) {
  const text = String(value);
  return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function display(command, args) {
  return [command, ...args].map(q).join(' ');
}

function parseJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function runStep({ name, command, args, cwd, dryRun, timeout = 60000, required = true }) {
  const rendered = display(command, args);
  if (dryRun) {
    return {
      name,
      command: rendered,
      cwd,
      required,
      skipped: true,
      pass: true,
      status: 0,
      stdout: '',
      stderr: '',
      json: null,
    };
  }

  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && command === 'claude',
    timeout,
  });

  return {
    name,
    command: rendered,
    cwd,
    required,
    skipped: false,
    pass: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').slice(0, 12000),
    stderr: (result.stderr || '').slice(0, 12000),
    error: result.error ? result.error.message : null,
    json: parseJson(result.stdout),
  };
}

function skippedStep({ name, command, args, cwd, detail }) {
  return {
    name,
    command: display(command, args),
    cwd,
    required: true,
    skipped: true,
    pass: true,
    status: 0,
    stdout: detail || '',
    stderr: '',
    json: null,
  };
}

function failedStep({ name, command, args, cwd, detail }) {
  return {
    name,
    command: display(command, args),
    cwd,
    required: true,
    skipped: false,
    pass: false,
    status: 1,
    stdout: '',
    stderr: detail || '',
    json: null,
  };
}

function listClaudeMarketplaces(cwd) {
  const result = spawnSync('claude', ['plugin', 'marketplace', 'list', '--json'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: 30000,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout || '[]');
  } catch {
    return null;
  }
}

function listClaudePlugins(cwd) {
  const result = spawnSync('claude', ['plugin', 'list', '--json'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: 30000,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout || '[]');
  } catch {
    return null;
  }
}

function marketplaceAddStep({ pluginRoot, projectRoot, scope, dryRun }) {
  const command = 'claude';
  const args = ['plugin', 'marketplace', 'add', pluginRoot, '--scope', scope];
  const name = 'Register Citadel marketplace with Claude Code';
  if (dryRun) return runStep({ name, command, args, cwd: projectRoot, dryRun, timeout: 30000 });

  const marketplaces = listClaudeMarketplaces(projectRoot);
  const existing = Array.isArray(marketplaces)
    ? marketplaces.find((marketplace) => marketplace.name === 'citadel-local')
    : null;
  if (existing) {
    const existingPath = existing.path ? path.resolve(existing.path) : null;
    if (existingPath && existingPath === pluginRoot) {
      return skippedStep({
        name,
        command,
        args,
        cwd: projectRoot,
        detail: `citadel-local already registered at ${existingPath}`,
      });
    }
    return failedStep({
      name,
      command,
      args,
      cwd: projectRoot,
      detail: `citadel-local is already registered from ${existing.path || existing.repo || existing.source}; remove or update that marketplace before adding ${pluginRoot}.`,
    });
  }

  return runStep({ name, command, args, cwd: projectRoot, dryRun, timeout: 30000 });
}

function pluginInstallStep({ projectRoot, scope, dryRun }) {
  const command = 'claude';
  const args = ['plugin', 'install', 'citadel@citadel-local', '--scope', scope];
  const name = 'Install Citadel Harness plugin';
  if (dryRun) return runStep({ name, command, args, cwd: projectRoot, dryRun, timeout: 30000 });

  const plugins = listClaudePlugins(projectRoot);
  const existing = Array.isArray(plugins)
    ? plugins.find((plugin) => plugin.id === 'citadel@citadel-local' && plugin.scope === scope)
    : null;
  if (existing) {
    return skippedStep({
      name,
      command,
      args,
      cwd: projectRoot,
      detail: `citadel@citadel-local already installed in ${scope} scope`,
    });
  }
  return runStep({ name, command, args, cwd: projectRoot, dryRun, timeout: 30000 });
}

function printHuman(report) {
  console.log('Citadel Claude Code install');
  console.log('='.repeat(32));
  console.log(`Plugin root:  ${report.pluginRoot}`);
  console.log(`Project root: ${report.projectRoot}`);
  console.log(`Scope:        ${report.scope}`);
  console.log('');
  for (const step of report.steps) {
    const status = step.pass ? 'PASS' : 'FAIL';
    const skipped = step.skipped ? ' (dry run)' : '';
    console.log(`[${status}] ${step.name}${skipped}`);
    console.log(`       ${step.command}`);
    if (!step.pass && step.stderr) console.log(step.stderr.trim());
  }
  console.log('');
  console.log(report.pass ? 'Install prep passed.' : 'Install prep failed.');
  console.log('');
  console.log('Next in Claude Code:');
  for (const item of report.nextSteps.claudeCode) console.log(`  - ${item}`);
}

if (has('--help') || has('-h')) {
  console.log(`Usage: node scripts/claude-install.js [options]

Prepares and optionally installs Citadel for Claude Code.

Options:
  --project-root PATH       Target project to prepare; defaults to current directory.
  --target-project PATH     Alias for --project-root.
  --plugin-root PATH        Citadel clone; defaults to this script's parent directory.
  --scope <scope>           Claude install scope: local, project, or user. Defaults to local.
  --install                 Add marketplace, install plugin, and install hooks.
  --add-marketplace         Run: claude plugin marketplace add <plugin-root>.
  --install-plugin          Run: claude plugin install citadel@citadel-local.
  --install-hooks           Install resolved Citadel hooks into the target project.
  --skip-validate           Skip claude plugin validate.
  --dry-run                 Print planned commands without writing files.
  --json                    Print machine-readable JSON only.

Common use:
  cd /path/to/your-project
  node /path/to/Citadel/scripts/claude-install.js --install --scope local
`);
  process.exit(0);
}

const dryRun = has('--dry-run');
const jsonOnly = has('--json');
const install = has('--install');
const addMarketplace = install || has('--add-marketplace');
const installPlugin = install || has('--install-plugin');
const installHooks = install || has('--install-hooks');
const skipValidate = has('--skip-validate');
const scope = arg('--scope', 'local');
const pluginRoot = path.resolve(arg('--plugin-root', DEFAULT_PLUGIN_ROOT));
const projectRoot = path.resolve(arg('--project-root', arg('--target-project', process.cwd())));

const missingPaths = [
  path.join(pluginRoot, '.claude-plugin', 'marketplace.json'),
  path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
  path.join(pluginRoot, 'scripts', 'install-hooks.js'),
].filter((filePath) => !fs.existsSync(filePath));

if (!['local', 'project', 'user'].includes(scope)) {
  missingPaths.push(`invalid --scope ${scope}; expected local, project, or user`);
}

if (missingPaths.length > 0) {
  const report = {
    pluginRoot,
    projectRoot,
    scope,
    pass: false,
    steps: [],
    missingPaths,
    nextSteps: { claudeCode: [] },
  };
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(`Citadel Claude installer cannot continue:\n${missingPaths.join('\n')}`);
  }
  process.exit(1);
}

const steps = [];
const node = process.execPath;

if (!skipValidate) {
  steps.push(runStep({
    name: 'Validate Claude Code plugin marketplace',
    command: 'claude',
    args: ['plugin', 'validate', pluginRoot],
    cwd: pluginRoot,
    dryRun,
    timeout: 30000,
  }));
}

if (addMarketplace) {
  steps.push(marketplaceAddStep({ pluginRoot, projectRoot, scope, dryRun }));
}

if (installPlugin) {
  steps.push(pluginInstallStep({ projectRoot, scope, dryRun }));
}

if (installHooks) {
  steps.push(runStep({
    name: 'Install resolved Citadel hooks',
    command: node,
    args: [path.join(pluginRoot, 'scripts', 'install-hooks.js'), projectRoot],
    cwd: projectRoot,
    dryRun,
  }));
}

const pass = steps.every((step) => step.pass || !step.required);
const report = {
  pluginRoot,
  projectRoot,
  scope,
  dryRun,
  install,
  generatedAt: new Date().toISOString(),
  steps,
  pass,
  nextSteps: {
    claudeCode: [
      install ? 'Run claude from the target project.' : `Run claude plugin marketplace add ${q(pluginRoot)} --scope ${scope} if you want CLI marketplace registration.`,
      install ? 'Citadel Harness is installed for this scope; start a fresh Claude Code session if it was already open.' : 'Inside Claude Code, run /plugin and install Citadel Harness from Citadel Local Plugins.',
      installHooks ? 'Hooks were installed directly; /do setup will still detect the stack and create project state.' : 'Run /do setup --express to install hooks and initialize project state.',
      'Run /do --list, then /do review path/to/file to verify the first workflow.',
    ],
  },
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

process.exit(pass ? 0 : 1);

#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  classifyOutputs,
  ensureMachineLocalExcludes,
  inspectInstallInventory,
} = require('../core/runtime/install-contract');

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
    shell: process.platform === 'win32' && command === 'codex',
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

function printHuman(report) {
  console.log('Citadel Codex install');
  console.log('='.repeat(28));
  console.log(`Plugin root:  ${report.pluginRoot}`);
  console.log(`Project root: ${report.projectRoot}`);
  console.log('');
  for (const step of report.steps) {
    const status = step.skipped && report.dryRun ? 'PLAN' : step.pass ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${step.name}`);
    console.log(`       ${step.command}`);
    if (!step.pass && step.stderr) console.log(step.stderr.trim());
  }
  if (report.diagnostics?.length) {
    console.log('');
    console.log('Diagnostics:');
    for (const diagnostic of report.diagnostics) console.log(`  - ${diagnostic.message}`);
  }
  if (report.machineLocalExcludes?.written) {
    console.log(`Machine-local outputs are protected by ${report.machineLocalExcludes.path}`);
  }
  console.log('');
  console.log(report.pass
    ? report.dryRun ? 'Install plan ready; no commands were run.' : 'Citadel plugin installation completed.'
    : 'Citadel plugin installation failed.');
  console.log('');
  console.log('Next in Codex app:');
  for (const item of report.nextSteps.codexApp) console.log(`  - ${item}`);
  console.log('');
  console.log('Next in Codex CLI:');
  for (const item of report.nextSteps.codexCli) console.log(`  - ${item}`);
}

if (has('--help') || has('-h')) {
  console.log(`Usage: node scripts/codex-install.js [options]

Prepares Citadel for Codex and verifies the target project.

Options:
  --project-root PATH       Target project to prepare; defaults to current directory.
  --target-project PATH     Alias for --project-root.
  --plugin-root PATH        Citadel clone; defaults to this script's parent directory.
  --install                 Add the marketplace and install citadel@citadel-local.
  --install-plugin          Run: codex plugin add citadel@citadel-local.
  --plugin-only             Prepare the Citadel plugin and marketplace only.
  --skip-plugin-refresh     Do not regenerate plugin-root Codex artifacts.
  --skip-windows-check      Skip Windows-specific Codex readiness check.
  --add-marketplace         Run: codex plugin marketplace add <plugin-root>.
  --dry-run                 Print planned commands without writing files.
  --json                    Print machine-readable JSON only.

Common use:
  cd /path/to/your-project
  node /path/to/Citadel/scripts/codex-install.js --install
`);
  process.exit(0);
}

const dryRun = has('--dry-run');
const jsonOnly = has('--json');
const install = has('--install');
const pluginOnly = has('--plugin-only') || install;
const skipPluginRefresh = has('--skip-plugin-refresh');
const skipWindowsCheck = has('--skip-windows-check');
const addMarketplace = install || has('--add-marketplace');
const installPlugin = install || has('--install-plugin');
const pluginRoot = path.resolve(arg('--plugin-root', DEFAULT_PLUGIN_ROOT));
const projectRoot = path.resolve(arg('--project-root', arg('--target-project', process.cwd())));

const requiredScripts = [
  'scripts/codex-compat.js',
  'scripts/codex-plugin-smoke.js',
  'scripts/codex-readiness-check.js',
  'scripts/codex-windows-check.js',
];

const missingScripts = requiredScripts
  .map((script) => path.join(pluginRoot, script))
  .filter((scriptPath) => !fs.existsSync(scriptPath));

if (missingScripts.length > 0) {
  const report = {
    pluginRoot,
    projectRoot,
    pass: false,
    steps: [],
    missingScripts,
    nextSteps: { codexApp: [], codexCli: [] },
  };
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(`Citadel install script is missing required files:\n${missingScripts.join('\n')}`);
  }
  process.exitCode = 1;
  return;
}

const beforeInventory = inspectInstallInventory(projectRoot, { runtime: 'codex' });
const machineLocalExcludes = ensureMachineLocalExcludes(projectRoot, { dryRun });

const steps = [];
const node = process.execPath;

if (!skipPluginRefresh) {
  steps.push(runStep({
    name: 'Refresh Citadel Codex plugin artifacts',
    command: node,
    args: [path.join(pluginRoot, 'scripts', 'codex-compat.js'), pluginRoot],
    cwd: pluginRoot,
    dryRun,
  }));
}

steps.push(runStep({
  name: 'Write and validate local Codex plugin marketplace',
  command: node,
    args: [path.join(pluginRoot, 'scripts', 'codex-plugin-smoke.js'), '--project-root', pluginRoot, '--plugin-path', './', '--write'],
  cwd: pluginRoot,
  dryRun,
}));

if (addMarketplace) {
  steps.push(runStep({
    name: 'Register Citadel marketplace with Codex CLI',
    command: 'codex',
    args: ['plugin', 'marketplace', 'add', pluginRoot],
    cwd: pluginRoot,
    dryRun,
    timeout: 30000,
  }));
}

if (installPlugin && steps.every((step) => step.pass || !step.required)) {
  steps.push(runStep({
    name: 'Install Citadel Harness plugin with Codex CLI',
    command: 'codex',
    args: ['plugin', 'add', 'citadel@citadel-local'],
    cwd: projectRoot,
    dryRun,
    timeout: 30000,
  }));
}

if (!pluginOnly && steps.every((step) => step.pass || !step.required)) {
  steps.push(runStep({
    name: 'Generate Codex project artifacts',
    command: node,
    args: [path.join(pluginRoot, 'scripts', 'codex-compat.js'), projectRoot],
    cwd: projectRoot,
    dryRun,
  }));

  steps.push(runStep({
    name: 'Verify Codex project readiness',
    command: node,
    args: [path.join(pluginRoot, 'scripts', 'codex-readiness-check.js'), '--project-root', projectRoot, '--write'],
    cwd: projectRoot,
    dryRun,
  }));

  if (process.platform === 'win32' && !skipWindowsCheck) {
    steps.push(runStep({
      name: 'Verify Codex Windows shell and sandbox settings',
      command: node,
      args: [path.join(pluginRoot, 'scripts', 'codex-windows-check.js'), '--project-root', projectRoot],
      cwd: projectRoot,
      dryRun,
    }));
  }
}

const pass = steps.every((step) => step.pass || !step.required);
const inventory = inspectInstallInventory(projectRoot, { runtime: 'codex' });
const outputs = classifyOutputs([
  ...(!pluginOnly ? [
    { path: '.mcp.json', runtime: 'codex', ownership: 'shared', reason: 'Project MCP choices are shared; the Citadel entry uses a relative delegate.' },
    { path: 'AGENTS.md', runtime: 'shared', ownership: 'shared', reason: 'Project guidance is shared and carries the canonical Citadel owner marker.' },
    { path: '.citadel/plugin-root.txt', runtime: 'codex', ownership: 'machine-local', reason: 'The delegate pointer identifies the local Citadel checkout.' },
  ] : []),
  { path: '.codex/config.toml', runtime: 'codex', ownership: 'machine-local' },
  { path: '.codex-plugin/plugin.json', runtime: 'codex', ownership: 'machine-local' },
  { path: '.agents/', runtime: 'codex', ownership: 'machine-local' },
]);
const report = {
  pluginRoot,
  projectRoot,
  mode: pluginOnly ? 'plugin-only' : 'plugin-and-project',
  dryRun,
  install,
  addMarketplace,
  installPlugin,
  generatedAt: new Date().toISOString(),
  steps,
  pass,
  beforeInventory,
  inventory,
  diagnostics: inventory.diagnostics,
  outputs,
  machineLocalExcludes,
  nextSteps: {
    codexApp: [
      'Open Codex and select the target project.',
      install ? 'Citadel Harness is installed; start a new local task so Codex loads it.' : 'Open Plugins, choose the Citadel Local Plugins marketplace, and select Add to Codex for Citadel Harness.',
      'Review and trust the Citadel hooks through /hooks when Codex asks.',
      'Run a real request such as /do review README.md; first-use state initializes automatically.',
    ],
    codexCli: [
      addMarketplace ? 'Run codex from the target project.' : `Run codex plugin marketplace add ${q(pluginRoot)} if you want CLI marketplace registration.`,
      installPlugin ? 'Citadel Harness is installed from citadel-local.' : 'Run codex plugin add citadel@citadel-local.',
      'Start a new task, review Citadel through /hooks, then run /do review README.md.',
    ],
  },
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

// Setting exitCode lets piped JSON flush completely on macOS. Calling
// process.exit() here can truncate stdout before the parent parses the report.
process.exitCode = pass ? 0 : 1;

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
    const status = step.pass ? 'PASS' : 'FAIL';
    const skipped = step.skipped ? ' (dry run)' : '';
    console.log(`[${status}] ${step.name}${skipped}`);
    console.log(`       ${step.command}`);
    if (!step.pass && step.stderr) console.log(step.stderr.trim());
  }
  console.log('');
  console.log(report.pass ? 'Install prep passed.' : 'Install prep failed.');
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
  --plugin-only             Prepare the Citadel plugin and marketplace only.
  --skip-plugin-refresh     Do not regenerate plugin-root Codex artifacts.
  --skip-windows-check      Skip Windows-specific Codex readiness check.
  --add-marketplace         Also run: codex plugin marketplace add <plugin-root>.
  --dry-run                 Print planned commands without writing files.
  --json                    Print machine-readable JSON only.

Common use:
  cd /path/to/your-project
  node /path/to/Citadel/scripts/codex-install.js --add-marketplace
`);
  process.exit(0);
}

const dryRun = has('--dry-run');
const jsonOnly = has('--json');
const pluginOnly = has('--plugin-only');
const skipPluginRefresh = has('--skip-plugin-refresh');
const skipWindowsCheck = has('--skip-windows-check');
const addMarketplace = has('--add-marketplace');
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
  process.exit(1);
}

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
  args: [path.join(pluginRoot, 'scripts', 'codex-plugin-smoke.js'), '--project-root', pluginRoot, '--write'],
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

if (!pluginOnly) {
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
const report = {
  pluginRoot,
  projectRoot,
  mode: pluginOnly ? 'plugin-only' : 'plugin-and-project',
  dryRun,
  addMarketplace,
  generatedAt: new Date().toISOString(),
  steps,
  pass,
  nextSteps: {
    codexApp: [
      'Open Codex and select the target project.',
      'Open Plugins, choose the Citadel Local Plugins marketplace, and select Add to Codex for Citadel Harness.',
      'Start a new local thread after installing or enabling the plugin.',
      'Run /do setup, or /do setup --express when you want the fastest project initialization.',
    ],
    codexCli: [
      addMarketplace ? 'Run codex from the target project.' : `Run codex plugin marketplace add ${q(pluginRoot)} if you want CLI marketplace registration.`,
      'Inside Codex CLI, run /plugins and install or enable Citadel Harness.',
      'Start a new thread and run /do setup.',
    ],
  },
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

process.exit(pass ? 0 : 1);

#!/usr/bin/env node

'use strict';

// Installs Citadel into a project for the opencode runtime.
//
// Much less work than the Codex installer, because opencode reads several Citadel
// surfaces natively:
//   guidance  AGENTS.md, rendered from .citadel/project.md, never overwriting an
//             existing one without --overwrite-guidance
//   skills    copied to .citadel/skills and referenced with a project-relative
//             path, so opencode.json remains portable across checkout moves
//   commands  derived from skills by opencode   (no projection — and an explicit
//             command file would SHADOW the live skill)
// So this writes the plugin stub, merges opencode.json, and projects agents.

const fs = require('fs');
const path = require('path');

const { installOpencodePlugin } = require('../runtimes/opencode/generators/install-plugin');
const { projectOpencodeAgents } = require('../runtimes/opencode/generators/project-agents');
const { projectOpencodeGuidance } = require('../runtimes/opencode/generators/project-guidance');
const {
  classifyOutputs,
  inspectInstallInventory,
} = require('../core/runtime/install-contract');

const CITADEL_ROOT = path.resolve(__dirname, '..');

const HELP = `Usage: node scripts/opencode-install.js [options]

Options:
  --project-root <dir>   Project to install into (default: cwd)
  --dry-run              Report every write without making it
  --skip-agents          Do not project agents into .opencode/agent
  --skip-skills          Do not add Citadel's skills directory to skills.paths
  --skip-guidance        Do not render AGENTS.md
  --overwrite-guidance   Replace an existing AGENTS.md (off by default)
  --json                 Machine-readable output
  -h, --help             Show this help
`;

function arg(argv, name, fallback = null) {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function has(argv, name) {
  return argv.includes(name);
}

function run(argv = process.argv.slice(2)) {
  if (has(argv, '--help') || has(argv, '-h')) return { help: true };

  const projectRoot = path.resolve(arg(argv, '--project-root', process.cwd()));
  const dryRun = has(argv, '--dry-run');

  if (!fs.existsSync(projectRoot)) {
    return { ok: false, error: `project root does not exist: ${projectRoot}` };
  }

  const steps = [];
  const before = inspectInstallInventory(projectRoot, { runtime: 'opencode' });
  const outputs = [];
  const plugin = installOpencodePlugin({
    citadelRoot: CITADEL_ROOT,
    projectRoot,
    dryRun,
    skipSkills: has(argv, '--skip-skills'),
  });
  steps.push({
    step: 'plugin',
    pluginPath: plugin.pluginPath,
    configPath: plugin.configPath,
    writes: plugin.writes,
    configChanges: plugin.changes,
    outputs: plugin.outputs,
    machineLocalExcludes: plugin.machineLocalExcludes,
  });
  outputs.push(...plugin.outputs);

  if (!has(argv, '--skip-agents')) {
    const agents = projectOpencodeAgents({ citadelRoot: CITADEL_ROOT, projectRoot, dryRun });
    steps.push({ step: 'agents', count: agents.length, targets: agents.map((item) => item.targetPath) });
    outputs.push(...agents.map((item) => ({
      path: path.relative(projectRoot, item.targetPath).replace(/\\/g, '/'),
      runtime: 'opencode',
      ownership: 'machine-local',
      reason: 'Generated agent projection used by OpenCode.',
    })));
  }

  if (!has(argv, '--skip-guidance')) {
    const guidance = projectOpencodeGuidance({
      citadelRoot: CITADEL_ROOT,
      projectRoot,
      dryRun,
      overwriteGuidance: has(argv, '--overwrite-guidance'),
    });
    steps.push({ step: 'guidance', ...guidance });
    if (guidance.written) {
      outputs.push({
        path: path.relative(projectRoot, guidance.filePath).replace(/\\/g, '/'),
        runtime: 'opencode',
        ownership: 'shared',
        content: dryRun ? '' : fs.readFileSync(guidance.filePath, 'utf8'),
        reason: 'Canonical project guidance shared by runtime projections.',
      });
    }
  }

  const inventory = inspectInstallInventory(projectRoot, { runtime: 'opencode' });
  const classifiedOutputs = classifyOutputs(outputs);

  return {
    ok: true,
    dryRun,
    projectRoot,
    citadelRoot: CITADEL_ROOT,
    steps,
    beforeInventory: before,
    inventory,
    diagnostics: inventory.diagnostics,
    outputs: classifiedOutputs,
    machineLocalExcludes: plugin.machineLocalExcludes,
    // Stated plainly so an operator is never left believing Citadel gates more
    // than it does on this runtime.
    degradations: [
      'stop-cannot-block: quality-gate findings are observational on opencode',
      'permission-gate-not-native: gating rides tool.execute.before, not permission.ask',
      'plugin-load-failure-fails-open: if opencode cannot load the plugin it continues with no Citadel hooks',
    ],
  };
}

function render(result) {
  const lines = [];
  lines.push(result.dryRun ? 'Citadel opencode install (dry run)' : 'Citadel opencode install');
  lines.push('='.repeat(40));
  lines.push(`project: ${result.projectRoot}`);
  lines.push(`citadel: ${result.citadelRoot}`);
  for (const step of result.steps) {
    if (step.step === 'plugin') {
      lines.push(`plugin:  ${step.pluginPath}`);
      lines.push(`config:  ${step.configPath}`);
      if (step.writes.length === 0) lines.push('         already up to date');
      for (const write of step.writes) {
        lines.push(`         ${write.action} ${write.path}${write.changes ? ` (${write.changes.join(', ')})` : ''}`);
      }
    }
    if (step.step === 'agents') lines.push(`agents:  ${step.count} projected into .opencode/agent`);
    if (step.step === 'guidance') {
      if (step.skipped) lines.push(`guidance: kept ${step.filePath} — ${step.reason}`);
      else if (step.dryRun) lines.push(`guidance: would ${step.action} ${step.filePath}`);
      else {
        lines.push(`guidance: wrote ${step.filePath}`);
        if (step.specCreated) lines.push(`          created ${step.specPath} — edit the spec, not AGENTS.md`);
      }
    }
  }
  if (result.diagnostics?.length) {
    lines.push('');
    lines.push('Diagnostics:');
    for (const diagnostic of result.diagnostics) lines.push(`  - ${diagnostic.message}`);
  }
  if (result.machineLocalExcludes?.written) {
    lines.push(`machine-local outputs protected by ${result.machineLocalExcludes.path}`);
  }
  lines.push('');
  lines.push('Project-local projections refreshed by this install:');
  lines.push("  skills    copied to .citadel/skills and referenced with a relative path");
  lines.push('  commands  derived from skills by opencode, so no command files');
  lines.push('');
  lines.push('Known degradations on this runtime:');
  for (const item of result.degradations) lines.push(`  - ${item}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const argv = process.argv.slice(2);
  const result = run(argv);

  if (result.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!result.ok) {
    process.stderr.write(`opencode-install: ${result.error}\n`);
    return 1;
  }
  process.stdout.write(has(argv, '--json') ? `${JSON.stringify(result, null, 2)}\n` : render(result));
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = Object.freeze({ HELP, main, render, run });

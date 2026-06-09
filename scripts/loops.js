#!/usr/bin/env node

'use strict';

const path = require('path');
const {
  listLoops,
  readLoop,
  registerLoop,
  stopLoop,
} = require('../core/loops/registry');
const { createLoopContract } = require('../core/loops/contract');
const { instantiateLoopTemplate, listLoopTemplates } = require('../core/loops/templates');
const { isTerminalStatus, stopSummary } = require('../core/loops/status');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function projectRoot() {
  return path.resolve(arg('--project-root', process.cwd()));
}

function usage() {
  return [
    'Usage:',
    '  node scripts/loops.js list [--active] [--json]',
    '  node scripts/loops.js inspect <id> [--json]',
    '  node scripts/loops.js templates [--json]',
    '  node scripts/loops.js plan --template <name> [--write] [--json]',
    '  node scripts/loops.js register --type <type> --title <title> --command <cmd> [--verify <cmd>] [--write] [--json]',
    '  node scripts/loops.js stop <id> [--status <status>] [--reason <text>] [--json]',
  ].join('\n');
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatLoop(loop) {
  const status = loop.status || 'planned';
  const terminal = isTerminalStatus(status) ? 'stopped' : 'active';
  const cadence = loop.trigger?.cadence ? ` | ${loop.trigger.cadence}` : '';
  const verifier = loop.verifier?.command || loop.verifier?.profile || 'none';
  return [
    `- ${loop.id} [${status}/${terminal}]`,
    `  Type: ${loop.type || 'loop'}${cadence}`,
    `  Title: ${loop.title || loop.id}`,
    `  Verifier: ${verifier}`,
    `  State: ${loop.statePath || '(unknown)'}`,
    `  Source: ${loop.source || 'loop-registry'}`,
  ].join('\n');
}

function renderList(loops) {
  if (!loops.length) return 'No Citadel loops found.\n';
  const active = loops.filter((loop) => !isTerminalStatus(loop.status));
  const stopped = loops.filter((loop) => isTerminalStatus(loop.status));
  const lines = [];
  lines.push(`Citadel loops (${loops.length})`);
  lines.push('');
  lines.push(`Active (${active.length})`);
  if (active.length) active.forEach((loop) => lines.push(formatLoop(loop)));
  else lines.push('  none');
  lines.push('');
  lines.push(`Stopped (${stopped.length})`);
  if (stopped.length) stopped.forEach((loop) => lines.push(formatLoop(loop)));
  else lines.push('  none');
  return `${lines.join('\n')}\n`;
}

function renderTemplates() {
  const lines = ['Loop templates', ''];
  for (const template of listLoopTemplates()) {
    lines.push(`- ${template.id}: ${template.title}`);
    lines.push(`  Type: ${template.type} | Trigger: ${template.triggerKind || 'manual'} | Attempts: ${template.maxAttempts || 1}`);
    lines.push(`  Goal: ${template.goal}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderInspect(loop) {
  if (!loop) return 'Loop not found.\n';
  return [
    `Loop: ${loop.id}`,
    `Status: ${loop.status} - ${stopSummary(loop.status)}`,
    `Type: ${loop.type}`,
    `Title: ${loop.title}`,
    `Trigger: ${loop.trigger?.kind || 'manual'}${loop.trigger?.cadence ? ` (${loop.trigger.cadence})` : ''}`,
    `Command: ${loop.trigger?.command || '(none)'}`,
    `Verifier: ${loop.verifier?.command || loop.verifier?.profile || '(none)'}`,
    `Budget: attempts=${loop.budget?.maxAttempts ?? 'n/a'} spend=${loop.budget?.maxSpend ?? 'n/a'}`,
    `Stop conditions: ${(loop.stopConditions || []).join(', ')}`,
    `State: ${loop.statePath || '(unknown)'}`,
    `Runs: ${(loop.runs || []).length}`,
    '',
  ].join('\n');
}

function contractFromArgs() {
  const template = arg('--template');
  const options = {
    id: arg('--id'),
    type: arg('--type', template ? undefined : 'loop'),
    title: arg('--title') || arg('--goal') || arg('--command'),
    goal: arg('--goal') || arg('--title') || arg('--command'),
    command: arg('--command'),
    verifierCommand: arg('--verify'),
    cadence: arg('--cadence'),
    triggerKind: arg('--trigger', arg('--cadence') ? 'scheduled' : 'manual'),
    scope: arg('--scope'),
    maxAttempts: Number(arg('--max-attempts', 1)),
    reviewArtifact: arg('--artifact'),
  };
  if (template) return instantiateLoopTemplate(template, options);
  return createLoopContract(options);
}

function main() {
  const mode = process.argv[2] || 'list';
  const root = projectRoot();
  const json = hasFlag('--json');

  if (mode === '--help' || mode === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (mode === 'list' || mode === 'status') {
    const loops = listLoops(root, { activeOnly: hasFlag('--active') });
    if (json) printJson(loops);
    else process.stdout.write(renderList(loops));
    return;
  }

  if (mode === 'inspect') {
    const id = process.argv[3];
    const loop = readLoop(root, id) || listLoops(root).find((item) => item.id === id);
    if (json) printJson(loop || null);
    else process.stdout.write(renderInspect(loop));
    process.exit(loop ? 0 : 1);
  }

  if (mode === 'templates') {
    const templates = listLoopTemplates();
    if (json) printJson(templates);
    else process.stdout.write(renderTemplates());
    return;
  }

  if (mode === 'plan' || mode === 'register') {
    const contract = contractFromArgs();
    const shouldWrite = hasFlag('--write') || mode === 'register';
    const result = shouldWrite ? registerLoop(root, contract) : contract;
    if (json) printJson(result);
    else {
      process.stdout.write(`${shouldWrite ? 'Loop registered' : 'Loop plan'}: ${result.id}\n`);
      process.stdout.write(`State: ${result.statePath}\n`);
      process.stdout.write(`Verifier: ${result.verifier.command || result.verifier.profile || '(none)'}\n`);
    }
    return;
  }

  if (mode === 'stop') {
    const id = process.argv[3];
    if (!id) {
      process.stderr.write('Missing loop id.\n');
      process.exit(1);
    }
    const result = stopLoop(root, id, arg('--status', 'stopped'), arg('--reason', 'user-stop'));
    if (json) printJson(result);
    else process.stdout.write(`Stopped ${id}: ${result.status}\n`);
    return;
  }

  process.stderr.write(`${usage()}\n`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = {
  renderInspect,
  renderList,
  renderTemplates,
};

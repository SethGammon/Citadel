#!/usr/bin/env node

'use strict';

const path = require('path');
const {
  listLoops,
  readLoop,
  registerLoop,
  registerRecovery,
  stopLoop,
} = require('../core/loops/registry');
const { createLoopContract } = require('../core/loops/contract');
const { instantiateLoopTemplate, listLoopTemplates } = require('../core/loops/templates');
const { isTerminalStatus, stopSummary } = require('../core/loops/status');
const { inspectRecovery, recoveryPlan } = require('../core/loops/recovery');
const { superviseLoop } = require('../core/loops/supervisor');

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
    '  node scripts/loops.js recover <id> --verify-only --expected-revision <n> [--write] [--json]',
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
  const recovery = loop.recoverySummary || inspectRecovery(loop);
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
    `Revision: ${recovery.sourceRevision}`,
    `Stop reason: ${recovery.stopReason || '(none)'}`,
    `Last run: ${recovery.lastRun?.runId || '(none)'} | attempt=${recovery.lastRun?.attempt ?? 'n/a'} | phase=${recovery.lastRun?.phase || '(none)'}`,
    `Observations: action=${recovery.actionObservation} verifier=${recovery.verifierObservation}`,
    `Effect outcome: ${recovery.effectOutcome}`,
    `Remaining budget: attempts=${recovery.remainingAttempts} duration-ms=${recovery.remainingDurationMs ?? 'unbounded'}`,
    `Deadline: ${recovery.deadlineAt || '(none)'}`,
    `Cleanup: ${recovery.cleanupErrors.join('; ') || 'no recorded error; this does not establish quiescence'}`,
    `Quiescence: ${recovery.quiescence?.kind || 'unproven'}`,
    `Recovery: ${recovery.decision} (${recovery.reason})`,
    recovery.authorization,
    ...(recovery.nextCommand ? [`Preview: ${recovery.nextCommand}`] : []),
    '',
  ].join('\n');
}

function contractFromArgs() {
  const template = arg('--template');
  const options = {};
  const set = (key, value) => {
    if (value !== null && value !== undefined && value !== '') options[key] = value;
  };

  set('id', arg('--id'));
  set('type', arg('--type', template ? null : 'loop'));
  set('title', arg('--title') || arg('--goal') || arg('--command'));
  set('goal', arg('--goal') || arg('--title') || arg('--command'));
  set('command', arg('--command'));
  set('verifierCommand', arg('--verify'));
  set('cadence', arg('--cadence'));
  set('triggerKind', arg('--trigger', arg('--cadence') ? 'scheduled' : 'manual'));
  set('scope', arg('--scope'));
  set('reviewArtifact', arg('--artifact'));
  const maxAttempts = arg('--max-attempts');
  if (maxAttempts !== null) options.maxAttempts = Number(maxAttempts);

  if (template) return instantiateLoopTemplate(template, options);
  return createLoopContract(options);
}

function parseRecoveryArgs(args) {
  const [id, ...flags] = args;
  if (!id || id.startsWith('--')) throw new Error('Missing loop id.');
  const result = { id, write: false, json: false, root: process.cwd() };
  const seen = new Set();
  for (let i = 0; i < flags.length; i++) {
    const token = flags[i];
    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    if (!['--verify-only', '--expected-revision', '--write', '--json', '--project-root'].includes(name)) {
      throw new Error(`Unsupported recovery argument: ${name}`);
    }
    if (seen.has(name)) throw new Error(`Duplicate recovery argument: ${name}`);
    seen.add(name);
    if (['--verify-only', '--write', '--json'].includes(name)) {
      if (equals !== -1) throw new Error(`Flag does not take a value: ${name}`);
      if (name === '--write') result.write = true;
      if (name === '--json') result.json = true;
    } else {
      const value = equals === -1 ? flags[++i] : token.slice(equals + 1);
      if (!value || value.startsWith('--')) throw new Error(`Missing value: ${name}`);
      if (name === '--project-root') result.root = path.resolve(value);
      else {
        if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
          throw new Error('--expected-revision must be a non-negative safe integer');
        }
        result.expectedRevision = Number(value);
      }
    }
  }
  if (!seen.has('--verify-only') || !seen.has('--expected-revision')) {
    throw new Error('Recovery requires --verify-only and --expected-revision.');
  }
  return result;
}

async function recover(args) {
  const options = parseRecoveryArgs(args);
  const source = readLoop(options.root, options.id);
  if (!source) throw new Error(`Loop not found: ${options.id}`);
  const plan = recoveryPlan(source, options.expectedRevision);
  if (!options.write) {
    const existing = readLoop(options.root, plan.child.id);
    const result = { ...plan, existingChild: existing ? { id: existing.id, status: existing.status } : null, writes: false };
    if (options.json) printJson(result);
    else {
      process.stdout.write(`Verification follow-up plan: ${plan.child.id}\n`);
      process.stdout.write(`Source: ${source.id} revision ${source.revision}\nVerifier: ${plan.child.verifier.command}\n`);
      process.stdout.write(`Budget: one invocation, ${plan.child.budget.commandTimeoutMs} ms\n`);
      process.stdout.write(`${plan.recoverySummary.authorization}\n`);
      process.stdout.write(existing ? `Already admitted: ${existing.id}; inspection only, no retry.\n`
        : 'Pass --write to authorize this exact new invocation. Original action and history remain unchanged.\n');
    }
    return;
  }
  const child = registerRecovery(options.root, options.id, options.expectedRevision);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let result;
  try { result = await superviseLoop(options.root, child.id, { signal: controller.signal }); }
  finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  if (options.json) printJson(result);
  else process.stdout.write(`Verification follow-up: ${result.id}\nStatus: ${result.status}\nSource unchanged: ${source.id}\n`);
  const cleanupError = result.cleanupError || result.runs?.at(-1)?.verifierResult?.cleanupError;
  if (cleanupError) process.stderr.write(`Command cleanup failed: ${cleanupError}\n`);
  process.exitCode = result.verified ? 0 : 1;
}

async function main() {
  const mode = process.argv[2] || 'list';
  if (mode === 'recover') return recover(process.argv.slice(3));
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
    if (json) printJson(loop ? { ...loop, recoverySummary: inspectRecovery(loop) } : null);
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

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
  process.exitCode = 1;
});

module.exports = {
  renderInspect,
  renderList,
  renderTemplates,
  parseRecoveryArgs,
};

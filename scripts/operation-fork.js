#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const forks = require('../core/forks');

const HELP = `Usage: citadel fork <command> [options]

Commands:
  start OBJECTIVE [--workflow FILE] [--id ID] [--executors FILE | --runtimes claude,codex]
  resume ID
  status ID
  compare ID
  select ID --branch BRANCH --expected-revision N --idempotency-key KEY
  land plan ID
  land apply ID --expected-revision N --target-revision SHA --confirm TOKEN --idempotency-key KEY
  replay ID [--output FILE]
  proof ID [--output FILE]

start creates contained worktrees and executes every executor unless --no-execute
is passed. --executors selects strict model and provider profiles (see
docs/EXECUTOR_PROFILES.md); --runtimes remains the legacy form. The two are
mutually exclusive. Selection records intent only. Landing requires a fresh plan
token.
`;

function has(args, flag) { return args.includes(flag); }
function value(args, flag, fallback = null) {
  const inline = args.find((item) => item.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}
function positional(args) {
  const values = [];
  const takesValue = new Set(['--workflow', '--id', '--runtimes', '--executors', '--project-root', '--worktree-root',
    '--branch', '--expected-revision', '--idempotency-key', '--actor', '--reason', '--target-revision',
    '--confirm', '--output']);
  for (let index = 0; index < args.length; index += 1) {
    if (takesValue.has(args[index])) { index += 1; continue; }
    if (args[index].startsWith('--')) continue;
    values.push(args[index]);
  }
  return values;
}
function projectRoot(args) { return path.resolve(value(args, '--project-root', process.cwd())); }
function write(valueToWrite) { process.stdout.write(`${JSON.stringify(valueToWrite, null, 2)}\n`); }
function safeId(input) {
  const normalized = String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  if (!normalized || !/^[a-z]/.test(normalized)) return `fork-${Date.now()}`;
  return normalized.startsWith('fork-') ? normalized : `fork-${normalized}`;
}
function readWorkflow(file) {
  if (!file) return {
    id: 'operation-fork-default',
    steps: [{ id: 'step-execute' }, { id: 'step-verify' }],
    verifier: { command: 'git', args: ['diff', '--check'] },
  };
  const workflow = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!workflow || !Array.isArray(workflow.steps) || workflow.steps.length === 0
    || workflow.steps.some((step) => !step || typeof step.id !== 'string')
    || !workflow.verifier || typeof workflow.verifier.command !== 'string'
    || !Array.isArray(workflow.verifier.args)) throw new TypeError('Workflow must contain steps and a verifier command with args');
  return workflow;
}
function readExecutors(file) {
  if (!file) return undefined;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (error) {
    throw Object.assign(new Error(`Executor file is unreadable: ${error.message}`), { code: 'FORK_EXECUTORS_UNREADABLE' });
  }
  return forks.assertValidExecutorFile(parsed);
}

function main(args = process.argv.slice(2)) {
  if (!args.length || has(args, '--help') || has(args, '-h')) { process.stdout.write(HELP); return 0; }
  const command = args[0];
  const rest = args.slice(1);
  const root = projectRoot(rest);
  if (command === 'start') {
    const objective = positional(rest)[0];
    if (!objective) throw Object.assign(new Error('start requires an objective'), { code: 'FORK_OBJECTIVE_REQUIRED' });
    const executorFile = value(rest, '--executors');
    const runtimeFlag = value(rest, '--runtimes');
    if (executorFile && runtimeFlag) {
      throw Object.assign(new TypeError('--executors and --runtimes are mutually exclusive'), {
        code: 'FORK_EXECUTOR_SELECTION_CONFLICT',
      });
    }
    const workflow = readWorkflow(value(rest, '--workflow'));
    const forkId = safeId(value(rest, '--id', objective));
    const executors = readExecutors(executorFile);
    const runtimes = executors ? undefined
      : String(runtimeFlag || 'claude,codex').split(',').map((item) => item.trim()).filter(Boolean);
    const result = forks.startFork({ projectRoot: root, forkId, objective, title: objective, workflow,
      executors, runtimes, worktreeRoot: value(rest, '--worktree-root'), execute: !has(rest, '--no-execute') });
    write({ ok: true, command: 'fork start', fork: result.fork, comparison: result.comparison });
    return 0;
  }
  if (command === 'resume') {
    const forkId = positional(rest)[0];
    const workflowFile = value(rest, '--workflow');
    const result = forks.resumeFork({ projectRoot: root, forkId,
      workflow: workflowFile ? readWorkflow(workflowFile) : undefined,
      worktreeRoot: value(rest, '--worktree-root') });
    write({ ok: true, command: 'fork resume', fork: result.fork, comparison: result.comparison });
    return 0;
  }
  if (command === 'status') {
    const fork = forks.loadFork(root, positional(rest)[0]);
    const evidence = forks.forkEvidence(root, fork);
    write({ ok: true, command: 'fork status', fork,
      comparison: forks.compareFork(fork, { evidence }),
      executors: forks.executorStates(root, fork) });
    return 0;
  }
  if (command === 'compare') {
    const fork = forks.loadFork(root, positional(rest)[0]);
    const evidence = forks.forkEvidence(root, fork);
    write({ ok: true, command: 'fork compare',
      comparison: forks.compareFork(fork, { evidence }),
      executors: forks.executorStates(root, fork) });
    return 0;
  }
  if (command === 'select') {
    const selected = forks.applySelection({ projectRoot: root, forkId: positional(rest)[0],
      branchId: value(rest, '--branch'), expectedRevision: Number(value(rest, '--expected-revision')),
      actorId: value(rest, '--actor', 'actor-operator'), idempotencyKey: value(rest, '--idempotency-key'),
      reason: value(rest, '--reason', '') });
    write({ ok: true, command: 'fork select', fork: selected });
    return 0;
  }
  if (command === 'land') {
    const action = rest[0];
    const forkId = positional(rest.slice(1))[0];
    const current = forks.loadFork(root, forkId);
    const provider = forks.createGitWorktreeProvider();
    if (action === 'plan') {
      const targetRevision = provider.currentRevision(root);
      write({ ok: true, command: 'fork land plan', fork_id: forkId, fork_revision: current.revision,
        target_revision: targetRevision, target_clean: provider.isClean(root),
        confirmation: forks.landingConfirmation(current, targetRevision),
        next: 'Re-run with land apply and the exact revision and confirmation token.' });
      return 0;
    }
    if (action !== 'apply') throw new TypeError('land requires plan or apply');
    const landed = forks.applyLanding({ projectRoot: root, forkId,
      expectedRevision: Number(value(rest, '--expected-revision')),
      targetRevision: value(rest, '--target-revision'), confirmation: value(rest, '--confirm'),
      idempotencyKey: value(rest, '--idempotency-key') });
    write({ ok: true, command: 'fork land apply', fork: landed });
    return 0;
  }
  if (command === 'replay') {
    const forkId = positional(rest)[0];
    const fork = forks.loadFork(root, forkId);
    const replay = forks.publicReplay(fork, forks.readEvents(root, forkId),
      { evidence: forks.forkEvidence(root, fork) });
    const output = value(rest, '--output');
    if (output) {
      const target = path.resolve(output);
      fs.writeFileSync(target, `${JSON.stringify(replay.replay, null, 2)}\n`);
      write({ ok: true, command: 'fork replay', output: target, digest: replay.digest });
    } else write({ ok: true, command: 'fork replay', digest: replay.digest, replay: replay.replay });
    return 0;
  }
  if (command === 'proof') {
    const forkId = positional(rest)[0];
    const fork = forks.loadFork(root, forkId);
    const proof = forks.buildProofReport(fork, forks.readEvents(root, forkId),
      { evidence: forks.forkEvidence(root, fork) });
    const output = value(rest, '--output');
    if (output) {
      const target = path.resolve(output);
      fs.writeFileSync(target, `${JSON.stringify(proof.report, null, 2)}\n`);
      write({ ok: true, command: 'fork proof', output: target, digest: proof.digest });
    } else write({ ok: true, command: 'fork proof', digest: proof.digest, report: proof.report });
    return 0;
  }
  throw Object.assign(new Error(`Unknown fork command: ${command}`), { code: 'FORK_COMMAND_UNKNOWN' });
}

if (require.main === module) {
  try { process.exit(main()); } catch (error) {
    process.stderr.write(`citadel fork: ${error.message} [${error.code || 'FORK_COMMAND_FAILED'}]\n`);
    process.exit(error.code === 'FORK_COMMAND_UNKNOWN' ? 64 : 1);
  }
}

module.exports = Object.freeze({ HELP, main, readExecutors, readWorkflow, safeId });

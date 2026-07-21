#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  canonicalSerialize,
  completeGraphNodeEffect,
  createGraphProtocolProof,
  planGraphExecutionRecovery,
  readGraphRunJournal,
  resolveGraphNodeEffect,
  startGraphNodeEffect,
} = require('../core/operations');
const { resolveProjectPath } = require('./operation-graph-runner');

const COMMANDS = Object.freeze(['status', 'start', 'complete', 'resolve', 'receipt']);
const VALUE_FLAGS = new Set([
  '--project-root', '--graph', '--journal', '--effects', '--operation', '--receipt',
  '--node', '--payload-digest', '--evidence-digest', '--resolution', '--issuer', '--now',
]);

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!COMMANDS.includes(command)) {
    throw new Error('command must be status, start, complete, resolve, or receipt');
  }
  const options = { command };
  while (args.length) {
    const flag = args.shift();
    if (!VALUE_FLAGS.has(flag)) throw new Error('unknown option: ' + flag);
    if (!args.length || args[0].startsWith('--')) throw new Error('missing value for ' + flag);
    const key = flag.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (key in options) throw new Error('duplicate option: ' + flag);
    options[key] = args.shift();
  }
  return options;
}

function loadJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    throw new Error(label + ' must contain valid JSON');
  }
}

function loadContext(options) {
  const projectRoot = options.projectRoot || process.cwd();
  const graphPath = resolveProjectPath(projectRoot, options.graph, 'graph', {
    mustExist: true,
    mustBeFile: true,
  });
  const journalDir = resolveProjectPath(projectRoot, options.journal, 'journal');
  const effectJournalDir = resolveProjectPath(projectRoot, options.effects, 'effects');
  const graph = loadJson(graphPath, 'graph');
  let run = null;
  if (options.command !== 'status') {
    const graphJournal = readGraphRunJournal(journalDir, graph);
    if (!graphJournal.latest_run) throw new Error('graph run is not initialized');
    run = graphJournal.latest_run;
  }
  return Object.freeze({
    projectRoot: fs.realpathSync(path.resolve(projectRoot)),
    graph,
    journalDir,
    effectJournalDir,
    run,
  });
}

function writeNewJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target),
    '.' + path.basename(target) + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, canonicalSerialize(value) + '\n', 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.existsSync(target)) throw new Error('receipt already exists');
    fs.renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function resultSummary(command, outcome) {
  return Object.freeze({
    status: outcome.status,
    command,
    reason_code: outcome.reason_code,
    execution: outcome.execution,
    run_id: outcome.run.run_id,
    graph_id: outcome.run.graph_id,
    run_status: outcome.run.status,
    node_id: outcome.binding.node.node_id,
    attempt_id: outcome.binding.attempt_id,
    idempotency_key: outcome.binding.idempotency_key,
    transition_count: outcome.run.scheduler_state.transition_count,
    total_attempts: outcome.run.scheduler_state.total_attempts,
  });
}

function requireNodeEffectFlags(options) {
  if (!options.node) throw new Error('node is required');
  if (!options.payloadDigest) throw new Error('payload-digest is required');
}

function execute(options) {
  const context = loadContext(options);
  if (options.command === 'status') {
    const recovery = planGraphExecutionRecovery(
      context.journalDir, context.effectJournalDir, context.graph);
    return Object.freeze({
      status: recovery.status,
      command: 'status',
      reason_code: recovery.reason_code,
      run_id: recovery.run && recovery.run.run_id,
      graph_id: context.graph.graph_id,
      run_status: recovery.run && recovery.run.status,
      actions: recovery.actions,
    });
  }
  if (options.command === 'receipt') {
    if (!options.operation || !options.receipt || !options.issuer) {
      throw new Error('operation, receipt, and issuer are required');
    }
    const operationPath = resolveProjectPath(
      context.projectRoot, options.operation, 'operation', { mustExist: true, mustBeFile: true });
    const receiptPath = resolveProjectPath(context.projectRoot, options.receipt, 'receipt');
    const proof = createGraphProtocolProof({
      graph: context.graph,
      run: context.run,
      operation: loadJson(operationPath, 'operation'),
      effectJournalDir: context.effectJournalDir,
      issuedAt: options.now || new Date().toISOString(),
      issuerId: options.issuer,
    });
    writeNewJson(receiptPath, proof);
    return Object.freeze({
      status: 'ok',
      command: 'receipt',
      reason_code: 'GRAPH_PROTOCOL_PROOF_WRITTEN',
      run_id: context.run.run_id,
      graph_id: context.graph.graph_id,
      receipt_status: proof.receipt_envelope.receipt.status,
      receipt_id: proof.receipt_envelope.receipt.receipt_id,
      evidence_count: proof.evidence.length,
    });
  }

  requireNodeEffectFlags(options);
  const common = {
    graph: context.graph,
    run: context.run,
    graphJournalDir: context.journalDir,
    effectJournalDir: context.effectJournalDir,
    nodeId: options.node,
    payloadDigest: options.payloadDigest,
    now: options.now,
  };
  if (options.command === 'start') {
    return resultSummary('start', startGraphNodeEffect(common));
  }
  if (options.command === 'complete') {
    if (!options.evidenceDigest) throw new Error('evidence-digest is required');
    return resultSummary('complete', completeGraphNodeEffect({
      ...common,
      evidenceDigest: options.evidenceDigest,
    }));
  }
  if (!options.resolution) throw new Error('resolution is required');
  return resultSummary('resolve', resolveGraphNodeEffect({
    ...common,
    resolution: options.resolution,
    evidenceDigest: options.evidenceDigest,
  }));
}

function main(argv = process.argv.slice(2)) {
  try {
    process.stdout.write(JSON.stringify(execute(parseArgs(argv))) + '\n');
    return 0;
  } catch (error) {
    process.stderr.write(JSON.stringify({
      status: 'blocked',
      reason_code: error.code || 'GRAPH_EFFECT_RUNNER_ERROR',
      message: error.message,
    }) + '\n');
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ execute, main, parseArgs });

#!/usr/bin/env node

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {
  appendGraphRunSnapshot,
  createGraphRun,
  createResearchFleetBundle,
  decideGraphRunEdge,
  evaluateGraph,
  planGraphRunRecovery,
  readGraphRunJournal,
  transitionGraphRun,
} = require('../core/operations');

const COMMANDS = Object.freeze(['init', 'research-init', 'status', 'transition', 'decide']);
const VALUE_FLAGS = new Set([
  '--project-root', '--graph', '--journal', '--run-id', '--node', '--status',
  '--edge', '--selected', '--now', '--angles', '--operation',
]);

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!COMMANDS.includes(command)) throw new Error('command must be init, research-init, status, transition, or decide');
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

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function assertNoSymlinkSegments(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('path cannot contain symbolic links');
  }
}

function resolveProjectPath(projectRoot, input, label, options = {}) {
  if (typeof input !== 'string' || input.length === 0) throw new Error(label + ' is required');
  const root = fs.realpathSync(path.resolve(projectRoot));
  const target = path.resolve(root, input);
  if (!isInside(root, target) || (!options.allowRoot && target === root)) {
    throw new Error(label + ' must stay inside project root');
  }
  assertNoSymlinkSegments(root, target);
  if (options.mustExist && !fs.existsSync(target)) throw new Error(label + ' does not exist');
  if (options.mustBeFile && (!fs.existsSync(target) || !fs.statSync(target).isFile())) {
    throw new Error(label + ' must be a file');
  }
  if (fs.existsSync(target)) {
    const realTarget = fs.realpathSync(target);
    if (!isInside(root, realTarget)) throw new Error(label + ' resolves outside project root');
  }
  return target;
}


function writeNewGraphFile(graphPath, graph) {
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  const temporary = path.join(path.dirname(graphPath),
    '.' + path.basename(graphPath) + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify(graph, null, 2) + '\n', 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.existsSync(graphPath)) throw new Error('graph already exists');
    fs.renameSync(temporary, graphPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}
function loadContext(options) {
  const projectRoot = options.projectRoot || process.cwd();
  const graphPath = resolveProjectPath(projectRoot, options.graph, 'graph', { mustExist: true, mustBeFile: true });
  const journalDir = resolveProjectPath(projectRoot, options.journal, 'journal');
  let graph;
  try { graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')); }
  catch (_error) { throw new Error('graph must contain valid JSON'); }
  return { projectRoot: fs.realpathSync(path.resolve(projectRoot)), graphPath, journalDir, graph };
}

function latestRun(context) {
  const journal = readGraphRunJournal(context.journalDir, context.graph);
  if (!journal.latest_run) throw new Error('graph run is not initialized');
  return journal.latest_run;
}

function runSummary(context, run, extra = {}) {
  const evaluation = evaluateGraph(context.graph, run.scheduler_state);
  return Object.freeze({
    status: 'ok',
    command: extra.command,
    reason_code: extra.reason_code || null,
    run_id: run.run_id,
    graph_id: run.graph_id,
    run_status: run.status,
    ready_node_ids: evaluation.ready_node_ids,
    deferred_ready_node_ids: evaluation.deferred_ready_node_ids,
    waiting_node_ids: evaluation.waiting_node_ids,
    blocked_nodes: evaluation.blocked_nodes,
    running_node_ids: evaluation.running_node_ids,
    traversal_token_count: run.traversal_tokens.length,
    transition_count: run.scheduler_state.transition_count,
    total_attempts: run.scheduler_state.total_attempts,
  });
}

function execute(options) {
  if (options.command === 'research-init') {
    if (!options.runId) throw new Error('run-id is required for research-init');
    if (!options.angles) throw new Error('angles is required for research-init');
    if (!options.operation) throw new Error('operation is required for research-init');
    const projectRoot = options.projectRoot || process.cwd();
    const graphPath = resolveProjectPath(projectRoot, options.graph, 'graph');
    const operationPath = resolveProjectPath(projectRoot, options.operation, 'operation');
    const journalDir = resolveProjectPath(projectRoot, options.journal, 'journal');
    if (fs.existsSync(graphPath)) throw new Error('graph already exists');
    if (fs.existsSync(operationPath)) throw new Error('operation already exists');
    const angleIds = options.angles.split(',').map((value) => value.trim()).filter(Boolean);
    const { graph, operation } = createResearchFleetBundle(angleIds, { now: options.now });
    const context = {
      projectRoot: fs.realpathSync(path.resolve(projectRoot)), graphPath, journalDir, graph,
    };
    try {
      writeNewGraphFile(graphPath, graph);
      writeNewGraphFile(operationPath, operation);
      const run = createGraphRun(graph, options.runId, { now: options.now });
      appendGraphRunSnapshot(journalDir, graph, run, 'initialized');
      return Object.freeze({
        ...runSummary(context, run, { command: 'research-init' }),
        operation_id: operation.operation_id,
      });
    } catch (error) {
      fs.rmSync(graphPath, { force: true });
      fs.rmSync(operationPath, { force: true });
      throw error;
    }
  }
  const context = loadContext(options);
  if (options.command === 'init') {
    if (!options.runId) throw new Error('run-id is required for init');
    const run = createGraphRun(context.graph, options.runId, { now: options.now });
    appendGraphRunSnapshot(context.journalDir, context.graph, run, 'initialized');
    return runSummary(context, run, { command: 'init' });
  }
  if (options.command === 'status') {
    const recovery = planGraphRunRecovery(context.journalDir, context.graph);
    if (!recovery.run) return Object.freeze({
      status: recovery.status,
      command: 'status',
      reason_code: recovery.reason_code,
      journal_status: recovery.journal_status,
      run_id: null,
      graph_id: context.graph.graph_id,
      in_flight_node_ids: recovery.in_flight_node_ids,
    });
    return Object.freeze({
      ...runSummary(context, recovery.run, { command: 'status', reason_code: recovery.reason_code }),
      recovery_status: recovery.status,
      journal_status: recovery.journal_status,
      in_flight_node_ids: recovery.in_flight_node_ids,
    });
  }
  const current = latestRun(context);
  if (options.runId && options.runId !== current.run_id) throw new Error('run-id does not match journal');
  if (options.command === 'transition') {
    if (!options.node || !options.status) throw new Error('node and status are required for transition');
    const run = transitionGraphRun(context.graph, current, options.node, options.status, { now: options.now });
    appendGraphRunSnapshot(context.journalDir, context.graph, run, 'node_transition');
    return runSummary(context, run, { command: 'transition' });
  }
  if (!options.edge || !['true', 'false'].includes(options.selected)) {
    throw new Error('edge and selected=true|false are required for decide');
  }
  const run = decideGraphRunEdge(context.graph, current, options.edge, options.selected === 'true', { now: options.now });
  appendGraphRunSnapshot(context.journalDir, context.graph, run, 'edge_decision');
  return runSummary(context, run, { command: 'decide' });
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = execute(parseArgs(argv));
    process.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  } catch (error) {
    process.stderr.write(JSON.stringify({
      status: 'blocked',
      reason_code: 'GRAPH_RUNNER_ERROR',
      message: error.message,
    }) + '\n');
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({
  execute,
  main,
  parseArgs,
  resolveProjectPath,
});

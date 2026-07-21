#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = path.join(__dirname, 'operation-graph-runner.js');
const fixture = path.join(__dirname, '..', 'core', 'operations', 'fixtures', 'research-fleet.graph.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-graph-runner-'));

function invoke(args) {
  return JSON.parse(execFileSync(process.execPath, [runner, ...args], {
    cwd: root, encoding: 'utf8',
  }));
}

try {
  fs.copyFileSync(fixture, path.join(root, 'graph.json'));
  const common = ['--project-root', root, '--graph', 'graph.json', '--journal', '.planning/graph-run'];
  const initialized = invoke([
    'init', ...common, '--run-id', 'run-cli-proof', '--now', '2026-07-21T13:00:00.000Z',
  ]);
  assert.equal(initialized.status, 'ok');
  assert.equal(initialized.run_status, 'pending');
  assert.deepEqual(initialized.ready_node_ids, ['scope']);
  assert.equal(initialized.traversal_token_count, 1);

  const initialStatus = invoke(['status', ...common]);
  assert.equal(initialStatus.recovery_status, 'ready');
  assert.equal(initialStatus.reason_code, 'GRAPH_RUN_RESUMABLE');

  const running = invoke([
    'transition', ...common, '--node', 'scope', '--status', 'running',
    '--now', '2026-07-21T13:00:01.000Z',
  ]);
  assert.equal(running.run_status, 'running');
  const inFlight = invoke(['status', ...common]);
  assert.equal(inFlight.recovery_status, 'blocked');
  assert.equal(inFlight.reason_code, 'IN_FLIGHT_NODE_REQUIRES_EFFECT_RECOVERY');
  assert.deepEqual(inFlight.in_flight_node_ids, ['scope']);

  const passed = invoke([
    'transition', ...common, '--node', 'scope', '--status', 'passed',
    '--now', '2026-07-21T13:00:02.000Z',
  ]);
  assert.equal(passed.run_status, 'pending');
  assert.deepEqual(passed.ready_node_ids, ['scout-claims', 'scout-taxonomy', 'scout-fit']);
  assert.equal(passed.traversal_token_count, 4);

  const duplicate = spawnSync(process.execPath, [runner,
    'init', ...common, '--run-id', 'run-cli-proof', '--now', '2026-07-21T13:00:03.000Z',
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(duplicate.status, 0);
  assert.equal(JSON.parse(duplicate.stderr).reason_code, 'GRAPH_RUNNER_ERROR');

  const escaped = spawnSync(process.execPath, [runner,
    'init', '--project-root', root, '--graph', '..' + path.sep + 'outside.json',
    '--journal', '.planning/escape', '--run-id', 'run-escape',
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(escaped.status, 0);
  assert(JSON.parse(escaped.stderr).message.includes('inside project root'));

  const conditional = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const edge = conditional.edges.find((item) => item.edge_id === 'scope-to-claims');
  edge.edge_kind = 'conditional';
  edge.condition_digest = 'sha256:' + 'f'.repeat(64);
  fs.writeFileSync(path.join(root, 'conditional.json'), JSON.stringify(conditional));
  const conditionalCommon = [
    '--project-root', root, '--graph', 'conditional.json', '--journal', '.planning/conditional-run',
  ];
  invoke(['init', ...conditionalCommon, '--run-id', 'run-conditional', '--now', '2026-07-21T14:00:00.000Z']);
  invoke(['transition', ...conditionalCommon, '--node', 'scope', '--status', 'running', '--now', '2026-07-21T14:00:01.000Z']);
  invoke(['transition', ...conditionalCommon, '--node', 'scope', '--status', 'passed', '--now', '2026-07-21T14:00:02.000Z']);
  const decided = invoke([
    'decide', ...conditionalCommon, '--edge', 'scope-to-claims', '--selected', 'true',
    '--now', '2026-07-21T14:00:03.000Z',
  ]);
  assert(decided.ready_node_ids.includes('scout-claims'));
  assert.equal(decided.traversal_token_count, 4);

  const researchGraph = '.planning/research/fleet-proof/operation-graph.json';
  const researchOperation = '.planning/research/fleet-proof/operation-spec.json';
  const researchJournal = '.planning/research/fleet-proof/graph-journal';
  const researchInitialized = invoke([
    'research-init', '--project-root', root, '--graph', researchGraph, '--journal', researchJournal,
    '--operation', researchOperation,
    '--run-id', 'run-research-generated', '--angles', 'performance,migration,health,ecosystem',
    '--now', '2026-07-21T15:00:00.000Z',
  ]);
  assert.equal(researchInitialized.command, 'research-init');
  assert.deepEqual(researchInitialized.ready_node_ids, ['scope']);
  const generated = JSON.parse(fs.readFileSync(path.join(root, researchGraph), 'utf8'));
  const generatedOperation = JSON.parse(fs.readFileSync(path.join(root, researchOperation), 'utf8'));
  assert.equal(generated.operation_spec_digest, require('../core/operations').sha256Digest(generatedOperation));
  assert.deepEqual(generated.nodes.filter((node) => node.node_kind === 'agent'
    && node.executor_profile === 'research-scout').map((node) => node.node_id),
  ['scout-performance', 'scout-migration', 'scout-health', 'scout-ecosystem']);
  assert.equal(generated.joins[0].policy, 'all');
  assert.equal(generated.limits.max_parallel, 4);
  const generatedRaw = fs.readFileSync(path.join(root, researchGraph), 'utf8');
  assert(!generatedRaw.includes('question'));
  assert(!generatedRaw.includes('prompt'));
  assert(!fs.readdirSync(path.dirname(path.join(root, researchGraph)))
    .some((name) => name.endsWith('.tmp')), 'successful graph creation should leave no temporary debris');
  const researchStatus = invoke([
    'status', '--project-root', root, '--graph', researchGraph, '--journal', researchJournal,
  ]);
  assert.equal(researchStatus.recovery_status, 'ready');
  assert.equal(researchStatus.traversal_token_count, 1);

  const invalidResearchGraph = '.planning/research/invalid/operation-graph.json';
  const invalidResearchOperation = '.planning/research/invalid/operation-spec.json';
  const invalidResearch = spawnSync(process.execPath, [runner,
    'research-init', '--project-root', root, '--graph', invalidResearchGraph,
    '--journal', '.planning/research/invalid/graph-journal', '--operation', invalidResearchOperation,
    '--run-id', 'run-invalid-research',
    '--angles', 'only,two', '--now', '2026-07-21T15:01:00.000Z',
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalidResearch.status, 0);
  assert(!fs.existsSync(path.join(root, invalidResearchGraph)), 'failed initialization should not leave a graph');
  assert(!fs.existsSync(path.join(root, invalidResearchOperation)),
    'failed initialization should not leave an operation');

  console.log('operation graph runner tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

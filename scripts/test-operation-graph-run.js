#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const operations = require('../core/operations');

const graph = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'core', 'operations', 'fixtures', 'research-fleet.graph.json'), 'utf8'));
const times = Array.from({ length: 32 }, (_, index) =>
  new Date(Date.parse('2026-07-21T12:00:00.000Z') + index * 1000).toISOString());
const runSchema = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'packages', 'contracts', 'schemas', 'operation-graph-run-v0.1.json'), 'utf8'));
const journalSchema = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'packages', 'contracts', 'schemas', 'operation-graph-journal-v0.1.json'), 'utf8'));
assert.deepEqual(runSchema.required.slice().sort(), [...operations.RUN_FIELDS].sort());
assert.deepEqual(journalSchema.required.slice().sort(), [...operations.GRAPH_JOURNAL_FIELDS].sort());
assert.equal(runSchema.additionalProperties, false);
assert.equal(journalSchema.additionalProperties, false);
assert.equal(journalSchema.properties.run_snapshot.$ref, 'operation-graph-run-v0.1.json');


let run = operations.createGraphRun(graph, 'run-research-proof', { now: times[0] });
assert.deepEqual(operations.validateGraphRun(graph, run), []);
assert.equal(run.status, 'pending');
assert.deepEqual(run.traversal_tokens.map((token) => token.token_id), ['token-scope-1']);
assert.deepEqual(run.traversal_tokens[0].parent_token_ids, []);

run = operations.transitionGraphRun(graph, run, 'scope', 'running', { now: times[1] });
assert.equal(run.status, 'running');
run = operations.transitionGraphRun(graph, run, 'scope', 'passed', { now: times[2] });
assert.equal(run.status, 'pending');
assert.deepEqual(run.traversal_tokens.slice(1).map((token) => token.node_id),
  ['scout-claims', 'scout-taxonomy', 'scout-fit']);
assert(run.traversal_tokens.slice(1).every((token) =>
  token.parent_token_ids[0] === 'token-scope-1'));

let clock = 3;
for (const nodeId of ['scout-claims', 'scout-taxonomy', 'scout-fit']) {
  run = operations.transitionGraphRun(graph, run, nodeId, 'running', { now: times[clock++] });
}
for (const nodeId of ['scout-claims', 'scout-taxonomy', 'scout-fit']) {
  run = operations.transitionGraphRun(graph, run, nodeId, 'passed', { now: times[clock++] });
}
const reduceToken = run.traversal_tokens.find((token) => token.node_id === 'reduce');
assert.deepEqual(reduceToken.parent_token_ids, [
  'token-scout-claims-1', 'token-scout-taxonomy-1', 'token-scout-fit-1',
], 'barrier token should preserve every satisfied parent');
assert.deepEqual(reduceToken.via_edge_ids, [
  'claims-to-reduce', 'taxonomy-to-reduce', 'fit-to-reduce',
]);

const tokenTamper = JSON.parse(JSON.stringify(run));
tokenTamper.traversal_tokens.find((token) => token.node_id === 'reduce').parent_token_ids.push('token-missing-1');
assert(operations.validateGraphRun(graph, tokenTamper).some((error) => error.includes('parent token does not exist')));
const statusTamper = JSON.parse(JSON.stringify(run));
statusTamper.status = 'passed';
assert(operations.validateGraphRun(graph, statusTamper).includes('run status does not match scheduler state'));
const missingReadyToken = JSON.parse(JSON.stringify(run));
missingReadyToken.traversal_tokens = missingReadyToken.traversal_tokens.filter((token) => token.node_id !== 'reduce');
assert(operations.validateGraphRun(graph, missingReadyToken).includes('ready node is missing a traversal token: reduce'));
const malformedParents = JSON.parse(JSON.stringify(run));
malformedParents.traversal_tokens.find((token) => token.node_id === 'reduce').parent_token_ids = {};
assert.doesNotThrow(() => operations.validateGraphRun(graph, malformedParents));
assert(operations.validateGraphRun(graph, malformedParents).includes('parent_token_ids must be a unique array'));
const fakeLineage = JSON.parse(JSON.stringify(run));
fakeLineage.traversal_tokens.find((token) => token.node_id === 'reduce').parent_token_ids = ['token-scope-1'];
assert(operations.validateGraphRun(graph, fakeLineage).includes('parent tokens must match traversal edges'));
const malformedState = JSON.parse(JSON.stringify(run));
delete malformedState.scheduler_state.node_statuses.reduce;
assert.doesNotThrow(() => operations.validateGraphRun(graph, malformedState));
assert(operations.validateGraphRun(graph, malformedState).some((error) => error.includes('node_statuses keys')));


for (const nodeId of ['reduce', 'synthesize', 'arbiter']) {
  run = operations.transitionGraphRun(graph, run, nodeId, 'running', { now: times[clock++] });
  run = operations.transitionGraphRun(graph, run, nodeId, 'passed', { now: times[clock++] });
}
assert.equal(run.status, 'passed');
assert.equal(run.traversal_tokens.length, graph.nodes.length);
assert(Object.values(run.scheduler_state.node_statuses).every((status) => status === 'passed'));
const loopGraph = JSON.parse(JSON.stringify(graph));
for (const nodeId of ['synthesize', 'arbiter']) {
  loopGraph.nodes.find((node) => node.node_id === nodeId).max_visits = 2;
}
loopGraph.edges.push({
  edge_id: 'arbiter-to-synthesize',
  from_node_id: 'arbiter',
  to_node_id: 'synthesize',
  edge_kind: 'loop',
  condition_digest: 'sha256:' + 'f'.repeat(64),
  data_contract_digest: 'sha256:' + 'e'.repeat(64),
});
let loopRun = operations.createGraphRun(loopGraph, 'run-loop-proof', { now: times[0] });
let loopClock = 1;
while (operations.evaluateGraph(loopGraph, loopRun.scheduler_state).ready_node_ids.length) {
  const ready = operations.evaluateGraph(loopGraph, loopRun.scheduler_state).ready_node_ids;
  for (const nodeId of ready) loopRun = operations.transitionGraphRun(
    loopGraph, loopRun, nodeId, 'running', { now: times[loopClock++] });
  for (const nodeId of ready) loopRun = operations.transitionGraphRun(
    loopGraph, loopRun, nodeId, 'passed', { now: times[loopClock++] });
}
assert.equal(loopRun.status, 'pending', 'a terminal cycle source must await its loop decision');
loopRun = operations.decideGraphRunEdge(
  loopGraph, loopRun, 'arbiter-to-synthesize', true, { now: times[loopClock++] });
const secondSynthesis = loopRun.traversal_tokens.find((token) => token.token_id === 'token-synthesize-2');
assert(secondSynthesis.parent_token_ids.includes('token-arbiter-1'));
assert(secondSynthesis.parent_token_ids.includes('token-reduce-1'));
for (const nodeId of ['synthesize', 'arbiter']) {
  loopRun = operations.transitionGraphRun(loopGraph, loopRun, nodeId, 'running', { now: times[loopClock++] });
  loopRun = operations.transitionGraphRun(loopGraph, loopRun, nodeId, 'passed', { now: times[loopClock++] });
}
assert.equal(loopRun.status, 'pending');
loopRun = operations.decideGraphRunEdge(
  loopGraph, loopRun, 'arbiter-to-synthesize', false, { now: times[loopClock++] });
assert.equal(loopRun.status, 'passed');
assert.equal(loopRun.traversal_tokens.length, loopGraph.nodes.length + 2);
assert.deepEqual(operations.validateGraphRun(loopGraph, loopRun), []);


const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-graph-run-'));
try {
  let journalRun = operations.createGraphRun(graph, 'run-journal-proof', { now: times[0] });
  operations.appendGraphRunSnapshot(journalDir, graph, journalRun, 'initialized');
  journalRun = operations.transitionGraphRun(graph, journalRun, 'scope', 'running', { now: times[1] });
  operations.appendGraphRunSnapshot(journalDir, graph, journalRun, 'node_transition');

  let journal = operations.readGraphRunJournal(journalDir, graph);
  assert.equal(journal.entries.length, 2);
  assert.equal(journal.entries[1].previous_hash, journal.entries[0].entry_hash);
  assert.equal(journal.latest_run.scheduler_state.node_statuses.scope, 'running');
  const inFlight = operations.planGraphRunRecovery(journalDir, graph);
  assert.equal(inFlight.status, 'blocked');
  assert.equal(inFlight.reason_code, 'IN_FLIGHT_NODE_REQUIRES_EFFECT_RECOVERY');
  assert.deepEqual(inFlight.in_flight_node_ids, ['scope']);

  journalRun = operations.transitionGraphRun(graph, journalRun, 'scope', 'passed', { now: times[2] });
  operations.appendGraphRunSnapshot(journalDir, graph, journalRun, 'node_transition');
  const resumable = operations.planGraphRunRecovery(journalDir, graph);
  assert.equal(resumable.status, 'ready');
  assert.equal(resumable.reason_code, 'GRAPH_RUN_RESUMABLE');
  assert.deepEqual(resumable.run.traversal_tokens.slice(1).map((token) => token.node_id),
    ['scout-claims', 'scout-taxonomy', 'scout-fit']);

  fs.writeFileSync(path.join(journalDir, '.00000004.json.crash.tmp'), '{partial');
  journal = operations.readGraphRunJournal(journalDir, graph);
  assert.equal(journal.entries.length, 3, 'temporary debris should be ignored');

  const raw = fs.readFileSync(path.join(journalDir, '00000003.json'), 'utf8');
  assert(!raw.includes('prompt'));
  assert(!raw.includes('artifact_body'));
  const tampered = JSON.parse(raw);
  tampered.run_snapshot.status = 'passed';
  fs.writeFileSync(path.join(journalDir, '00000003.json'), JSON.stringify(tampered));
  assert.throws(() => operations.readGraphRunJournal(journalDir, graph), operations.GraphJournalCorruptionError);
  const corrupt = operations.planGraphRunRecovery(journalDir, graph);
  assert.equal(corrupt.status, 'blocked');
  assert.equal(corrupt.reason_code, 'GRAPH_JOURNAL_CORRUPT');
} finally {
  fs.rmSync(journalDir, { recursive: true, force: true });
}

console.log('operation graph run tests passed');

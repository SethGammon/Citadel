#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const operations = require('../core/operations');
const publicContracts = require('../packages/contracts');

const fixturePath = path.join(__dirname, '..', 'core', 'operations', 'fixtures', 'research-fleet.graph.json');
const tracePath = path.join(__dirname, '..', 'core', 'operations', 'fixtures', 'research-fleet.trace.json');
const schemaPath = path.join(__dirname, '..', 'packages', 'contracts', 'schemas', 'operation-graph-v0.1.json');
const graph = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const golden = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

assert.deepEqual(operations.validateOperationGraph(graph), [], 'Research Fleet graph should validate');
assert.equal(publicContracts.operations.GRAPH_VERSION, '0.1', 'graph contract should be public');
assert.equal(publicContracts.operations.createGraphState, operations.createGraphState, 'scheduler should be public');
assert.deepEqual(
  schema.required.slice().sort(),
  ['graph_version', 'kind', 'graph_id', 'operation_spec_digest', 'entry_node_ids', 'nodes', 'edges', 'joins', 'limits', 'created_at'].sort(),
  'schema should preserve the runtime top-level allowlist',
);
assert.equal(schema.additionalProperties, false, 'graph schema should reject unknown top-level fields');

const withPrivateData = JSON.parse(JSON.stringify(graph));
withPrivateData.customer_prompt = 'must never enter the control-plane envelope';
assert(
  operations.validateOperationGraph(withPrivateData).some((error) => error.includes('allowlist')),
  'unknown graph fields should fail closed',
);

const withImplicitCycle = JSON.parse(JSON.stringify(graph));
withImplicitCycle.edges.push({
  edge_id: 'arbiter-to-scope',
  from_node_id: 'arbiter',
  to_node_id: 'scope',
  edge_kind: 'success',
  condition_digest: null,
  data_contract_digest: 'sha256:' + 'e'.repeat(64),
});
assert(
  operations.validateOperationGraph(withImplicitCycle).includes('cycles must be expressed only with loop edges'),
  'implicit cycles should be rejected',
);

const withUnboundedLoop = JSON.parse(JSON.stringify(graph));
withUnboundedLoop.edges.push({
  edge_id: 'arbiter-to-synthesize',
  from_node_id: 'arbiter',
  to_node_id: 'synthesize',
  edge_kind: 'loop',
  condition_digest: 'sha256:' + 'f'.repeat(64),
  data_contract_digest: 'sha256:' + 'e'.repeat(64),
});
assert(
  operations.validateOperationGraph(withUnboundedLoop).some((error) => error.includes('loop target must allow at least two visits')),
  'loop targets should require an explicit visit bound greater than one',
);

const withPartiallyBoundedLoop = JSON.parse(JSON.stringify(withUnboundedLoop));
withPartiallyBoundedLoop.nodes.find((node) => node.node_id === 'synthesize').max_visits = 2;
assert(operations.validateOperationGraph(withPartiallyBoundedLoop)
  .some((error) => error.includes('loop cycle node must allow at least two visits: arbiter')));


const withBoundedLoop = JSON.parse(JSON.stringify(withUnboundedLoop));
for (const nodeId of ['synthesize', 'arbiter']) {
  withBoundedLoop.nodes.find((node) => node.node_id === nodeId).max_visits = 2;
}
assert.deepEqual(operations.validateOperationGraph(withBoundedLoop), [], 'bounded loop should be contract-valid');
let loopState = operations.createGraphState(withBoundedLoop);
for (const batch of golden.ready_batches) {
  for (const nodeId of batch) loopState = operations.transitionNode(withBoundedLoop, loopState, nodeId, 'running');
  for (const nodeId of batch) loopState = operations.transitionNode(withBoundedLoop, loopState, nodeId, 'passed');
}
assert.deepEqual(operations.evaluateGraph(withBoundedLoop, loopState).awaiting_loop_decision_edge_ids,
  ['arbiter-to-synthesize']);
loopState = operations.recordEdgeDecision(withBoundedLoop, loopState, 'arbiter-to-synthesize', true);
assert.equal(loopState.node_statuses.synthesize, 'pending');
assert.equal(loopState.node_statuses.arbiter, 'pending');
assert.equal(loopState.node_statuses.reduce, 'passed', 'nodes outside the cycle region must not reset');
for (const nodeId of ['synthesize', 'arbiter']) {
  loopState = operations.transitionNode(withBoundedLoop, loopState, nodeId, 'running');
  loopState = operations.transitionNode(withBoundedLoop, loopState, nodeId, 'passed');
}
assert.deepEqual(operations.evaluateGraph(withBoundedLoop, loopState).awaiting_loop_decision_edge_ids,
  ['arbiter-to-synthesize']);
loopState = operations.recordEdgeDecision(withBoundedLoop, loopState, 'arbiter-to-synthesize', false);
assert.equal(operations.evaluateGraph(withBoundedLoop, loopState).complete, true);
assert.deepEqual([loopState.visit_counts.synthesize, loopState.visit_counts.arbiter], [2, 2]);
assert.throws(() => operations.recordEdgeDecision(withBoundedLoop, loopState, 'arbiter-to-synthesize', true),
  /already decided/, 'one loop decision is allowed per source visit');
let state = operations.createGraphState(graph);
const observedBatches = [];
for (const expectedBatch of golden.ready_batches) {
  const evaluation = operations.evaluateGraph(graph, state);
  observedBatches.push([...evaluation.ready_node_ids]);
  assert.deepEqual(evaluation.ready_node_ids, expectedBatch, 'scheduler should follow the golden batch order');
  for (const nodeId of expectedBatch) state = operations.transitionNode(graph, state, nodeId, 'running');
  for (const nodeId of expectedBatch) state = operations.transitionNode(graph, state, nodeId, 'passed');
}
assert.deepEqual(observedBatches, golden.ready_batches, 'ready batches should be deterministic');
const completed = operations.evaluateGraph(graph, state);
assert.equal(completed.complete, true, 'golden graph should finish');
assert.equal(state.transition_count, golden.final_transition_count, 'transition count should match the trace');
assert.equal(state.total_attempts, golden.final_total_attempts, 'attempt count should match the trace');
assert(Object.values(state.node_statuses).every((status) => status === golden.final_status));

let barrierState = operations.createGraphState(graph);
barrierState = operations.transitionNode(graph, barrierState, 'scope', 'running');
barrierState = operations.transitionNode(graph, barrierState, 'scope', 'passed');
for (const nodeId of ['scout-claims', 'scout-taxonomy']) {
  barrierState = operations.transitionNode(graph, barrierState, nodeId, 'running');
  barrierState = operations.transitionNode(graph, barrierState, nodeId, 'passed');
}
const beforeBarrier = operations.evaluateGraph(graph, barrierState);
assert(beforeBarrier.waiting_node_ids.includes('reduce'), 'all-join should wait for the final scout');
assert.deepEqual(beforeBarrier.ready_node_ids, ['scout-fit'], 'remaining scout should be the only ready node');

let blockedState = operations.transitionNode(graph, barrierState, 'scout-fit', 'running');
blockedState = operations.transitionNode(graph, blockedState, 'scout-fit', 'failed');
const blockedEvaluation = operations.evaluateGraph(graph, blockedState);
assert.deepEqual(blockedEvaluation.blocked_nodes, [{
  node_id: 'reduce',
  status: 'blocked',
  reason: 'join cannot reach all threshold',
}], 'failed required input should fail the barrier closed');

let retryState = operations.createGraphState(graph);
retryState = operations.transitionNode(graph, retryState, 'scope', 'running');
retryState = operations.transitionNode(graph, retryState, 'scope', 'blocked');
retryState = operations.transitionNode(graph, retryState, 'scope', 'running');
retryState = operations.transitionNode(graph, retryState, 'scope', 'blocked');
assert.throws(
  () => operations.transitionNode(graph, retryState, 'scope', 'running'),
  /attempt limit exceeded/,
  'node retries should be bounded independently of visits',
);

const conditionalGraph = JSON.parse(JSON.stringify(graph));
const conditionalEdge = conditionalGraph.edges.find((edge) => edge.edge_id === 'scope-to-claims');
conditionalEdge.edge_kind = 'conditional';
conditionalEdge.condition_digest = 'sha256:' + 'f'.repeat(64);
assert.deepEqual(operations.validateOperationGraph(conditionalGraph), [], 'conditional graph should validate');
let conditionalState = operations.createGraphState(conditionalGraph);
conditionalState = operations.transitionNode(conditionalGraph, conditionalState, 'scope', 'running');
conditionalState = operations.transitionNode(conditionalGraph, conditionalState, 'scope', 'passed');
const beforeDecision = operations.evaluateGraph(conditionalGraph, conditionalState);
assert(beforeDecision.waiting_node_ids.includes('scout-claims'), 'conditional target should wait for a route decision');
const selectedState = operations.recordEdgeDecision(conditionalGraph, conditionalState, 'scope-to-claims', true);
assert(operations.evaluateGraph(conditionalGraph, selectedState).ready_node_ids.includes('scout-claims'));
const unselectedState = operations.recordEdgeDecision(conditionalGraph, conditionalState, 'scope-to-claims', false);
assert(operations.evaluateGraph(conditionalGraph, unselectedState).blocked_nodes.some((item) => item.node_id === 'scout-claims'));

const cappedGraph = JSON.parse(JSON.stringify(graph));
cappedGraph.limits.max_parallel = 2;
let cappedState = operations.createGraphState(cappedGraph);
cappedState = operations.transitionNode(cappedGraph, cappedState, 'scope', 'running');
cappedState = operations.transitionNode(cappedGraph, cappedState, 'scope', 'passed');
const cappedEvaluation = operations.evaluateGraph(cappedGraph, cappedState);
assert.deepEqual(cappedEvaluation.ready_node_ids, ['scout-claims', 'scout-taxonomy']);
assert.deepEqual(cappedEvaluation.deferred_ready_node_ids, ['scout-fit']);

const transitionLimitedGraph = JSON.parse(JSON.stringify(graph));
transitionLimitedGraph.limits.max_transitions = 1;
let transitionLimitedState = operations.createGraphState(transitionLimitedGraph);
transitionLimitedState = operations.transitionNode(transitionLimitedGraph, transitionLimitedState, 'scope', 'running');
assert.throws(
  () => operations.transitionNode(transitionLimitedGraph, transitionLimitedState, 'scope', 'passed'),
  /transition limit exceeded/,
  'graph transitions should stop at the declared limit',
);

const resumed = JSON.parse(JSON.stringify(state));
assert.doesNotThrow(() => operations.assertValidGraphState(graph, resumed), 'serialized graph state should resume safely');
const tamperedResume = JSON.parse(JSON.stringify(resumed));
tamperedResume.total_attempts += 1;
assert.throws(() => operations.assertValidGraphState(graph, tamperedResume), /sum of node attempt counts/,
  'resume should reject inconsistent aggregate counters');

console.log('operation graph tests passed');

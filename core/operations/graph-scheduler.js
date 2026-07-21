'use strict';

const { EXECUTION_STATUSES, TERMINAL_STATUSES } = require('./constants');
const { assertValidOperationGraph } = require('./graph-contract');
const { validateStatusTransition } = require('./transitions');

const STATE_VERSION = '0.1';
const STATE_FIELDS = Object.freeze([
  'state_version', 'graph_id', 'node_statuses', 'visit_counts', 'attempt_counts',
  'edge_decisions', 'loop_decision_visits', 'transition_count', 'total_attempts',
]);

function cloneRecord(value) {
  return Object.assign(Object.create(null), value);
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function assertExecutableGraph(graph) {
  assertValidOperationGraph(graph);
  return graph;
}

function assertValidGraphState(graph, state) {
  const errors = [];
  if (!exactKeys(state, STATE_FIELDS)) throw new Error('graph state fields must exactly match the allowlist');
  if (state.state_version !== STATE_VERSION) errors.push('state_version must be ' + STATE_VERSION);
  if (state.graph_id !== graph.graph_id) errors.push('state graph_id does not match graph');
  const nodeIds = graph.nodes.map((node) => node.node_id);
  for (const field of ['node_statuses', 'visit_counts', 'attempt_counts']) {
    if (!exactKeys(state[field], nodeIds)) errors.push(field + ' keys must exactly match graph nodes');
  }
  if (errors.length === 0) {
    for (const nodeId of nodeIds) {
      if (!EXECUTION_STATUSES.includes(state.node_statuses[nodeId])) errors.push('invalid node status: ' + nodeId);
      if (!Number.isInteger(state.visit_counts[nodeId]) || state.visit_counts[nodeId] < 0) errors.push('invalid visit count: ' + nodeId);
      if (!Number.isInteger(state.attempt_counts[nodeId]) || state.attempt_counts[nodeId] < 0) errors.push('invalid attempt count: ' + nodeId);
      const node = graph.nodes.find((item) => item.node_id === nodeId);
      if (state.visit_counts[nodeId] > node.max_visits) errors.push('visit limit exceeded: ' + nodeId);
      if (state.attempt_counts[nodeId] > node.max_attempts) errors.push('attempt limit exceeded: ' + nodeId);
    }
  }
  if (!state.edge_decisions || typeof state.edge_decisions !== 'object' || Array.isArray(state.edge_decisions)) {
    errors.push('edge_decisions must be an object');
  } else {
    const decisionEdges = new Map(graph.edges.filter((edge) => edge.edge_kind === 'conditional' || edge.edge_kind === 'loop').map((edge) => [edge.edge_id, edge]));
    for (const [edgeId, selected] of Object.entries(state.edge_decisions)) {
      if (!decisionEdges.has(edgeId)) errors.push('edge decision does not reference a conditional or loop edge: ' + edgeId);
      if (typeof selected !== 'boolean') errors.push('edge decision must be boolean: ' + edgeId);
    }
  }
  if (!state.loop_decision_visits || typeof state.loop_decision_visits !== 'object'
      || Array.isArray(state.loop_decision_visits)) {
    errors.push('loop_decision_visits must be an object');
  } else {
    const loopEdges = new Map(graph.edges.filter((edge) => edge.edge_kind === 'loop')
      .map((edge) => [edge.edge_id, edge]));
    for (const [edgeId, visit] of Object.entries(state.loop_decision_visits)) {
      const edge = loopEdges.get(edgeId);
      if (!edge) errors.push('loop decision visit does not reference a loop edge: ' + edgeId);
      if (!Number.isInteger(visit) || visit < 1) {
        errors.push('loop decision visit must be a positive integer: ' + edgeId);
      }
      if (edge && Number.isInteger(visit) && visit > state.visit_counts[edge.from_node_id]) {
        errors.push('loop decision visit exceeds its source visit: ' + edgeId);
      }
      if (!Object.prototype.hasOwnProperty.call(state.edge_decisions, edgeId)) {
        errors.push('loop decision visit requires an edge decision: ' + edgeId);
      }
    }
    for (const edge of graph.edges.filter((item) => item.edge_kind === 'loop')) {
      if (Object.prototype.hasOwnProperty.call(state.edge_decisions, edge.edge_id)
          && !Object.prototype.hasOwnProperty.call(state.loop_decision_visits, edge.edge_id)) {
        errors.push('loop edge decision requires a source visit: ' + edge.edge_id);
      }
    }
  }
  if (!Number.isInteger(state.transition_count) || state.transition_count < 0) errors.push('transition_count must be a non-negative integer');
  if (!Number.isInteger(state.total_attempts) || state.total_attempts < 0) errors.push('total_attempts must be a non-negative integer');
  if (Number.isInteger(state.total_attempts) && exactKeys(state.attempt_counts, nodeIds)
      && Object.values(state.attempt_counts).reduce((sum, count) => sum + count, 0) !== state.total_attempts) {
    errors.push('total_attempts must equal the sum of node attempt counts');
  }
  if (exactKeys(state.node_statuses, nodeIds)
      && Object.values(state.node_statuses).filter((status) => status === 'running').length > graph.limits.max_parallel) {
    errors.push('parallelism limit exceeded');
  }
  if (state.transition_count > graph.limits.max_transitions) errors.push('transition limit exceeded');
  if (state.total_attempts > graph.limits.max_total_attempts) errors.push('attempt limit exceeded');
  if (errors.length) throw new Error('invalid graph state: ' + errors.join('; '));
  return state;
}

function createGraphState(graph) {
  assertExecutableGraph(graph);
  const nodeStatuses = Object.create(null);
  const visitCounts = Object.create(null);
  const attemptCounts = Object.create(null);
  for (const node of graph.nodes) {
    nodeStatuses[node.node_id] = 'pending';
    visitCounts[node.node_id] = 0;
    attemptCounts[node.node_id] = 0;
  }
  return Object.freeze({
    state_version: STATE_VERSION,
    graph_id: graph.graph_id,
    node_statuses: Object.freeze(nodeStatuses),
    visit_counts: Object.freeze(visitCounts),
    attempt_counts: Object.freeze(attemptCounts),
    edge_decisions: Object.freeze(Object.create(null)),
    loop_decision_visits: Object.freeze(Object.create(null)),
    transition_count: 0,
    total_attempts: 0,
  });
}

function classifyEdge(edge, state) {
  const sourceStatus = state.node_statuses[edge.from_node_id];
  if (edge.edge_kind === 'success') {
    if (sourceStatus === 'passed') return 'satisfied';
    return TERMINAL_STATUSES.includes(sourceStatus) ? 'inactive' : 'waiting';
  }
  if (edge.edge_kind === 'failure') {
    if (TERMINAL_STATUSES.includes(sourceStatus) && sourceStatus !== 'passed') return 'satisfied';
    return sourceStatus === 'passed' ? 'inactive' : 'waiting';
  }
  if (sourceStatus !== 'passed') return TERMINAL_STATUSES.includes(sourceStatus) ? 'inactive' : 'waiting';
  if (edge.edge_kind === 'loop'
      && state.loop_decision_visits[edge.edge_id] !== state.visit_counts[edge.from_node_id]) return 'waiting';
  if (!Object.prototype.hasOwnProperty.call(state.edge_decisions, edge.edge_id)) return 'waiting';
  return state.edge_decisions[edge.edge_id] ? 'satisfied' : 'inactive';
}
function loopCycleRegion(graph, edge) {
  const nonLoop = graph.edges.filter((item) => item.edge_kind !== 'loop');
  const forward = new Set([edge.to_node_id]);
  const queue = [edge.to_node_id];
  while (queue.length) {
    const current = queue.shift();
    for (const candidate of nonLoop.filter((item) => item.from_node_id === current)) {
      if (!forward.has(candidate.to_node_id)) {
        forward.add(candidate.to_node_id);
        queue.push(candidate.to_node_id);
      }
    }
  }
  const reverse = new Set([edge.from_node_id]);
  const reverseQueue = [edge.from_node_id];
  while (reverseQueue.length) {
    const current = reverseQueue.shift();
    for (const candidate of nonLoop.filter((item) => item.to_node_id === current)) {
      if (!reverse.has(candidate.from_node_id)) {
        reverse.add(candidate.from_node_id);
        reverseQueue.push(candidate.from_node_id);
      }
    }
  }
  return graph.nodes.map((node) => node.node_id)
    .filter((nodeId) => forward.has(nodeId) && reverse.has(nodeId));
}


function joinDisposition(incoming, join, state) {
  const classifications = incoming.map((edge) => classifyEdge(edge, state));
  const satisfied = classifications.filter((value) => value === 'satisfied').length;
  const waiting = classifications.filter((value) => value === 'waiting').length;
  const policy = join ? join.policy : 'first_success';
  const threshold = policy === 'all' ? incoming.length : policy === 'quorum' ? join.threshold : 1;
  if (satisfied >= threshold) return Object.freeze({ status: 'ready', classifications });
  if (satisfied + waiting < threshold) {
    return Object.freeze({
      status: 'blocked',
      classifications,
      missing_input_status: join ? join.missing_input_status : 'blocked',
      reason: 'join cannot reach ' + policy + ' threshold',
    });
  }
  return Object.freeze({ status: 'waiting', classifications });
}

function evaluateGraph(graph, state) {
  assertValidOperationGraph(graph);
  assertValidGraphState(graph, state);
  const entryIds = new Set(graph.entry_node_ids);
  const ready = [];
  const waiting = [];
  const blocked = [];
  const running = [];
  const terminal = [];
  const awaitingLoopDecisions = graph.edges.filter((edge) => edge.edge_kind === 'loop'
    && state.node_statuses[edge.from_node_id] === 'passed'
    && state.loop_decision_visits[edge.edge_id] !== state.visit_counts[edge.from_node_id])
    .map((edge) => edge.edge_id);

  for (const node of graph.nodes) {
    const nodeId = node.node_id;
    const status = state.node_statuses[nodeId];
    if (status === 'running') { running.push(nodeId); continue; }
    if (TERMINAL_STATUSES.includes(status)) { terminal.push(nodeId); continue; }
    const incoming = graph.edges.filter((edge) => edge.to_node_id === nodeId && edge.edge_kind !== 'loop');
    if (entryIds.has(nodeId) && incoming.length === 0) { ready.push(nodeId); continue; }
    const join = graph.joins.find((item) => item.node_id === nodeId);
    const disposition = joinDisposition(incoming, join, state);
    if (disposition.status === 'ready') ready.push(nodeId);
    else if (disposition.status === 'blocked') blocked.push(Object.freeze({
      node_id: nodeId, status: disposition.missing_input_status, reason: disposition.reason,
    }));
    else waiting.push(nodeId);
  }

  const capacity = Math.max(0, graph.limits.max_parallel - running.length);
  return Object.freeze({
    ready_node_ids: Object.freeze(ready.slice(0, capacity)),
    deferred_ready_node_ids: Object.freeze(ready.slice(capacity)),
    waiting_node_ids: Object.freeze(waiting),
    blocked_nodes: Object.freeze(blocked),
    running_node_ids: Object.freeze(running),
    terminal_node_ids: Object.freeze(terminal),
    awaiting_loop_decision_edge_ids: Object.freeze(awaitingLoopDecisions),
    complete: terminal.length === graph.nodes.length && awaitingLoopDecisions.length === 0,
  });
}

function recordEdgeDecision(graph, state, edgeId, selected) {
  assertValidOperationGraph(graph);
  assertValidGraphState(graph, state);
  const edge = graph.edges.find((item) => item.edge_id === edgeId);
  if (!edge || (edge.edge_kind !== 'conditional' && edge.edge_kind !== 'loop')) {
    throw new Error('edge decisions are only valid for conditional or loop edges');
  }
  if (typeof selected !== 'boolean') throw new Error('edge decision must be boolean');
  if (state.node_statuses[edge.from_node_id] !== 'passed') throw new Error('edge source must pass before a decision is recorded');
  const decisions = cloneRecord(state.edge_decisions);
  const loopDecisionVisits = cloneRecord(state.loop_decision_visits);
  if (edge.edge_kind === 'loop'
      && loopDecisionVisits[edgeId] === state.visit_counts[edge.from_node_id]) {
    throw new Error('loop edge is already decided for this source visit');
  }
  decisions[edgeId] = selected;
  if (edge.edge_kind !== 'loop') {
    return Object.freeze(Object.assign({}, state, { edge_decisions: Object.freeze(decisions) }));
  }
  if (state.transition_count + 1 > graph.limits.max_transitions) throw new Error('graph transition limit exceeded');
  const sourceVisit = state.visit_counts[edge.from_node_id];
  if (sourceVisit < 1) throw new Error('loop source has not been visited');
  loopDecisionVisits[edgeId] = sourceVisit;
  if (!selected) {
    return Object.freeze(Object.assign({}, state, {
      edge_decisions: Object.freeze(decisions),
      loop_decision_visits: Object.freeze(loopDecisionVisits),
      transition_count: state.transition_count + 1,
    }));
  }
  const region = loopCycleRegion(graph, edge);
  if (!region.length || !region.includes(edge.from_node_id) || !region.includes(edge.to_node_id)) {
    throw new Error('loop edge does not close a non-loop cycle');
  }
  for (const nodeId of region) {
    if (!TERMINAL_STATUSES.includes(state.node_statuses[nodeId])) {
      throw new Error('loop cycle region must be terminal before reset: ' + nodeId);
    }
    const node = graph.nodes.find((item) => item.node_id === nodeId);
    if (state.visit_counts[nodeId] >= node.max_visits) {
      throw new Error('node visit limit exceeded: ' + nodeId);
    }
  }
  const statuses = cloneRecord(state.node_statuses);
  for (const nodeId of region) statuses[nodeId] = 'pending';
  for (const candidate of graph.edges) {
    if (candidate.edge_kind === 'conditional' && region.includes(candidate.from_node_id)) {
      delete decisions[candidate.edge_id];
    }
  }
  return Object.freeze(Object.assign({}, state, {
    node_statuses: Object.freeze(statuses),
    edge_decisions: Object.freeze(decisions),
    loop_decision_visits: Object.freeze(loopDecisionVisits),
    transition_count: state.transition_count + 1,
  }));
}

function transitionNode(graph, state, nodeId, toStatus) {
  assertValidOperationGraph(graph);
  assertValidGraphState(graph, state);
  const node = graph.nodes.find((item) => item.node_id === nodeId);
  if (!node) throw new Error('unknown graph node: ' + nodeId);
  const fromStatus = state.node_statuses[nodeId];
  const transitionErrors = validateStatusTransition(fromStatus, toStatus);
  if (transitionErrors.length) throw new Error(transitionErrors.join('; '));
  if (state.transition_count + 1 > graph.limits.max_transitions) throw new Error('graph transition limit exceeded');

  let totalAttempts = state.total_attempts;
  const attempts = cloneRecord(state.attempt_counts);
  const visits = cloneRecord(state.visit_counts);
  if (toStatus === 'running') {
    if (fromStatus === 'blocked' && attempts[nodeId] === 0) {
      throw new Error('blocked node cannot retry before its first attempt: ' + nodeId);
    }
    if (fromStatus === 'pending' && !evaluateGraph(graph, state).ready_node_ids.includes(nodeId)) {
      throw new Error('node is not ready: ' + nodeId);
    }
    const runningCount = Object.values(state.node_statuses).filter((status) => status === 'running').length;
    if (runningCount >= graph.limits.max_parallel) throw new Error('graph parallelism limit exceeded');
    if (attempts[nodeId] + 1 > node.max_attempts) throw new Error('node attempt limit exceeded: ' + nodeId);
    if (fromStatus === 'pending' && visits[nodeId] + 1 > node.max_visits) throw new Error('node visit limit exceeded: ' + nodeId);
    if (totalAttempts + 1 > graph.limits.max_total_attempts) throw new Error('graph total attempt limit exceeded');
    attempts[nodeId] += 1;
    if (fromStatus === 'pending') visits[nodeId] += 1;
    totalAttempts += 1;
  }
  const statuses = cloneRecord(state.node_statuses);
  statuses[nodeId] = toStatus;
  return Object.freeze({
    state_version: STATE_VERSION,
    graph_id: state.graph_id,
    node_statuses: Object.freeze(statuses),
    visit_counts: Object.freeze(visits),
    attempt_counts: Object.freeze(attempts),
    edge_decisions: state.edge_decisions,
    loop_decision_visits: state.loop_decision_visits,
    transition_count: state.transition_count + 1,
    total_attempts: totalAttempts,
  });
}

module.exports = Object.freeze({
  STATE_VERSION, assertExecutableGraph, assertValidGraphState, classifyEdge, createGraphState, evaluateGraph,
  loopCycleRegion, recordEdgeDecision, transitionNode,
});

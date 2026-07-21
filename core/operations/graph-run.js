'use strict';

const { EXECUTION_STATUSES, TERMINAL_STATUSES } = require('./constants');
const { sha256Digest } = require('./canonical');
const { assertValidOperationGraph } = require('./graph-contract');
const {
  assertExecutableGraph,
  assertValidGraphState,
  classifyEdge,
  createGraphState,
  evaluateGraph,
  recordEdgeDecision,
  transitionNode,
} = require('./graph-scheduler');
const { ID_PATTERN } = require('./validation');

const GRAPH_RUN_VERSION = '0.1';
const GRAPH_RUN_KIND = 'operation_graph_run';
const RUN_FIELDS = Object.freeze([
  'run_version', 'kind', 'run_id', 'graph_id', 'graph_digest', 'status',
  'scheduler_state', 'traversal_tokens', 'created_at', 'updated_at',
]);
const TOKEN_FIELDS = Object.freeze([
  'token_id', 'node_id', 'visit', 'parent_token_ids', 'via_edge_ids', 'status',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value, fields) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function plainState(state) {
  return Object.freeze({
    state_version: state.state_version,
    graph_id: state.graph_id,
    node_statuses: Object.freeze({ ...state.node_statuses }),
    visit_counts: Object.freeze({ ...state.visit_counts }),
    attempt_counts: Object.freeze({ ...state.attempt_counts }),
    edge_decisions: Object.freeze({ ...state.edge_decisions }),
    loop_decision_visits: Object.freeze({ ...state.loop_decision_visits }),
    transition_count: state.transition_count,
    total_attempts: state.total_attempts,
  });
}

function freezeToken(token) {
  return Object.freeze({
    token_id: token.token_id,
    node_id: token.node_id,
    visit: token.visit,
    parent_token_ids: Object.freeze([...token.parent_token_ids]),
    via_edge_ids: Object.freeze([...token.via_edge_ids]),
    status: token.status,
  });
}

function tokenId(nodeId, visit) {
  return 'token-' + nodeId + '-' + visit;
}

function satisfiedIncoming(graph, state, nodeId) {
  return graph.edges.filter((edge) => {
    if (edge.to_node_id !== nodeId) return false;
    if (edge.edge_kind !== 'loop') return classifyEdge(edge, state) === 'satisfied';
    return state.edge_decisions[edge.edge_id] === true
      && state.loop_decision_visits[edge.edge_id] === state.visit_counts[edge.from_node_id]
      && state.visit_counts[nodeId] > 0;
  });
}

function syncTraversalTokens(graph, state, tokens) {
  const evaluation = evaluateGraph(graph, state);
  const ready = new Set([...evaluation.ready_node_ids, ...evaluation.deferred_ready_node_ids]);
  const output = tokens.map((token) => freezeToken(token));
  for (const node of graph.nodes) {
    if (!ready.has(node.node_id)) continue;
    const visit = state.visit_counts[node.node_id] + 1;
    const id = tokenId(node.node_id, visit);
    if (output.some((token) => token.token_id === id)) continue;
    const incoming = satisfiedIncoming(graph, state, node.node_id);
    const parentIds = [];
    for (const edge of incoming) {
      const parent = [...output].reverse().find((token) => token.node_id === edge.from_node_id
        && token.status === 'passed');
      if (parent && !parentIds.includes(parent.token_id)) parentIds.push(parent.token_id);
    }
    output.push(freezeToken({
      token_id: id,
      node_id: node.node_id,
      visit,
      parent_token_ids: parentIds,
      via_edge_ids: incoming.map((edge) => edge.edge_id),
      status: 'pending',
    }));
  }
  return Object.freeze(output);
}

function deriveGraphRunStatus(graph, state) {
  const evaluation = evaluateGraph(graph, state);
  const statuses = Object.values(state.node_statuses);
  if (evaluation.running_node_ids.length) return 'running';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('unknown')) return 'unknown';
  if (evaluation.complete) return statuses.every((status) => status === 'passed') ? 'passed' : 'blocked';
  if (statuses.includes('blocked')) return 'blocked';
  if (!evaluation.ready_node_ids.length && !evaluation.deferred_ready_node_ids.length
      && evaluation.blocked_nodes.length) return 'blocked';
  return 'pending';
}

function validateIdArray(values, label, errors) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) {
    errors.push(label + ' must be a unique array');
    return;
  }
  for (const value of values) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) errors.push(label + ' contains an invalid identifier');
  }
}

function validateTraversalToken(graph, token, tokens, state, errors) {
  if (!exactFields(token, TOKEN_FIELDS)) {
    errors.push('traversal token fields must exactly match the allowlist');
    return;
  }
  if (typeof token.token_id !== 'string' || !ID_PATTERN.test(token.token_id)) errors.push('token_id is invalid');
  const node = graph.nodes.find((item) => item.node_id === token.node_id);
  if (!node) errors.push('token node does not exist: ' + token.node_id);
  if (!Number.isInteger(token.visit) || token.visit < 1 || token.visit > 100) errors.push('token visit is invalid');
  if (node && token.token_id !== tokenId(token.node_id, token.visit)) errors.push('token_id is not deterministic');
  validateIdArray(token.parent_token_ids, 'parent_token_ids', errors);
  validateIdArray(token.via_edge_ids, 'via_edge_ids', errors);
  const parentIds = Array.isArray(token.parent_token_ids) ? token.parent_token_ids : [];
  const edgeIds = Array.isArray(token.via_edge_ids) ? token.via_edge_ids : [];
  const parentTokens = parentIds.map((parentId) => tokens.find((item) => item.token_id === parentId));
  for (let index = 0; index < parentIds.length; index++) {
    if (!parentTokens[index]) errors.push('parent token does not exist: ' + parentIds[index]);
    else if (parentTokens[index].status !== 'passed') errors.push('parent token must be passed: ' + parentIds[index]);
    if (parentIds[index] === token.token_id) errors.push('token cannot parent itself');
  }
  const incomingEdges = [];
  const expectedTokenVisit = node && state.node_statuses[token.node_id] === 'pending'
    ? state.visit_counts[token.node_id] + 1 : Math.max(1, state.visit_counts[token.node_id]);
  const historical = node ? token.visit < expectedTokenVisit : false;
  for (const edgeId of edgeIds) {
    const edge = graph.edges.find((item) => item.edge_id === edgeId && item.to_node_id === token.node_id);
    if (!edge) errors.push('token edge does not enter its node: ' + edgeId);
    else {
      incomingEdges.push(edge);
      if (!historical && edge.edge_kind !== 'loop' && classifyEdge(edge, state) !== 'satisfied') {
        errors.push('token edge is not satisfied: ' + edgeId);
      }
      if (!historical && !TERMINAL_STATUSES.includes(token.status) && edge.edge_kind === 'loop') {
        const parent = parentTokens.find((item) => item && item.node_id === edge.from_node_id);
        if (state.edge_decisions[edgeId] !== true || !parent
            || state.loop_decision_visits[edgeId] !== parent.visit) {
          errors.push('token loop edge is not the selected reset edge: ' + edgeId);
        }
      }
    }
  }
  const expectedParentNodes = [...new Set(incomingEdges.map((edge) => edge.from_node_id))].sort();
  const actualParentNodes = [...new Set(parentTokens.filter(Boolean).map((parent) => parent.node_id))].sort();
  if (JSON.stringify(expectedParentNodes) !== JSON.stringify(actualParentNodes)) {
    errors.push('parent tokens must match traversal edges');
  }
  if (!EXECUTION_STATUSES.includes(token.status)) errors.push('token status is invalid');
  if (node) {
    if (token.visit > expectedTokenVisit) errors.push('token visit exceeds scheduler visit count');
    if (token.visit === expectedTokenVisit && token.status !== state.node_statuses[token.node_id]) {
      errors.push('latest token status does not match scheduler state: ' + token.node_id);
    }
    if (token.visit < expectedTokenVisit && !TERMINAL_STATUSES.includes(token.status)) {
      errors.push('historical token must be terminal: ' + token.token_id);
    }
  }
}

function validateGraphRun(graph, run) {
  const errors = [];
  try { assertExecutableGraph(graph); } catch (error) { errors.push(error.message); return errors; }
  if (!exactFields(run, RUN_FIELDS)) return ['graph run fields must exactly match the allowlist'];
  if (run.run_version !== GRAPH_RUN_VERSION) errors.push('run_version must be ' + GRAPH_RUN_VERSION);
  if (run.kind !== GRAPH_RUN_KIND) errors.push('kind must be ' + GRAPH_RUN_KIND);
  if (typeof run.run_id !== 'string' || !ID_PATTERN.test(run.run_id)) errors.push('run_id is invalid');
  if (run.graph_id !== graph.graph_id) errors.push('run graph_id does not match graph');
  if (run.graph_digest !== sha256Digest(graph)) errors.push('graph_digest does not match graph');
  let stateValid = true;
  try { assertValidGraphState(graph, run.scheduler_state); } catch (error) {
    errors.push(error.message);
    stateValid = false;
  }
  if (!Array.isArray(run.traversal_tokens)) errors.push('traversal_tokens must be an array');
  else if (stateValid) {
    const ids = run.traversal_tokens.map((token) => token && token.token_id);
    if (new Set(ids).size !== ids.length) errors.push('traversal token ids must be unique');
    run.traversal_tokens.forEach((token) => validateTraversalToken(
      graph, token, run.traversal_tokens, run.scheduler_state, errors));
  }
  if (!EXECUTION_STATUSES.includes(run.status)) errors.push('run status is invalid');
  else if (stateValid) {
    try {
      if (run.status !== deriveGraphRunStatus(graph, run.scheduler_state)) errors.push('run status does not match scheduler state');
    } catch (error) { errors.push(error.message); }
  }
  if (!canonicalTimestamp(run.created_at)) errors.push('created_at must be a canonical ISO timestamp');
  if (!canonicalTimestamp(run.updated_at)) errors.push('updated_at must be a canonical ISO timestamp');
  if (canonicalTimestamp(run.created_at) && canonicalTimestamp(run.updated_at)
      && Date.parse(run.updated_at) < Date.parse(run.created_at)) errors.push('updated_at cannot precede created_at');
  if (Array.isArray(run.traversal_tokens) && stateValid) {
    const tokenLimit = graph.nodes.reduce((sum, node) => sum + node.max_visits, 0);
    if (run.traversal_tokens.length > tokenLimit) errors.push('traversal token count exceeds graph visit limits');
    const evaluation = evaluateGraph(graph, run.scheduler_state);
    const ready = new Set([...evaluation.ready_node_ids, ...evaluation.deferred_ready_node_ids]);
    for (const node of graph.nodes) {
      const attempts = run.scheduler_state.attempt_counts[node.node_id];
      const status = run.scheduler_state.node_statuses[node.node_id];
      const token = [...run.traversal_tokens].reverse().find((item) => item.node_id === node.node_id);
      const expectedVisit = status === 'pending'
        ? run.scheduler_state.visit_counts[node.node_id] + 1
        : Math.max(1, run.scheduler_state.visit_counts[node.node_id]);
      const currentToken = token && token.visit === expectedVisit ? token : null;
      if (attempts > 0 && !token) errors.push('attempted node is missing a traversal token: ' + node.node_id);
      if (ready.has(node.node_id) && !currentToken) errors.push('ready node is missing a traversal token: ' + node.node_id);
      if (currentToken && status === 'pending' && !ready.has(node.node_id)) {
        errors.push('pending token belongs to a node that is not ready: ' + node.node_id);
      }
    }
  }
  return errors;
}

function assertValidGraphRun(graph, run) {
  const errors = validateGraphRun(graph, run);
  if (errors.length) throw new Error('invalid graph run: ' + errors.join('; '));
  return run;
}

function buildRun(graph, input) {
  const state = plainState(input.scheduler_state);
  const run = Object.freeze({
    run_version: GRAPH_RUN_VERSION,
    kind: GRAPH_RUN_KIND,
    run_id: input.run_id,
    graph_id: graph.graph_id,
    graph_digest: sha256Digest(graph),
    status: deriveGraphRunStatus(graph, state),
    scheduler_state: state,
    traversal_tokens: Object.freeze(input.traversal_tokens.map((token) => freezeToken(token))),
    created_at: input.created_at,
    updated_at: input.updated_at,
  });
  assertValidGraphRun(graph, run);
  return run;
}

function createGraphRun(graph, runId, options = {}) {
  assertValidOperationGraph(graph);
  assertExecutableGraph(graph);
  const now = options.now || new Date().toISOString();
  if (!canonicalTimestamp(now)) throw new Error('now must be a canonical ISO timestamp');
  const state = plainState(createGraphState(graph));
  return buildRun(graph, {
    run_id: runId,
    scheduler_state: state,
    traversal_tokens: syncTraversalTokens(graph, state, []),
    created_at: now,
    updated_at: now,
  });
}

function transitionGraphRun(graph, run, nodeId, toStatus, options = {}) {
  assertValidGraphRun(graph, run);
  const now = options.now || new Date().toISOString();
  if (!canonicalTimestamp(now)) throw new Error('now must be a canonical ISO timestamp');
  const state = plainState(transitionNode(graph, run.scheduler_state, nodeId, toStatus));
  const tokens = run.traversal_tokens.map((token) => ({ ...token }));
  const visit = state.visit_counts[nodeId] || run.scheduler_state.visit_counts[nodeId] + 1;
  const id = tokenId(nodeId, visit);
  const index = tokens.findIndex((token) => token.token_id === id);
  if (index < 0) throw new Error('node is missing a traversal token: ' + nodeId);
  tokens[index] = { ...tokens[index], status: toStatus };
  return buildRun(graph, {
    run_id: run.run_id,
    scheduler_state: state,
    traversal_tokens: syncTraversalTokens(graph, state, tokens),
    created_at: run.created_at,
    updated_at: now,
  });
}

function decideGraphRunEdge(graph, run, edgeId, selected, options = {}) {
  assertValidGraphRun(graph, run);
  const now = options.now || new Date().toISOString();
  if (!canonicalTimestamp(now)) throw new Error('now must be a canonical ISO timestamp');
  const state = plainState(recordEdgeDecision(graph, run.scheduler_state, edgeId, selected));
  return buildRun(graph, {
    run_id: run.run_id,
    scheduler_state: state,
    traversal_tokens: syncTraversalTokens(graph, state, run.traversal_tokens),
    created_at: run.created_at,
    updated_at: now,
  });
}

module.exports = Object.freeze({
  GRAPH_RUN_KIND,
  GRAPH_RUN_VERSION,
  RUN_FIELDS,
  TOKEN_FIELDS,
  assertValidGraphRun,
  createGraphRun,
  decideGraphRunEdge,
  deriveGraphRunStatus,
  syncTraversalTokens,
  transitionGraphRun,
  validateGraphRun,
});

'use strict';

const { EVIDENCE_TYPES } = require('./constants');
const { EFFECT_CLASSES } = require('./journal');

const GRAPH_VERSION = '0.1';
const GRAPH_KIND = 'operation_graph_spec';
const NODE_KINDS = Object.freeze(['agent', 'deterministic', 'gate', 'human']);
const EDGE_KINDS = Object.freeze(['success', 'conditional', 'failure', 'loop']);
const JOIN_POLICIES = Object.freeze(['all', 'quorum', 'first_success']);
const MISSING_INPUT_STATUSES = Object.freeze(['blocked', 'unknown', 'failed']);
const VERIFIER_POLICIES = Object.freeze(['none', 'deterministic', 'single', 'arbiter']);
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

const FIELDS = Object.freeze({
  graph: Object.freeze(['graph_version', 'kind', 'graph_id', 'operation_spec_digest', 'entry_node_ids', 'nodes', 'edges', 'joins', 'limits', 'created_at']),
  node: Object.freeze(['node_id', 'step_id', 'node_kind', 'input_schema_digest', 'output_schema_digest', 'executor_profile', 'scope_digest', 'timeout_ms', 'max_attempts', 'max_visits', 'effect_class', 'verifier']),
  edge: Object.freeze(['edge_id', 'from_node_id', 'to_node_id', 'edge_kind', 'condition_digest', 'data_contract_digest']),
  join: Object.freeze(['node_id', 'policy', 'threshold', 'missing_input_status']),
  limits: Object.freeze(['max_transitions', 'max_parallel', 'max_total_attempts']),
  verifier: Object.freeze(['required', 'policy', 'evidence_types']),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value, expected, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(label + ' must be a plain object');
    return false;
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    errors.push(label + ' fields must exactly match the allowlist');
  }
  return true;
}

function checkId(value, label, errors) {
  if (typeof value !== 'string' || value.length > 128 || !ID_PATTERN.test(value)) {
    errors.push(label + ' must be an opaque lowercase identifier');
  }
}

function checkDigest(value, label, errors, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) errors.push(label + ' must be a sha256 digest');
}

function checkInteger(value, label, errors, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(label + ' must be an integer from ' + minimum + ' to ' + maximum);
  }
}

function checkUniqueIds(values, label, errors) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 256) {
    errors.push(label + ' must contain 1 to 256 entries');
    return;
  }
  const unique = new Set();
  values.forEach((value, index) => {
    checkId(value, label + '[' + index + ']', errors);
    if (unique.has(value)) errors.push(label + ' cannot contain duplicates');
    unique.add(value);
  });
}

function validateVerifier(verifier, label, errors) {
  if (!exactFields(verifier, FIELDS.verifier, label, errors)) return;
  if (typeof verifier.required !== 'boolean') errors.push(label + '.required must be boolean');
  if (!VERIFIER_POLICIES.includes(verifier.policy)) errors.push(label + '.policy is invalid');
  if (!Array.isArray(verifier.evidence_types) || verifier.evidence_types.length > EVIDENCE_TYPES.length) {
    errors.push(label + '.evidence_types must be an array');
  } else {
    const unique = new Set();
    verifier.evidence_types.forEach((type) => {
      if (!EVIDENCE_TYPES.includes(type)) errors.push(label + '.evidence_types contains unknown type: ' + type);
      if (unique.has(type)) errors.push(label + '.evidence_types cannot contain duplicates');
      unique.add(type);
    });
  }
  if (verifier.required && verifier.policy === 'none') errors.push(label + '.policy cannot be none when required');
  if (!verifier.required && verifier.policy !== 'none') errors.push(label + '.policy must be none when not required');
}

function validateNode(node, index, errors) {
  const label = 'nodes[' + index + ']';
  if (!exactFields(node, FIELDS.node, label, errors)) return;
  checkId(node.node_id, label + '.node_id', errors);
  checkId(node.step_id, label + '.step_id', errors);
  if (!NODE_KINDS.includes(node.node_kind)) errors.push(label + '.node_kind is invalid');
  checkDigest(node.input_schema_digest, label + '.input_schema_digest', errors);
  checkDigest(node.output_schema_digest, label + '.output_schema_digest', errors);
  checkId(node.executor_profile, label + '.executor_profile', errors);
  checkDigest(node.scope_digest, label + '.scope_digest', errors);
  checkInteger(node.timeout_ms, label + '.timeout_ms', errors, 1, 86400000);
  checkInteger(node.max_attempts, label + '.max_attempts', errors, 1, 100);
  checkInteger(node.max_visits, label + '.max_visits', errors, 1, 100);
  if (!EFFECT_CLASSES.includes(node.effect_class)) errors.push(label + '.effect_class is invalid');
  validateVerifier(node.verifier, label + '.verifier', errors);
}

function validateEdge(edge, index, errors) {
  const label = 'edges[' + index + ']';
  if (!exactFields(edge, FIELDS.edge, label, errors)) return;
  checkId(edge.edge_id, label + '.edge_id', errors);
  checkId(edge.from_node_id, label + '.from_node_id', errors);
  checkId(edge.to_node_id, label + '.to_node_id', errors);
  if (!EDGE_KINDS.includes(edge.edge_kind)) errors.push(label + '.edge_kind is invalid');
  checkDigest(edge.condition_digest, label + '.condition_digest', errors, true);
  checkDigest(edge.data_contract_digest, label + '.data_contract_digest', errors, true);
  const needsCondition = edge.edge_kind === 'conditional' || edge.edge_kind === 'loop';
  if (needsCondition && edge.condition_digest === null) errors.push(label + '.condition_digest is required');
  if (!needsCondition && edge.condition_digest !== null) errors.push(label + '.condition_digest must be null');
  if (edge.from_node_id === edge.to_node_id && edge.edge_kind !== 'loop') errors.push(label + ' self-edge must be a loop');
}

function validateJoin(join, index, errors) {
  const label = 'joins[' + index + ']';
  if (!exactFields(join, FIELDS.join, label, errors)) return;
  checkId(join.node_id, label + '.node_id', errors);
  if (!JOIN_POLICIES.includes(join.policy)) errors.push(label + '.policy is invalid');
  if (!MISSING_INPUT_STATUSES.includes(join.missing_input_status)) errors.push(label + '.missing_input_status is invalid');
  if (join.policy === 'quorum') checkInteger(join.threshold, label + '.threshold', errors, 1, 256);
  else if (join.threshold !== null) errors.push(label + '.threshold must be null unless policy is quorum');
}

function validateLimits(limits, errors) {
  if (!exactFields(limits, FIELDS.limits, 'limits', errors)) return;
  checkInteger(limits.max_transitions, 'limits.max_transitions', errors, 1, 100000);
  checkInteger(limits.max_parallel, 'limits.max_parallel', errors, 1, 64);
  checkInteger(limits.max_total_attempts, 'limits.max_total_attempts', errors, 1, 100000);
}

function validateTopology(graph, errors) {
  if (![...graph.nodes, ...graph.edges, ...graph.joins].every(isPlainObject)) return;
  const nodeIds = new Set(graph.nodes.map((node) => node.node_id));
  if (nodeIds.size !== graph.nodes.length) errors.push('nodes must have unique node_id values');
  const edgeIds = graph.edges.map((edge) => edge.edge_id);
  if (new Set(edgeIds).size !== edgeIds.length) errors.push('edges must have unique edge_id values');
  const joinIds = graph.joins.map((join) => join.node_id);
  if (new Set(joinIds).size !== joinIds.length) errors.push('joins must have unique node_id values');

  const incoming = new Map([...nodeIds].map((id) => [id, []]));
  const outgoing = new Map([...nodeIds].map((id) => [id, []]));
  for (const entryId of graph.entry_node_ids) if (!nodeIds.has(entryId)) errors.push('entry node does not exist: ' + entryId);
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from_node_id)) errors.push('edge source does not exist: ' + edge.from_node_id);
    if (!nodeIds.has(edge.to_node_id)) errors.push('edge target does not exist: ' + edge.to_node_id);
    if (outgoing.has(edge.from_node_id)) outgoing.get(edge.from_node_id).push(edge);
    if (incoming.has(edge.to_node_id)) incoming.get(edge.to_node_id).push(edge);
  }

  const entryIds = new Set(graph.entry_node_ids);
  for (const nodeId of nodeIds) {
    const edges = incoming.get(nodeId).filter((edge) => edge.edge_kind !== 'loop');
    const join = graph.joins.find((item) => item.node_id === nodeId);
    if (!entryIds.has(nodeId) && edges.length === 0) errors.push('non-entry node has no incoming edge: ' + nodeId);
    if (edges.length > 1 && !join) errors.push('node with multiple incoming edges requires a join: ' + nodeId);
    if (join && edges.length < 2) errors.push('join requires at least two incoming edges: ' + nodeId);
    if (join && join.policy === 'quorum' && Number.isInteger(join.threshold) && join.threshold > edges.length) {
      errors.push('join threshold exceeds incoming edge count: ' + nodeId);
    }
  }
  for (const join of graph.joins) if (!nodeIds.has(join.node_id)) errors.push('join node does not exist: ' + join.node_id);
  for (const edge of graph.edges.filter((item) => item.edge_kind === 'loop')) {
    const target = graph.nodes.find((node) => node.node_id === edge.to_node_id);
    if (target && target.max_visits < 2) errors.push('loop target must allow at least two visits: ' + edge.to_node_id);
    const reachableFromTarget = new Set([edge.to_node_id]);
    const loopQueue = [edge.to_node_id];
    while (loopQueue.length) {
      const current = loopQueue.shift();
      for (const candidate of (outgoing.get(current) || []).filter((item) => item.edge_kind !== 'loop')) {
        if (!reachableFromTarget.has(candidate.to_node_id)) {
          reachableFromTarget.add(candidate.to_node_id);
          loopQueue.push(candidate.to_node_id);
        }
      }
    }
    if (!reachableFromTarget.has(edge.from_node_id)) {
      errors.push('loop edge must close a non-loop path: ' + edge.edge_id);
    }
    const canReachSource = new Set([edge.from_node_id]);
    const reverseQueue = [edge.from_node_id];
    while (reverseQueue.length) {
      const current = reverseQueue.shift();
      for (const candidate of (incoming.get(current) || []).filter((item) => item.edge_kind !== 'loop')) {
        if (!canReachSource.has(candidate.from_node_id)) {
          canReachSource.add(candidate.from_node_id);
          reverseQueue.push(candidate.from_node_id);
        }
      }
    }
    for (const node of graph.nodes.filter((item) =>
      reachableFromTarget.has(item.node_id) && canReachSource.has(item.node_id))) {
      if (node.max_visits < 2) errors.push('loop cycle node must allow at least two visits: ' + node.node_id);
    }
  }

  const reachable = new Set();
  const queue = [...entryIds];
  while (queue.length) {
    const nodeId = queue.shift();
    if (reachable.has(nodeId) || !outgoing.has(nodeId)) continue;
    reachable.add(nodeId);
    outgoing.get(nodeId).forEach((edge) => queue.push(edge.to_node_id));
  }
  for (const nodeId of nodeIds) if (!reachable.has(nodeId)) errors.push('node is unreachable from an entry: ' + nodeId);

  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId) {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const edge of (outgoing.get(nodeId) || []).filter((item) => item.edge_kind !== 'loop')) {
      if (visit(edge.to_node_id)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }
  if ([...nodeIds].some((nodeId) => visit(nodeId))) errors.push('cycles must be expressed only with loop edges');
}

function validateOperationGraph(graph) {
  const errors = [];
  if (!exactFields(graph, FIELDS.graph, GRAPH_KIND, errors)) return errors;
  if (graph.graph_version !== GRAPH_VERSION) errors.push('graph_version must be ' + GRAPH_VERSION);
  if (graph.kind !== GRAPH_KIND) errors.push('kind must be ' + GRAPH_KIND);
  checkId(graph.graph_id, 'graph_id', errors);
  checkDigest(graph.operation_spec_digest, 'operation_spec_digest', errors);
  checkUniqueIds(graph.entry_node_ids, 'entry_node_ids', errors);
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 1 || graph.nodes.length > 256) errors.push('nodes must contain 1 to 256 entries');
  else graph.nodes.forEach((node, index) => validateNode(node, index, errors));
  if (!Array.isArray(graph.edges) || graph.edges.length > 2048) errors.push('edges must contain 0 to 2048 entries');
  else graph.edges.forEach((edge, index) => validateEdge(edge, index, errors));
  if (!Array.isArray(graph.joins) || graph.joins.length > 256) errors.push('joins must contain 0 to 256 entries');
  else graph.joins.forEach((join, index) => validateJoin(join, index, errors));
  validateLimits(graph.limits, errors);
  if (typeof graph.created_at !== 'string' || !Number.isFinite(Date.parse(graph.created_at))
      || new Date(graph.created_at).toISOString() !== graph.created_at) errors.push('created_at must be a canonical ISO timestamp');
  if (Array.isArray(graph.nodes) && Array.isArray(graph.edges) && Array.isArray(graph.joins)
      && Array.isArray(graph.entry_node_ids)) validateTopology(graph, errors);
  return errors;
}

function assertValidOperationGraph(graph) {
  const errors = validateOperationGraph(graph);
  if (errors.length) throw new Error('invalid operation graph: ' + errors.join('; '));
  return graph;
}

module.exports = Object.freeze({
  EDGE_KINDS, GRAPH_KIND, GRAPH_VERSION, JOIN_POLICIES, MISSING_INPUT_STATUSES,
  NODE_KINDS, VERIFIER_POLICIES, assertValidOperationGraph, validateOperationGraph,
});

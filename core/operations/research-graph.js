'use strict';

const { sha256Digest } = require('./canonical');
const { assertValidOperationGraph } = require('./graph-contract');
const { ID_PATTERN } = require('./validation');

const RESEARCH_GRAPH_TEMPLATE_VERSION = '0.1';

function canonicalTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function verifier(policy, evidenceTypes) {
  return Object.freeze({
    required: policy !== 'none',
    policy,
    evidence_types: Object.freeze([...evidenceTypes]),
  });
}

function researchNode(nodeId, nodeKind, executorProfile, policy, evidenceTypes, digests) {
  return Object.freeze({
    node_id: nodeId,
    step_id: nodeId,
    node_kind: nodeKind,
    input_schema_digest: digests.input,
    output_schema_digest: digests.output,
    executor_profile: executorProfile,
    scope_digest: digests.scope,
    timeout_ms: 900000,
    max_attempts: 2,
    max_visits: 1,
    effect_class: 'pure',
    verifier: verifier(policy, evidenceTypes),
  });
}

function successEdge(edgeId, fromNodeId, toNodeId, dataDigest) {
  return Object.freeze({
    edge_id: edgeId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    edge_kind: 'success',
    condition_digest: null,
    data_contract_digest: dataDigest,
  });
}

function validateAngles(angleIds) {
  if (!Array.isArray(angleIds) || angleIds.length < 3 || angleIds.length > 5) {
    throw new Error('research graph requires 3 to 5 angle ids');
  }
  if (new Set(angleIds).size !== angleIds.length) throw new Error('research angle ids must be unique');
  for (const angleId of angleIds) {
    if (typeof angleId !== 'string' || !ID_PATTERN.test(angleId) || angleId.length > 64) {
      throw new Error('research angle ids must be opaque lowercase identifiers');
    }
  }
}

function createResearchFleetGraph(angleIds, options = {}) {
  validateAngles(angleIds);
  const createdAt = options.now || new Date().toISOString();
  if (!canonicalTimestamp(createdAt)) throw new Error('now must be a canonical ISO timestamp');
  const identityDigest = sha256Digest({
    template: 'research-fleet',
    template_version: RESEARCH_GRAPH_TEMPLATE_VERSION,
    angle_ids: angleIds,
  });
  const graphId = options.graphId || 'research-fleet-' + identityDigest.slice('sha256:'.length, 'sha256:'.length + 12);
  if (!ID_PATTERN.test(graphId)) throw new Error('graphId must be an opaque lowercase identifier');
  const digests = Object.freeze({
    input: sha256Digest({ schema: 'research-node-input', version: '0.1' }),
    output: sha256Digest({ schema: 'research-node-output', version: '0.1' }),
    scope: options.scopeDigest || sha256Digest({ graph_id: graphId, scope: 'research-fleet' }),
    data: sha256Digest({ schema: 'research-node-handoff', version: '0.1' }),
  });
  const scoutNodes = angleIds.map((angleId) => 'scout-' + angleId);
  const nodes = [
    researchNode('scope', 'deterministic', 'local-deterministic', 'deterministic', ['artifact'], digests),
    ...scoutNodes.map((nodeId) =>
      researchNode(nodeId, 'agent', 'research-scout', 'single', ['review'], digests)),
    researchNode('reduce', 'deterministic', 'local-deterministic', 'deterministic', ['artifact'], digests),
    researchNode('synthesize', 'agent', 'synthesis-agent', 'single', ['artifact', 'review'], digests),
    researchNode('arbiter', 'gate', 'arbiter', 'arbiter', ['review'], digests),
  ];
  const edges = [
    ...scoutNodes.map((nodeId) => successEdge('scope-to-' + nodeId, 'scope', nodeId, digests.data)),
    ...scoutNodes.map((nodeId) => successEdge(nodeId + '-to-reduce', nodeId, 'reduce', digests.data)),
    successEdge('reduce-to-synthesize', 'reduce', 'synthesize', digests.data),
    successEdge('synthesize-to-arbiter', 'synthesize', 'arbiter', digests.data),
  ];
  const nodeCount = nodes.length;
  const graph = {
    graph_version: '0.1',
    kind: 'operation_graph_spec',
    graph_id: graphId,
    operation_spec_digest: options.operationSpecDigest || identityDigest,
    entry_node_ids: ['scope'],
    nodes,
    edges,
    joins: [{ node_id: 'reduce', policy: 'all', threshold: null, missing_input_status: 'blocked' }],
    limits: {
      max_transitions: nodeCount * 4,
      max_parallel: angleIds.length,
      max_total_attempts: nodeCount * 2,
    },
    created_at: createdAt,
  };
  assertValidOperationGraph(graph);
  return Object.freeze(graph);
}

function createResearchFleetOperationSpec(angleIds, options = {}) {
  validateAngles(angleIds);
  const createdAt = options.now || new Date().toISOString();
  if (!canonicalTimestamp(createdAt)) throw new Error('now must be a canonical ISO timestamp');
  const identityDigest = sha256Digest({
    template: 'research-fleet',
    template_version: RESEARCH_GRAPH_TEMPLATE_VERSION,
    angle_ids: angleIds,
  });
  const suffix = identityDigest.slice('sha256:'.length, 'sha256:'.length + 12);
  return Object.freeze({
    protocol_version: '0.1',
    kind: 'operation_spec',
    operation_id: 'research-operation-' + suffix,
    title: 'Research graph cohort',
    objective_digest: identityDigest,
    step_ids: Object.freeze([
      'scope',
      ...angleIds.map((angleId) => 'scout-' + angleId),
      'reduce',
      'synthesize',
      'arbiter',
    ]),
    policy_digests: Object.freeze([sha256Digest({
      policy: 'research-graph-verification',
      version: RESEARCH_GRAPH_TEMPLATE_VERSION,
    })]),
    created_at: createdAt,
  });
}

function createResearchFleetBundle(angleIds, options = {}) {
  const operation = createResearchFleetOperationSpec(angleIds, options);
  const graph = createResearchFleetGraph(angleIds, {
    ...options,
    operationSpecDigest: sha256Digest(operation),
  });
  return Object.freeze({ operation, graph });
}

module.exports = Object.freeze({
  RESEARCH_GRAPH_TEMPLATE_VERSION,
  createResearchFleetGraph,
  createResearchFleetBundle,
  createResearchFleetOperationSpec,
});

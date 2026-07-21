'use strict';

const {
  appendJournalEntry,
  JournalCorruptionError,
  readJournal,
} = require('./journal');
const { sha256Digest } = require('./canonical');
const {
  appendGraphRunSnapshot,
  GraphJournalCorruptionError,
  readGraphRunJournal,
} = require('./graph-journal');
const {
  assertValidGraphRun,
  transitionGraphRun,
} = require('./graph-run');
const {
  createExecutionReceipt,
  requiredStepSubject,
  unsignedReceiptEnvelope,
} = require('./receipts');
const { decisionFor } = require('./recovery');
const {
  DIGEST_PATTERN,
  validateOperationSpec,
} = require('./validation');

const GRAPH_EFFECT_RESOLUTIONS = Object.freeze(['completed', 'retryable', 'unknown']);

function assertDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new TypeError(label + ' must be a sha256 digest');
  }
}

function assertGraphOperationBinding(graph, operation) {
  const errors = validateOperationSpec(operation);
  if (errors.length) throw new TypeError('Invalid bound operation: ' + errors.join('; '));
  if (sha256Digest(operation) !== graph.operation_spec_digest) {
    throw new TypeError('operation digest does not match graph operation_spec_digest');
  }
  const stepIds = graph.nodes.map((node) => node.step_id);
  if (new Set(stepIds).size !== stepIds.length) {
    throw new TypeError('graph nodes must map to unique operation step ids');
  }
  if (JSON.stringify([...stepIds].sort()) !== JSON.stringify([...operation.step_ids].sort())) {
    throw new TypeError('graph node step ids must exactly cover the operation');
  }
  return operation;
}

function tokenForNode(run, nodeId) {
  return [...run.traversal_tokens].reverse().find((token) => token.node_id === nodeId) || null;
}

function graphEffectIdentity(graph, run, nodeId) {
  assertValidGraphRun(graph, run);
  const node = graph.nodes.find((item) => item.node_id === nodeId);
  if (!node) throw new Error('unknown graph node: ' + nodeId);
  const token = tokenForNode(run, nodeId);
  if (!token) throw new Error('graph node has no traversal token: ' + nodeId);
  const identityDigest = sha256Digest({
    graph_digest: run.graph_digest,
    run_id: run.run_id,
    node_id: nodeId,
    visit: token.visit,
  });
  const suffix = identityDigest.slice('sha256:'.length, 'sha256:'.length + 24);
  return Object.freeze({
    node,
    token,
    attempt_id: 'attempt-' + suffix,
    idempotency_key: 'graph-effect-' + suffix,
  });
}

function latestEffectEntry(effectJournalDir, idempotencyKey) {
  const journal = readJournal(effectJournalDir);
  return [...journal.entries].reverse()
    .find((entry) => entry.idempotency_key === idempotencyKey) || null;
}

function effectRecovery(effectJournalDir, binding, payloadDigest) {
  assertDigest(payloadDigest, 'payloadDigest');
  const entry = latestEffectEntry(effectJournalDir, binding.idempotency_key);
  if (!entry) {
    return Object.freeze({ decision: 'execute', reason_code: 'NO_PRIOR_CHECKPOINT', entry: null });
  }
  if (entry.payload_digest !== payloadDigest) {
    return Object.freeze({ decision: 'block', reason_code: 'PAYLOAD_DIGEST_MISMATCH', entry });
  }
  if (entry.attempt_id !== binding.attempt_id || entry.effect_class !== binding.node.effect_class) {
    return Object.freeze({ decision: 'block', reason_code: 'EFFECT_BINDING_MISMATCH', entry });
  }
  return Object.freeze({ ...decisionFor(entry), entry });
}

function checkpointInput(run, binding, payloadDigest, state, evidenceDigest = null) {
  return {
    run_id: run.run_id,
    attempt_id: binding.attempt_id,
    idempotency_key: binding.idempotency_key,
    effect_class: binding.node.effect_class,
    state,
    payload_digest: payloadDigest,
    evidence_digest: evidenceDigest,
  };
}

function transitionAndAppend(graphJournalDir, graph, run, nodeId, status, now) {
  const next = transitionGraphRun(graph, run, nodeId, status, { now });
  appendGraphRunSnapshot(graphJournalDir, graph, next, 'node_transition');
  return next;
}

function startGraphNodeEffect(options) {
  const {
    graph, run, graphJournalDir, effectJournalDir, nodeId, payloadDigest,
  } = options;
  const now = options.now || new Date().toISOString();
  const binding = graphEffectIdentity(graph, run, nodeId);
  const currentStatus = run.scheduler_state.node_statuses[nodeId];
  if (!['pending', 'blocked', 'running'].includes(currentStatus)) {
    throw new Error('node cannot start an effect from status: ' + currentStatus);
  }
  const recovery = effectRecovery(effectJournalDir, binding, payloadDigest);
  if (recovery.decision === 'block') {
    return Object.freeze({
      status: 'blocked',
      execution: 'blocked',
      reason_code: recovery.reason_code,
      run,
      binding,
    });
  }

  let next = run;
  if (recovery.decision === 'skip') {
    if (currentStatus !== 'running') {
      next = transitionAndAppend(graphJournalDir, graph, next, nodeId, 'running', now);
    }
    next = transitionAndAppend(graphJournalDir, graph, next, nodeId, 'passed', now);
    return Object.freeze({
      status: 'completed',
      execution: 'skipped',
      reason_code: recovery.reason_code,
      run: next,
      binding,
    });
  }

  if (currentStatus === 'running' && recovery.decision === 'retry') {
    next = transitionAndAppend(graphJournalDir, graph, next, nodeId, 'blocked', now);
  }
  if (next.scheduler_state.node_statuses[nodeId] !== 'running') {
    next = transitionAndAppend(graphJournalDir, graph, next, nodeId, 'running', now);
  }
  appendJournalEntry(effectJournalDir,
    checkpointInput(next, binding, payloadDigest, 'pending'), { now });
  return Object.freeze({
    status: 'ready',
    execution: recovery.decision,
    reason_code: recovery.reason_code,
    run: next,
    binding,
  });
}

function completeGraphNodeEffect(options) {
  const {
    graph, run, graphJournalDir, effectJournalDir, nodeId, payloadDigest, evidenceDigest,
  } = options;
  const now = options.now || new Date().toISOString();
  assertDigest(evidenceDigest, 'evidenceDigest');
  const binding = graphEffectIdentity(graph, run, nodeId);
  if (run.scheduler_state.node_statuses[nodeId] !== 'running') {
    throw new Error('node must be running before effect completion');
  }
  const latest = latestEffectEntry(effectJournalDir, binding.idempotency_key);
  if (!latest) throw new Error('effect completion requires a pending checkpoint');
  if (latest.payload_digest !== payloadDigest || latest.attempt_id !== binding.attempt_id
      || latest.effect_class !== binding.node.effect_class) {
    throw new Error('effect completion does not match its pending checkpoint');
  }
  let checkpoint = latest;
  if (latest.state !== 'completed') {
    if (!['pending', 'unknown'].includes(latest.state)) throw new Error('effect checkpoint is not ambiguous');
    checkpoint = appendJournalEntry(effectJournalDir,
      checkpointInput(run, binding, payloadDigest, 'completed', evidenceDigest), { now });
  } else if (latest.evidence_digest !== evidenceDigest) {
    throw new Error('completed effect evidence digest cannot change');
  }
  if (options.faultAt === 'after_effect_checkpoint') {
    const error = new Error('Injected fault after effect checkpoint');
    error.code = 'FAULT_INJECTED';
    throw error;
  }
  const next = transitionAndAppend(graphJournalDir, graph, run, nodeId, 'passed', now);
  return Object.freeze({
    status: 'completed',
    execution: latest.state === 'completed' ? 'reconciled' : 'recorded',
    reason_code: latest.state === 'completed' ? 'COMPLETED_EFFECT_RECONCILED' : 'EVIDENCE_RECORDED',
    run: next,
    binding,
    checkpoint,
  });
}

function resolveGraphNodeEffect(options) {
  const {
    graph, run, graphJournalDir, effectJournalDir, nodeId, payloadDigest, resolution,
  } = options;
  const now = options.now || new Date().toISOString();
  if (!GRAPH_EFFECT_RESOLUTIONS.includes(resolution)) throw new Error('invalid graph effect resolution');
  const binding = graphEffectIdentity(graph, run, nodeId);
  if (run.scheduler_state.node_statuses[nodeId] !== 'running') {
    throw new Error('only an in-flight node can be resolved');
  }
  const latest = latestEffectEntry(effectJournalDir, binding.idempotency_key);
  if (!latest || !['pending', 'unknown'].includes(latest.state)) {
    throw new Error('resolution requires an ambiguous effect checkpoint');
  }
  if (latest.payload_digest !== payloadDigest) throw new Error('resolution payload digest does not match checkpoint');

  if (resolution === 'completed') {
    return completeGraphNodeEffect({ ...options, evidenceDigest: options.evidenceDigest, now });
  }
  if (resolution === 'retryable') {
    if (binding.node.effect_class !== 'external-nonrepeatable') {
      throw new Error('retryable resolution is only required for external-nonrepeatable effects');
    }
    assertDigest(options.evidenceDigest, 'evidenceDigest');
    appendJournalEntry(effectJournalDir,
      checkpointInput(run, binding, payloadDigest, 'retryable', options.evidenceDigest), { now });
    const next = transitionAndAppend(graphJournalDir, graph, run, nodeId, 'blocked', now);
    return Object.freeze({
      status: 'ready',
      execution: 'retry_authorized',
      reason_code: 'RETRY_AUTHORIZED_BY_EVIDENCE',
      run: next,
      binding,
    });
  }
  appendJournalEntry(effectJournalDir,
    checkpointInput(run, binding, payloadDigest, 'unknown'), { now });
  const next = transitionAndAppend(graphJournalDir, graph, run, nodeId, 'unknown', now);
  return Object.freeze({
    status: 'blocked',
    execution: 'resolved_unknown',
    reason_code: 'EFFECT_OUTCOME_UNKNOWN',
    run: next,
    binding,
  });
}

function planGraphExecutionRecovery(graphJournalDir, effectJournalDir, graph) {
  let graphJournal;
  try {
    graphJournal = readGraphRunJournal(graphJournalDir, graph);
  } catch (error) {
    if (!(error instanceof GraphJournalCorruptionError)) throw error;
    return Object.freeze({
      status: 'blocked', reason_code: 'GRAPH_JOURNAL_CORRUPT', run: null, actions: Object.freeze([]),
    });
  }
  let effectJournal;
  try {
    effectJournal = readJournal(effectJournalDir);
  } catch (error) {
    if (!(error instanceof JournalCorruptionError)) throw error;
    return Object.freeze({
      status: 'blocked', reason_code: 'EFFECT_JOURNAL_CORRUPT',
      run: graphJournal.latest_run, actions: Object.freeze([]),
    });
  }
  if (!graphJournal.latest_run) {
    return Object.freeze({
      status: 'empty',
      reason_code: 'GRAPH_RUN_NOT_INITIALIZED',
      run: null,
      actions: Object.freeze([]),
    });
  }
  const run = graphJournal.latest_run;
  const inFlight = Object.entries(run.scheduler_state.node_statuses)
    .filter(([, status]) => status === 'running').map(([nodeId]) => nodeId);
  const actions = inFlight.map((nodeId) => {
    const binding = graphEffectIdentity(graph, run, nodeId);
    const entry = [...effectJournal.entries].reverse()
      .find((item) => item.idempotency_key === binding.idempotency_key) || null;
    const action = entry ? decisionFor(entry) : {
      decision: 'execute',
      reason_code: 'NO_PRIOR_CHECKPOINT',
    };
    return Object.freeze({
      node_id: nodeId,
      attempt_id: binding.attempt_id,
      idempotency_key: binding.idempotency_key,
      effect_class: binding.node.effect_class,
      state: entry ? entry.state : null,
      ...action,
    });
  });
  const blocked = actions.some((action) => action.decision === 'block');
  const terminalBlocked = ['failed', 'blocked', 'unknown'].includes(run.status);
  return Object.freeze({
    status: blocked || terminalBlocked ? 'blocked'
      : inFlight.length ? 'ready' : run.status === 'passed' ? 'complete' : 'ready',
    reason_code: blocked ? 'AMBIGUOUS_GRAPH_EFFECT'
      : terminalBlocked ? 'GRAPH_RUN_BLOCKED'
        : inFlight.length ? 'GRAPH_EFFECT_RECOVERY_READY'
          : run.status === 'passed' ? 'GRAPH_RUN_COMPLETE' : 'GRAPH_RUN_RESUMABLE',
    run,
    actions: Object.freeze(actions),
  });
}

function createGraphProtocolProof(options) {
  const {
    graph, run, operation, effectJournalDir, issuedAt, issuerId,
  } = options;
  assertValidGraphRun(graph, run);
  assertGraphOperationBinding(graph, operation);
  if (!['passed', 'failed', 'blocked', 'unknown'].includes(run.status)) {
    throw new Error('protocol proof requires a terminal graph run');
  }
  const journal = readJournal(effectJournalDir);
  const latestTokens = new Map();
  for (const token of run.traversal_tokens) latestTokens.set(token.node_id, token);
  const attempts = [];
  const evidence = [];

  for (const node of graph.nodes) {
    const token = latestTokens.get(node.node_id);
    if (!token) continue;
    const binding = graphEffectIdentity(graph, run, node.node_id);
    const entry = [...journal.entries].reverse()
      .find((item) => item.idempotency_key === binding.idempotency_key && item.state === 'completed');
    if (!entry) continue;
    const evidenceId = 'evidence-' + sha256Digest({ attempt_id: binding.attempt_id, evidence_digest: entry.evidence_digest })
      .slice('sha256:'.length, 'sha256:'.length + 24);
    attempts.push(Object.freeze({
      protocol_version: '0.1',
      kind: 'step_attempt',
      attempt_id: binding.attempt_id,
      run_id: run.run_id,
      step_id: node.step_id,
      attempt_number: run.scheduler_state.attempt_counts[node.node_id],
      status: 'passed',
      started_at: run.created_at,
      completed_at: run.updated_at,
      evidence_ids: Object.freeze([evidenceId]),
      failure_code: null,
    }));
    evidence.push(Object.freeze({
      protocol_version: '0.1',
      kind: 'evidence_envelope',
      evidence_id: evidenceId,
      run_id: run.run_id,
      step_attempt_id: binding.attempt_id,
      evidence_type: node.verifier.evidence_types[0] || 'other',
      status: 'passed',
      subject_digest: requiredStepSubject(operation, node.step_id),
      artifact_digest: entry.evidence_digest,
      recorded_at: run.updated_at,
      redacted: true,
    }));
  }

  const operationRun = Object.freeze({
    protocol_version: '0.1',
    kind: 'operation_run',
    run_id: run.run_id,
    operation_id: operation.operation_id,
    spec_digest: sha256Digest(operation),
    status: run.status,
    started_at: run.created_at,
    completed_at: run.updated_at,
    intent_ids: Object.freeze([]),
    step_attempt_ids: Object.freeze(attempts.map((attempt) => attempt.attempt_id)),
  });
  const receipt = createExecutionReceipt({
    operation,
    run: operationRun,
    evidence,
    issuedAt,
    issuerId,
  });
  return Object.freeze({
    operation_run: operationRun,
    step_attempts: Object.freeze(attempts),
    evidence: Object.freeze(evidence),
    receipt_envelope: unsignedReceiptEnvelope(receipt),
  });
}

module.exports = Object.freeze({
  GRAPH_EFFECT_RESOLUTIONS,
  assertGraphOperationBinding,
  completeGraphNodeEffect,
  createGraphProtocolProof,
  graphEffectIdentity,
  planGraphExecutionRecovery,
  resolveGraphNodeEffect,
  startGraphNodeEffect,
});

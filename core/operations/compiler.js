'use strict';

const path = require('path');
const operations = require('./index');

const WORKFLOW_SCHEMA = 1;
const COMPILER_VERSION = 1;
const TERMINAL_STATES = Object.freeze(['passed', 'failed', 'blocked', 'unknown']);
const KNOWN_CAPABILITIES = Object.freeze([
  'ordered_steps', 'verifier', 'evidence_states', 'failure_status',
  'cancellation_status', 'receipt_path', 'approvals', 'parallel_steps',
]);
const WORKFLOW_FIELDS = Object.freeze([
  'schema_version', 'operation', 'steps', 'verifier', 'evidence', 'outcome',
  'receipt', 'required_capabilities',
]);
const STEP_FIELDS = Object.freeze(['id', 'name', 'argv', 'evidence_type']);
const VERIFIER_FIELDS = Object.freeze(['step_id', 'required_status', 'missing_evidence_status']);
const EVIDENCE_FIELDS = Object.freeze(['states']);
const OUTCOME_FIELDS = Object.freeze(['failure_status', 'cancellation_status']);
const RECEIPT_FIELDS = Object.freeze(['path', 'issuer_id']);
const CORE_FIELDS = Object.freeze([
  'protocol_version', 'operation_id', 'operation_digest', 'workflow_digest',
  'step_ids', 'step_commands_digest', 'verifier', 'evidence_states',
  'failure_status', 'cancellation_status', 'receipt_path',
]);

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields, label, errors) {
  if (!plain(value)) {
    errors.push(`${label} must be a plain object`);
    return false;
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    errors.push(`${label} fields must exactly match: ${fields.join(', ')}`);
  }
  return true;
}

function validateWorkflow(workflow) {
  const errors = [];
  if (!exact(workflow, WORKFLOW_FIELDS, 'workflow', errors)) return errors;
  if (workflow.schema_version !== WORKFLOW_SCHEMA) errors.push(`schema_version must be ${WORKFLOW_SCHEMA}`);
  const operationErrors = operations.validateOperationSpec(workflow.operation);
  errors.push(...operationErrors.map((error) => `operation: ${error}`));
  if (typeof workflow.operation?.operation_id === 'string'
    && !/^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(workflow.operation.operation_id)) {
    errors.push('operation.operation_id must be safe for generated artifact paths');
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0 || workflow.steps.length > 64) {
    errors.push('steps must contain 1 to 64 entries');
  } else {
    const ids = new Set();
    workflow.steps.forEach((step, index) => {
      const label = `steps[${index}]`;
      if (!exact(step, STEP_FIELDS, label, errors)) return;
      if (typeof step.id !== 'string' || !operations.ID_PATTERN.test(step.id)) errors.push(`${label}.id is invalid`);
      if (ids.has(step.id)) errors.push('step ids must be unique');
      ids.add(step.id);
      if (typeof step.name !== 'string' || !step.name.trim() || /[\r\n]/.test(step.name)) errors.push(`${label}.name must be a safe single-line label`);
      if (!Array.isArray(step.argv) || step.argv.length === 0 || step.argv.length > 64
        || step.argv.some((token) => typeof token !== 'string' || !token || /[\0\r\n]/.test(token))) {
        errors.push(`${label}.argv must be a non-empty content-safe argv array`);
      }
      if (!operations.EVIDENCE_TYPES.includes(step.evidence_type)) errors.push(`${label}.evidence_type is unsupported`);
    });
    if (Array.isArray(workflow.operation?.step_ids)
      && JSON.stringify(workflow.operation.step_ids) !== JSON.stringify(workflow.steps.map((step) => step.id))) {
      errors.push('operation.step_ids must exactly match ordered workflow steps');
    }
  }

  if (exact(workflow.verifier, VERIFIER_FIELDS, 'verifier', errors)) {
    if (!workflow.steps?.some((step) => step.id === workflow.verifier.step_id)) errors.push('verifier.step_id must name a workflow step');
    if (workflow.verifier.required_status !== 'passed') errors.push('verifier.required_status must be passed');
    if (workflow.verifier.missing_evidence_status !== 'unknown') errors.push('verifier.missing_evidence_status must be unknown');
  }
  if (exact(workflow.evidence, EVIDENCE_FIELDS, 'evidence', errors)
    && JSON.stringify(workflow.evidence.states) !== JSON.stringify(TERMINAL_STATES)) {
    errors.push(`evidence.states must preserve ${TERMINAL_STATES.join(', ')}`);
  }
  if (exact(workflow.outcome, OUTCOME_FIELDS, 'outcome', errors)) {
    if (workflow.outcome.failure_status !== 'failed') errors.push('outcome.failure_status must be failed');
    if (workflow.outcome.cancellation_status !== 'unknown') errors.push('outcome.cancellation_status must be unknown');
  }
  if (exact(workflow.receipt, RECEIPT_FIELDS, 'receipt', errors)) {
    const receiptPath = workflow.receipt.path;
    const normalizedReceiptPath = typeof receiptPath === 'string' ? receiptPath.replace(/\\/g, '/') : '';
    if (typeof receiptPath !== 'string' || path.isAbsolute(receiptPath)
      || receiptPath.replace(/\\/g, '/').includes('../')
      || !/^\.planning\/receipts\/[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/.test(normalizedReceiptPath)
      || normalizedReceiptPath.includes('//')) {
      errors.push('receipt.path must be a contained path under .planning/receipts/');
    }
    if (typeof workflow.receipt.issuer_id !== 'string' || !operations.ID_PATTERN.test(workflow.receipt.issuer_id)) {
      errors.push('receipt.issuer_id is invalid');
    }
  }
  if (!Array.isArray(workflow.required_capabilities) || workflow.required_capabilities.length === 0
    || new Set(workflow.required_capabilities).size !== workflow.required_capabilities.length) {
    errors.push('required_capabilities must be a non-empty unique array');
  } else {
    for (const capability of workflow.required_capabilities) {
      if (!KNOWN_CAPABILITIES.includes(capability)) errors.push(`unknown required capability: ${capability}`);
    }
  }
  return errors;
}

function assertValidWorkflow(workflow) {
  const errors = validateWorkflow(workflow);
  if (errors.length) throw new TypeError(`Invalid workflow: ${errors.join('; ')}`);
  return workflow;
}

function buildCoreContract(workflow) {
  assertValidWorkflow(workflow);
  return Object.freeze({
    protocol_version: workflow.operation.protocol_version,
    operation_id: workflow.operation.operation_id,
    operation_digest: operations.sha256Digest(workflow.operation),
    workflow_digest: operations.sha256Digest(workflow),
    step_ids: workflow.steps.map((step) => step.id),
    step_commands_digest: operations.sha256Digest(workflow.steps.map((step) => ({ id: step.id, argv: step.argv }))),
    verifier: { ...workflow.verifier },
    evidence_states: [...workflow.evidence.states],
    failure_status: workflow.outcome.failure_status,
    cancellation_status: workflow.outcome.cancellation_status,
    receipt_path: workflow.receipt.path.replace(/\\/g, '/'),
  });
}

function buildSemanticContract(workflow, core) {
  return Object.freeze({
    schema_version: 1,
    operation_id: core.operation_id,
    step_ids: [...core.step_ids],
    step_commands_digest: core.step_commands_digest,
    verifier: { ...core.verifier },
    evidence: {
      states: [...core.evidence_states],
      required_status: workflow.verifier.required_status,
      missing_status: workflow.verifier.missing_evidence_status,
    },
    outcomes: {
      success: workflow.verifier.required_status,
      failure: core.failure_status,
      cancellation: core.cancellation_status,
    },
    receipt: {
      path: core.receipt_path,
      required_for_pass: true,
      missing_status: workflow.verifier.missing_evidence_status,
    },
  });
}

function verifySemanticInspection(workflow, core, inspection, targetId) {
  const expected = buildSemanticContract(workflow, core);
  const checks = {
    core_contract: inspection && operations.canonicalSerialize(inspection.core_contract)
      === operations.canonicalSerialize(core),
    ordered_steps: inspection && operations.canonicalSerialize(inspection.step_ids)
      === operations.canonicalSerialize(core.step_ids),
    argv_digest: inspection && inspection.step_commands_digest === core.step_commands_digest,
    verifier: inspection && operations.canonicalSerialize(inspection.verifier)
      === operations.canonicalSerialize(core.verifier),
    evidence_mapping: inspection && operations.canonicalSerialize(inspection.semantic_contract?.evidence)
      === operations.canonicalSerialize(expected.evidence),
    outcome_mapping: inspection && operations.canonicalSerialize(inspection.semantic_contract?.outcomes)
      === operations.canonicalSerialize(expected.outcomes),
    receipt_mapping: inspection && operations.canonicalSerialize(inspection.semantic_contract?.receipt)
      === operations.canonicalSerialize(expected.receipt),
    semantic_contract: inspection && operations.canonicalSerialize(inspection.semantic_contract)
      === operations.canonicalSerialize(expected),
    executable_guard: targetId !== 'github-actions' || inspection.executable_guard === true,
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`Target ${targetId} artifact semantic proof failed: ${failed.join(', ')}`);
  return Object.freeze({
    status: 'passed',
    checks: Object.keys(checks),
    artifact_digest: inspection.artifact_digest,
    evidence_mapping: expected.evidence,
    outcome_mapping: expected.outcomes,
    receipt_mapping: expected.receipt,
  });
}

function targetById(targetId) {
  const targets = {
    local: require('../../runtimes/local/workflow-target'),
    codex: require('../../runtimes/codex/workflow-target'),
    'github-actions': require('../../runtimes/github-actions/workflow-target'),
  };
  const target = targets[targetId];
  if (!target) throw new Error(`Unknown workflow target: ${targetId}`);
  return target;
}

function compileWorkflow(workflow, targetId) {
  assertValidWorkflow(workflow);
  const target = targetById(targetId);
  const unsupported = workflow.required_capabilities.filter((capability) => !target.capabilities.includes(capability));
  if (unsupported.length) throw new Error(`Target ${target.id} does not support: ${unsupported.join(', ')}`);
  const core = buildCoreContract(workflow);
  const semantics = buildSemanticContract(workflow, core);
  const projection = target.compile({ workflow, core, semantics, compilerVersion: COMPILER_VERSION });
  const semanticProof = verifySemanticInspection(workflow, core, target.inspect(projection.content), target.id);
  return Object.freeze({
    target: target.id,
    output_path: projection.output_path,
    media_type: projection.media_type,
    content: projection.content,
    core_contract: core,
    semantic_proof: semanticProof,
  });
}

function verifyCompiledArtifact(workflow, targetId, content) {
  assertValidWorkflow(workflow);
  const target = targetById(targetId);
  const core = buildCoreContract(workflow);
  return verifySemanticInspection(workflow, core, target.inspect(content), target.id);
}

module.exports = Object.freeze({
  COMPILER_VERSION,
  CORE_FIELDS,
  KNOWN_CAPABILITIES,
  TERMINAL_STATES,
  WORKFLOW_SCHEMA,
  assertValidWorkflow,
  buildCoreContract,
  buildSemanticContract,
  compileWorkflow,
  validateWorkflow,
  verifyCompiledArtifact,
});

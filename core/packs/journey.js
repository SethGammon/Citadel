'use strict';

const fs = require('fs');
const path = require('path');
const operations = require('../operations');
const { resolveTarget } = require('../distribution/fs-safety');
const { contentDigest } = require('./digest');
const { loadPack } = require('./manifest');

function atomicJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, filePath);
}

function canonicalTime(value) {
  const timestamp = value || new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    throw new TypeError('Journey timestamp must be canonical ISO');
  }
  return timestamp;
}

function safeId(value, label) {
  if (typeof value !== 'string' || !operations.ID_PATTERN.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function journeyPaths(projectRoot, runId) {
  const operationRoot = resolveTarget(projectRoot, `.planning/operations/${runId}`, 'journey operation');
  return Object.freeze({
    operationRoot,
    spec: path.join(operationRoot, 'operation.json'),
    run: path.join(operationRoot, 'run.json'),
    evidence: path.join(operationRoot, 'evidence.json'),
    metadata: path.join(operationRoot, 'pack.json'),
  });
}

function createPackJourney(options) {
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot));
  const loaded = loadPack(path.resolve(options.packRoot), { projectRoot: options.sourceProjectRoot });
  const pack = { manifest: loaded.manifest, workflow: loaded.workflow, digest: contentDigest(loaded.root) };
  if (!pack.manifest.runtimes.includes(options.runtime)) throw new Error(`Pack does not support runtime: ${options.runtime}`);
  const createdAt = canonicalTime(options.createdAt);
  const runId = safeId(options.runId || `run-${pack.manifest.name}-${Date.now()}`, 'runId');
  const operationId = safeId(`operation-${pack.manifest.name}`, 'operationId');
  const operation = {
    protocol_version: operations.PROTOCOL_VERSION,
    kind: operations.CONTRACT_KINDS.OPERATION_SPEC,
    operation_id: operationId,
    title: pack.manifest.description,
    objective_digest: operations.sha256Digest({ pack: pack.manifest.id, version: pack.manifest.version,
      workflow: pack.workflow }),
    step_ids: pack.workflow.steps.map((step) => step.id),
    policy_digests: [operations.sha256Digest(pack.manifest.permissions)],
    created_at: createdAt,
  };
  operations.assertValidOperationContract(operation);
  const run = {
    protocol_version: operations.PROTOCOL_VERSION,
    kind: operations.CONTRACT_KINDS.OPERATION_RUN,
    run_id: runId,
    operation_id: operationId,
    spec_digest: operations.sha256Digest(operation),
    status: 'running',
    started_at: createdAt,
    completed_at: null,
    intent_ids: [],
    step_attempt_ids: [],
  };
  operations.assertValidOperationContract(run);
  const metadata = Object.freeze({ schema_version: 1, pack_id: pack.manifest.id,
    pack_version: pack.manifest.version, pack_digest: pack.digest, runtime: options.runtime,
    workflow_id: pack.workflow.id });
  const paths = journeyPaths(projectRoot, runId);
  if (options.write !== false) {
    atomicJson(paths.spec, operation);
    atomicJson(paths.run, run);
    atomicJson(paths.metadata, metadata);
  }
  return Object.freeze({ operation, run, metadata, paths });
}

function resultStatus(evidence) {
  if (evidence.some((item) => item.status === 'failed')) return 'failed';
  if (evidence.some((item) => item.status === 'blocked')) return 'blocked';
  if (evidence.length === 0 || evidence.some((item) => item.status !== 'passed')) return 'unknown';
  return 'passed';
}

function evidenceFor(run, operation, inputs, completedAt) {
  const byStep = new Map((inputs || []).map((item) => [item.step_id, item]));
  return operation.step_ids.map((stepId, index) => {
    const input = byStep.get(stepId) || { step_id: stepId, status: 'unknown', evidence_type: 'other', artifact_digest: null };
    if (!operations.TERMINAL_STATUSES.includes(input.status)) throw new TypeError(`Invalid evidence status for ${stepId}`);
    if (!operations.EVIDENCE_TYPES.includes(input.evidence_type)) throw new TypeError(`Invalid evidence type for ${stepId}`);
    if (input.status === 'passed' && !operations.DIGEST_PATTERN.test(input.artifact_digest || '')) {
      throw new TypeError(`Passed evidence for ${stepId} requires artifact_digest`);
    }
    const attemptId = `attempt-${stepId}-${index + 1}`;
    const envelope = {
      protocol_version: operations.PROTOCOL_VERSION,
      kind: operations.CONTRACT_KINDS.EVIDENCE_ENVELOPE,
      evidence_id: `evidence-${stepId}-${index + 1}`,
      run_id: run.run_id,
      step_attempt_id: attemptId,
      evidence_type: input.evidence_type,
      status: input.status,
      subject_digest: operations.sha256Digest({ operation_id: operation.operation_id, step_id: stepId }),
      artifact_digest: input.status === 'passed' ? input.artifact_digest : null,
      recorded_at: completedAt,
      redacted: true,
    };
    operations.assertValidOperationContract(envelope);
    return envelope;
  });
}

function completePackJourney(options) {
  const projectRoot = fs.realpathSync(path.resolve(options.projectRoot));
  const runId = safeId(options.runId, 'runId');
  const paths = journeyPaths(projectRoot, runId);
  const operation = JSON.parse(fs.readFileSync(paths.spec, 'utf8'));
  const currentRun = JSON.parse(fs.readFileSync(paths.run, 'utf8'));
  operations.assertValidOperationContract(operation);
  operations.assertValidOperationContract(currentRun);
  if (currentRun.status !== 'running') throw new Error('Journey is not running');
  const completedAt = canonicalTime(options.completedAt);
  const evidence = evidenceFor(currentRun, operation, options.evidence, completedAt);
  const status = resultStatus(evidence);
  const run = { ...currentRun, status, completed_at: completedAt,
    step_attempt_ids: evidence.map((item) => item.step_attempt_id) };
  operations.assertValidOperationContract(run);
  const receipt = operations.createExecutionReceipt({ operation, run, evidence,
    issuedAt: completedAt, issuerId: options.issuerId || 'issuer-local' });
  const envelope = options.privateKey
    ? operations.signExecutionReceipt(receipt, options.privateKey)
    : operations.unsignedReceiptEnvelope(receipt);
  const receiptPath = resolveTarget(projectRoot, `.planning/receipts/${receipt.receipt_id}.json`, 'journey receipt');
  atomicJson(paths.run, run);
  atomicJson(paths.evidence, evidence);
  atomicJson(receiptPath, envelope);
  const handoffPath = resolveTarget(projectRoot, `.planning/handoffs/${runId}.md`, 'journey handoff');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, [
    '---HANDOFF---',
    `- Pack journey: ${runId}`,
    `- Status: ${receipt.status}`,
    `- Evidence: ${evidence.filter((item) => item.status === 'passed').length}/${evidence.length} passed`,
    `- Receipt: ${path.relative(projectRoot, receiptPath).replace(/\\/g, '/')}`,
    '---',
    '',
  ].join('\n'), 'utf8');
  return Object.freeze({ operation, run, evidence, receipt, envelope, receiptPath, handoffPath });
}

module.exports = Object.freeze({ completePackJourney, createPackJourney, evidenceFor, journeyPaths, resultStatus });

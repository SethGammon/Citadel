'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const operations = require('../operations');
const { platformInvocation } = require('./launcher');
const { runtimeInvocationForProfile, synthesizeLegacyExecutors } = require('./executor-profiles');

function runtimeInvocation(runtime) {
  if (runtime === 'claude') return { command: 'claude', args: ['--print', '--output-format', 'json', '--permission-mode', 'acceptEdits'] };
  if (runtime === 'codex') return { command: 'codex', args: ['exec', '--json', '--sandbox', 'workspace-write', '--ignore-user-config', '-'] };
  throw new TypeError(`Unsupported fork runtime: ${runtime}`);
}

function legacyProfileFor(runtime) {
  return synthesizeLegacyExecutors([runtime])[0];
}

function safeSpawn(command, args, options = {}) {
  if (typeof command !== 'string' || !command || /[\r\n\0]/.test(command)) throw new TypeError('Executable is invalid');
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || /[\r\n\0]/.test(arg))) throw new TypeError('Executable arguments are invalid');
  return (options.spawn || spawnSync)(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 30 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: options.env || process.env,
    windowsVerbatimArguments: options.windowsVerbatimArguments === true,
  });
}

/** Spawn a canonical invocation, resolving the executable per platform first. */
function spawnInvocation(invocation, options = {}) {
  const resolved = platformInvocation(invocation, { platform: options.platform, env: options.env });
  return safeSpawn(resolved.command, resolved.args, {
    ...options,
    windowsVerbatimArguments: resolved.windowsVerbatimArguments,
  });
}

function positiveNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function claudeObservation(stdout) {
  let payload;
  try { payload = JSON.parse(stdout); } catch (_error) { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const usage = payload.modelUsage && typeof payload.modelUsage === 'object' ? Object.keys(payload.modelUsage) : [];
  const model = typeof payload.model === 'string' && payload.model ? payload.model
    : usage.length === 1 ? usage[0] : null;
  const cost = positiveNumber(payload.total_cost_usd);
  const tokens = payload.usage && typeof payload.usage === 'object'
    ? positiveNumber(Number(payload.usage.input_tokens) + Number(payload.usage.output_tokens)) : null;
  return {
    model,
    cost: cost === null ? null : { amount: cost, unit: 'usd', source: 'claude-json' },
    duration_ms: positiveNumber(payload.duration_ms),
    tokens,
    source: 'claude-json',
  };
}

function codexObservation(stdout) {
  let model = null;
  let tokens = null;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch (_error) { continue; }
    if (!event || typeof event !== 'object') continue;
    const body = event.msg && typeof event.msg === 'object' ? event.msg : event;
    if (typeof body.model === 'string' && body.model) model = body.model;
    const usage = body.info && typeof body.info === 'object' ? body.info.total_token_usage : null;
    if (usage && typeof usage === 'object') {
      const total = positiveNumber(Number(usage.total_tokens));
      if (total !== null) tokens = total;
    }
  }
  if (model === null && tokens === null) return null;
  return { model, cost: null, duration_ms: null, tokens, source: 'codex-jsonl' };
}

/**
 * Observed identity and usage are only ever read from a runtime's own declared
 * machine-readable output. Anything else stays unknown, never inferred from the
 * request and never coerced to zero.
 */
function observeRuntime(runtime, agent) {
  if (!agent || agent.error || agent.status !== 0) return null;
  const parsed = runtime === 'claude' ? claudeObservation(agent.stdout || '')
    : runtime === 'codex' ? codexObservation(agent.stdout || '') : null;
  if (!parsed) return null;
  return { ...parsed, trusted: true };
}

function instructionFor(fork, objective) {
  if (operations.sha256Digest({ objective }) !== fork.shared.objective_digest) throw Object.assign(new Error('Objective does not match fork contract'), { code: 'FORK_OBJECTIVE_MISMATCH' });
  return [
    'Execute the Citadel operation in this isolated worktree.',
    '',
    `Objective: ${objective}`,
    '',
    `Operation ID: ${fork.operation.operation_id}`,
    `Required steps: ${fork.operation.step_ids.join(', ')}`,
    'Stay within this worktree. Do not push, publish, deploy, or mutate external systems.',
    'Complete the repository work and leave all changes in this worktree for independent verification.',
  ].join('\n');
}

function receiptFor(options) {
  const completedAt = options.completedAt;
  const passed = options.status === 'passed';
  const attempts = options.fork.operation.step_ids.map((stepId, index) => `attempt-${options.branch.runtime}-${index + 1}`);
  const run = {
    protocol_version: operations.PROTOCOL_VERSION,
    kind: operations.CONTRACT_KINDS.OPERATION_RUN,
    run_id: options.branch.run_id,
    operation_id: options.fork.operation.operation_id,
    spec_digest: operations.sha256Digest(options.fork.operation),
    status: options.status,
    started_at: options.startedAt,
    completed_at: completedAt,
    intent_ids: [],
    step_attempt_ids: attempts,
  };
  const artifactDigest = passed ? operations.sha256Digest({
    agent_output: options.agentOutputDigest,
    verifier_output: options.verifierOutputDigest,
    diff: options.diffSummary.digest,
  }) : null;
  const evidence = options.fork.operation.step_ids.map((stepId, index) => ({
    protocol_version: operations.PROTOCOL_VERSION,
    kind: operations.CONTRACT_KINDS.EVIDENCE_ENVELOPE,
    evidence_id: `evidence-${options.branch.runtime}-${index + 1}`,
    run_id: run.run_id,
    step_attempt_id: attempts[index],
    evidence_type: 'test',
    status: options.status,
    subject_digest: operations.requiredStepSubject(options.fork.operation, stepId),
    artifact_digest: artifactDigest,
    recorded_at: completedAt,
    redacted: true,
  }));
  const receipt = operations.createExecutionReceipt({ operation: options.fork.operation, run, evidence,
    issuedAt: completedAt, issuerId: `issuer-${options.fork.fork_id}` });
  const envelope = operations.signExecutionReceipt(receipt, options.signingKey);
  const publicKey = crypto.createPublicKey(options.signingKey);
  const verification = operations.verifyExecutionReceipt(envelope, { publicKey });
  return { envelope, verification, evidence };
}

function runRuntimeBranch(options) {
  const startedAt = options.startedAt || new Date().toISOString();
  const startedMs = Date.parse(startedAt);
  const profile = options.profile || legacyProfileFor(options.branch.runtime);
  const invocation = options.invocation || runtimeInvocationForProfile(profile);
  const instruction = instructionFor(options.fork, options.objective);
  const agent = spawnInvocation(invocation, { spawn: options.spawn, cwd: options.worktree,
    input: instruction, timeoutMs: options.timeoutMs, env: options.env });
  const agentPassed = !agent.error && agent.status === 0;
  let verifier = { status: 1, stdout: '', stderr: 'Agent execution failed before verification.' };
  if (agentPassed) {
    verifier = safeSpawn(options.verifier.command, options.verifier.args || [], { spawn: options.spawn,
      cwd: options.worktree, timeoutMs: options.verifier.timeout_ms || options.timeoutMs, env: options.env });
  }
  const passed = agentPassed && !verifier.error && verifier.status === 0;
  const completedAt = options.completedAt || new Date().toISOString();
  const diffSummary = options.worktreeProvider.diffSummary(options.worktree, options.branch.base_revision);
  const observation = observeRuntime(profile.runtime, agent);
  const result = receiptFor({
    fork: options.fork,
    branch: options.branch,
    status: passed ? 'passed' : 'failed',
    startedAt,
    completedAt,
    agentOutputDigest: operations.sha256Digest({ stdout: agent.stdout || '', stderr: agent.stderr || '', status: agent.status }),
    verifierOutputDigest: operations.sha256Digest({ stdout: verifier.stdout || '', stderr: verifier.stderr || '', status: verifier.status }),
    diffSummary,
    signingKey: options.signingKey,
  });
  return {
    status: passed ? 'passed' : 'failed',
    started_at: startedAt,
    completed_at: completedAt,
    receipt_digest: result.envelope.receipt_digest,
    receipt_envelope: result.envelope,
    evidence_summary: {
      status: result.envelope.receipt.status,
      required: options.fork.operation.step_ids.length,
      present: result.evidence.filter((item) => item.status === 'passed').length,
      receipt_verified: result.verification.status === 'verified',
      score: null,
      score_max: null,
    },
    diff_summary: diffSummary,
    duration_ms: Math.max(0, Date.parse(completedAt) - startedMs),
    cost: observation && observation.cost ? observation.cost : null,
    failure_code: passed ? null : agentPassed ? 'VERIFIER_FAILED' : 'RUNTIME_FAILED',
    observation,
  };
}

function generateSigningKey() {
  const pair = crypto.generateKeyPairSync('ed25519');
  return pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function loadVerifier(workflowPath) {
  const workflow = JSON.parse(fs.readFileSync(path.resolve(workflowPath), 'utf8'));
  if (!workflow || typeof workflow !== 'object' || !workflow.verifier || typeof workflow.verifier.command !== 'string'
    || !Array.isArray(workflow.verifier.args) || workflow.verifier.args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('Workflow must define verifier.command and verifier.args');
  }
  return { command: workflow.verifier.command, args: workflow.verifier.args,
    timeout_ms: Number.isInteger(workflow.verifier.timeout_ms) ? workflow.verifier.timeout_ms : undefined };
}

module.exports = Object.freeze({
  generateSigningKey,
  instructionFor,
  legacyProfileFor,
  loadVerifier,
  observeRuntime,
  receiptFor,
  runRuntimeBranch,
  runtimeInvocation,
  safeSpawn,
  spawnInvocation,
});

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const operations = require('../operations');

function runtimeInvocation(runtime) {
  if (runtime === 'claude') return { command: 'claude', args: ['--print', '--output-format', 'json', '--permission-mode', 'acceptEdits'] };
  if (runtime === 'codex') return { command: 'codex', args: ['exec', '--json', '--sandbox', 'workspace-write', '--ignore-user-config', '-'] };
  throw new TypeError(`Unsupported fork runtime: ${runtime}`);
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
  });
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
  const invocation = options.invocation || runtimeInvocation(options.branch.runtime);
  const instruction = instructionFor(options.fork, options.objective);
  const agent = safeSpawn(invocation.command, invocation.args, { spawn: options.spawn, cwd: options.worktree,
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
    cost: null,
    failure_code: passed ? null : agentPassed ? 'VERIFIER_FAILED' : 'RUNTIME_FAILED',
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

module.exports = Object.freeze({ generateSigningKey, instructionFor, loadVerifier, receiptFor, runRuntimeBranch, runtimeInvocation, safeSpawn });

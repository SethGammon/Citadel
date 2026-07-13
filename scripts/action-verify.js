#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const operations = require('../core/operations');
const { compileWorkflow } = require('../core/operations/compiler');

const TERMINAL = Object.freeze(['passed', 'failed', 'blocked', 'unknown']);
const WORKFLOW_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function contained(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, candidate);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

function realContained(root, candidate, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const rootReal = fsImpl.realpathSync(path.resolve(root));
  const resolved = path.resolve(root, candidate);
  if (options.requireExisting && !fsImpl.existsSync(resolved)) return false;
  let existing = resolved;
  while (!fsImpl.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return false;
    existing = parent;
  }
  const existingReal = fsImpl.realpathSync(existing);
  return existingReal === rootReal || existingReal.startsWith(`${rootReal}${path.sep}`);
}

function validateRelative(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)
    || value.split(/[\\/]+/).includes('..') || /[\0\r\n]/.test(value)) {
    throw Object.assign(new Error(`${label} must be a contained relative path`), { code: 'INPUT_INVALID' });
  }
  return value.replace(/\\/g, '/');
}

function parseBoolean(value) {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  throw Object.assign(new Error('strict must be true or false'), { code: 'INPUT_INVALID' });
}

function validateInputs(raw, options = {}) {
  const workspace = path.resolve(options.workspace || process.cwd());
  const fsImpl = options.fsImpl || fs;
  const workflow = raw.workflow || 'verify-change';
  if (!WORKFLOW_ID.test(workflow)) throw Object.assign(new Error('workflow identifier is invalid'), { code: 'INPUT_INVALID' });
  const evidencePath = validateRelative(raw.evidencePath || '.planning/action-evidence', 'evidence-path');
  const workingDirectory = validateRelative(raw.workingDirectory || '.', 'working-directory');
  if (!contained(workspace, evidencePath) || !contained(workspace, workingDirectory)
    || !realContained(workspace, evidencePath, { fsImpl })
    || !realContained(workspace, workingDirectory, { fsImpl, requireExisting: true })) {
    throw Object.assign(new Error('input path escapes the workspace'), { code: 'INPUT_INVALID' });
  }
  return Object.freeze({
    workflow,
    evidencePath,
    strict: parseBoolean(raw.strict ?? 'true'),
    workspace,
    workingDirectory: path.resolve(workspace, workingDirectory),
  });
}

function npmCli() {
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function runArgv(argv, cwd, spawn = spawnSync) {
  let executable = argv[0];
  let args = argv.slice(1);
  if (process.platform === 'win32' && executable === 'npm' && fs.existsSync(npmCli())) {
    executable = process.execPath;
    args = [npmCli(), ...args];
  }
  const result = spawn(executable, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20 * 60 * 1000,
  });
  return Object.freeze({
    status: result.error || result.status === null ? 'unknown' : result.status === 0 ? 'passed' : 'failed',
    exit_code: Number.isInteger(result.status) ? result.status : null,
    stdout_digest: operations.sha256Digest(String(result.stdout || '')),
    stderr_digest: operations.sha256Digest(String(result.stderr || '')),
  });
}

function safeRunId(env = process.env) {
  const source = `${env.GITHUB_RUN_ID || 'local'}-${env.GITHUB_RUN_ATTEMPT || '1'}`
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `run-action-${source || 'local-1'}`;
}

function renderSummary(result) {
  const lines = [
    '# Citadel verification',
    '',
    `Status: **${result.status}**`,
    `Workflow: \`${result.workflow}\``,
    `Receipt: \`${result.receipt_path || 'unavailable'}\``,
    '',
    '| Step | Status | Exit code |',
    '|---|---|---:|',
  ];
  for (const step of result.steps || []) lines.push(`| ${step.id} | ${step.status} | ${step.exit_code ?? 'unknown'} |`);
  if (result.reason_code) lines.push('', `Reason: \`${result.reason_code}\``);
  return `${lines.join('\n')}\n`;
}

function writeOutput(file, name, value) {
  if (!file) return;
  fs.appendFileSync(file, `${name}=${String(value || '')}\n`, 'utf8');
}

function publishActionResult(result, env = process.env) {
  writeOutput(env.GITHUB_OUTPUT, 'status', result.status);
  writeOutput(env.GITHUB_OUTPUT, 'receipt-path', result.receipt_path || '');
  writeOutput(env.GITHUB_OUTPUT, 'summary-path', result.summary_path || '');
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, renderSummary(result), 'utf8');
}

function executeVerification(rawInputs, options = {}) {
  const inputs = validateInputs(rawInputs, options);
  const fsImpl = options.fsImpl || fs;
  const now = options.now || (() => new Date().toISOString());
  const workflowPath = path.join(inputs.workspace, 'workflows', `${inputs.workflow}.citadel.json`);
  if (!fsImpl.existsSync(workflowPath)) throw Object.assign(new Error('workflow is not checked in'), { code: 'WORKFLOW_NOT_FOUND' });
  const workflow = JSON.parse(fsImpl.readFileSync(workflowPath, 'utf8'));
  const compiled = compileWorkflow(workflow, 'local');
  const runId = safeRunId(options.env);
  const startedAt = now();
  const steps = [];
  const evidence = [];
  for (const step of workflow.steps) {
    const outcome = (options.runArgv || runArgv)(step.argv, inputs.workingDirectory, options.spawn);
    const recordedAt = now();
    const attemptId = `attempt-${step.id}-1`;
    steps.push({ id: step.id, status: outcome.status, exit_code: outcome.exit_code });
    evidence.push({
      protocol_version: operations.PROTOCOL_VERSION,
      kind: operations.CONTRACT_KINDS.EVIDENCE_ENVELOPE,
      evidence_id: `evidence-${step.id}`,
      run_id: runId,
      step_attempt_id: attemptId,
      evidence_type: step.evidence_type,
      status: outcome.status,
      subject_digest: operations.sha256Digest({ operation_id: workflow.operation.operation_id, step_id: step.id }),
      artifact_digest: outcome.status === 'passed' ? operations.sha256Digest(outcome) : null,
      recorded_at: recordedAt,
      redacted: true,
    });
    if (outcome.status !== 'passed') break;
  }
  const status = steps.some((step) => step.status === 'failed') ? 'failed'
    : steps.some((step) => step.status === 'unknown') ? 'unknown'
      : steps.length === workflow.steps.length ? 'passed' : 'blocked';
  const completedAt = now();
  const run = {
    protocol_version: operations.PROTOCOL_VERSION,
    kind: operations.CONTRACT_KINDS.OPERATION_RUN,
    run_id: runId,
    operation_id: workflow.operation.operation_id,
    spec_digest: compiled.core_contract.operation_digest,
    status,
    started_at: startedAt,
    completed_at: completedAt,
    intent_ids: [],
    step_attempt_ids: steps.map((step) => `attempt-${step.id}-1`),
  };
  const receipt = operations.createExecutionReceipt({
    operation: workflow.operation,
    run,
    evidence,
    issuedAt: completedAt,
    issuerId: 'issuer-github-action',
  });
  const envelope = operations.unsignedReceiptEnvelope(receipt);
  const outputDirectory = path.resolve(inputs.workspace, inputs.evidencePath);
  fsImpl.mkdirSync(outputDirectory, { recursive: true });
  const receiptPath = path.join(outputDirectory, `${inputs.workflow}.receipt.json`);
  const summaryPath = path.join(outputDirectory, `${inputs.workflow}.summary.md`);
  const result = {
    status,
    workflow: inputs.workflow,
    strict: inputs.strict,
    steps,
    receipt_path: path.relative(inputs.workspace, receiptPath).replace(/\\/g, '/'),
    summary_path: path.relative(inputs.workspace, summaryPath).replace(/\\/g, '/'),
    reason_code: status === 'passed' ? 'VERIFICATION_PASSED'
      : status === 'failed' ? 'VERIFIER_FAILED' : status === 'unknown' ? 'VERIFIER_OUTCOME_UNKNOWN' : 'VERIFICATION_BLOCKED',
  };
  fsImpl.writeFileSync(receiptPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  fsImpl.writeFileSync(summaryPath, renderSummary(result), 'utf8');
  return Object.freeze(result);
}

function environmentInputs(env = process.env) {
  return {
    workflow: env.INPUT_WORKFLOW,
    evidencePath: env['INPUT_EVIDENCE-PATH'],
    strict: env.INPUT_STRICT,
    workingDirectory: env['INPUT_WORKING-DIRECTORY'],
  };
}

function main(env = process.env) {
  let result;
  let strict = true;
  try {
    strict = parseBoolean(env.INPUT_STRICT || 'true');
    result = executeVerification(environmentInputs(env), { workspace: env.GITHUB_WORKSPACE || process.cwd(), env });
  } catch (error) {
    result = Object.freeze({
      status: 'blocked', workflow: env.INPUT_WORKFLOW || 'verify-change', strict,
      steps: [], receipt_path: null, summary_path: null,
      reason_code: error.code || 'ACTION_VERIFY_ERROR',
    });
  }
  publishActionResult(result, env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = strict && result.status !== 'passed' ? 1 : 0;
  return result;
}

if (require.main === module) main();

module.exports = Object.freeze({
  TERMINAL,
  contained,
  environmentInputs,
  executeVerification,
  main,
  parseBoolean,
  publishActionResult,
  realContained,
  renderSummary,
  runArgv,
  validateInputs,
});

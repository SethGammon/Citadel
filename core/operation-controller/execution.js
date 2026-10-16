'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { COST_LENSES, RUNTIME_SETTING_FIELDS, digest, exactOptional, runtimeSettings, validateCatalog, validateCosts, validateHistory, validateRequest } = require('./contracts');
const { nextAction, routeOperation } = require('./controller');
const { safeEnvironment } = require('../runtime/environment');

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWorkspacePath(workspaceRoot, relative, label) {
  const resolved = path.resolve(workspaceRoot, relative);
  if (!contained(workspaceRoot, resolved)) throw new TypeError(`${label} must stay inside the workspace root`);
  if (!fs.existsSync(resolved)) throw new TypeError(`${label} does not exist: ${resolved}`);
  return resolved;
}

function parseAdapterResult(stdout) {
  let value;
  try {
    value = JSON.parse(String(stdout || '').trim());
  } catch (_error) {
    const error = new Error('adapter stdout was not one JSON object');
    error.code = 'MALFORMED_OUTPUT';
    throw error;
  }
  const fields = ['schema', 'status', 'failure_code', 'output', 'observations'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(fields.sort())) {
    throw Object.assign(new Error('adapter result fields do not match the protocol'), { code: 'MALFORMED_OUTPUT' });
  }
  if (value.schema !== 1 || !['completed', 'failed'].includes(value.status)) throw Object.assign(new Error('adapter result status is invalid'), { code: 'MALFORMED_OUTPUT' });
  if (value.failure_code !== null && typeof value.failure_code !== 'string') throw Object.assign(new Error('adapter failure_code is invalid'), { code: 'MALFORMED_OUTPUT' });
  if (typeof value.output !== 'string') throw Object.assign(new Error('adapter output is invalid'), { code: 'MALFORMED_OUTPUT' });
  const observedFields = ['model', 'topology', 'tools', 'tool_calls', 'usage', 'costs'];
  const sourceFields = RUNTIME_SETTING_FIELDS.map((field) => `${field}_source`);
  try {
    exactOptional(value.observations, observedFields, [...RUNTIME_SETTING_FIELDS, ...sourceFields], 'adapter observations');
    runtimeSettings(value.observations, 'adapter observations');
    for (const field of sourceFields) {
      const source = value.observations[field];
      if (source !== undefined && source !== null && (typeof source !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(source))) {
        throw new TypeError(`observed ${field} is invalid`);
      }
    }
  } catch (error) {
    error.code = 'MALFORMED_OUTPUT';
    throw error;
  }
  const observations = value.observations;
  if (observations.model !== null && typeof observations.model !== 'string') throw Object.assign(new Error('observed model is invalid'), { code: 'MALFORMED_OUTPUT' });
  if (observations.topology !== null && typeof observations.topology !== 'string') throw Object.assign(new Error('observed topology is invalid'), { code: 'MALFORMED_OUTPUT' });
  for (const field of ['tools', 'tool_calls']) {
    if (!Array.isArray(observations[field]) || observations[field].some((item) => typeof item !== 'string')) {
      throw Object.assign(new Error(`observed ${field} is invalid`), { code: 'MALFORMED_OUTPUT' });
    }
  }
  if (!observations.usage || typeof observations.usage !== 'object' || Array.isArray(observations.usage)) throw Object.assign(new Error('observed usage is invalid'), { code: 'MALFORMED_OUTPUT' });
  try { validateCosts(observations.costs, 'adapter.observations.costs'); } catch (error) { error.code = 'MALFORMED_OUTPUT'; throw error; }
  return value;
}

function reconcile(plan, request, result) {
  const mismatchCodes = [];
  const unknownCodes = [];
  const observed = result.observations;
  if (plan.model !== null && observed.model === null) unknownCodes.push('MODEL_NOT_OBSERVED');
  else if (plan.model !== null && observed.model !== plan.model) mismatchCodes.push('MODEL_MISMATCH');
  for (const [field, requested] of Object.entries(runtimeSettings(plan))) {
    if (observed[field] == null) unknownCodes.push(`${field.toUpperCase()}_NOT_OBSERVED`);
    else if (observed[field] !== requested) mismatchCodes.push(`${field.toUpperCase()}_MISMATCH`);
  }
  if (observed.topology === null) unknownCodes.push('TOPOLOGY_NOT_OBSERVED');
  else if (observed.topology !== plan.topology) mismatchCodes.push('TOPOLOGY_MISMATCH');
  const observedTools = new Set([...observed.tools, ...observed.tool_calls]);
  for (const tool of observedTools) {
    if (!plan.tools.includes(tool)) mismatchCodes.push('UNPLANNED_TOOL_OBSERVED');
    if (!request.constraints.allowed_tools.includes(tool)) mismatchCodes.push('DISALLOWED_TOOL_OBSERVED');
  }
  for (const tool of request.constraints.required_tools) {
    if (!observed.tool_calls.includes(tool)) mismatchCodes.push('REQUIRED_TOOL_NOT_OBSERVED');
  }
  return Object.freeze({
    status: mismatchCodes.length ? 'failed' : unknownCodes.length ? 'unknown' : 'passed',
    mismatch_codes: [...new Set(mismatchCodes)],
    unknown_codes: [...new Set(unknownCodes)],
  });
}

function executeAdapter({ adapter, plan, request, decision, workspaceRoot, retryCount, spawn = spawnSync, env = process.env, checkpointRegistration }) {
  const input = {
    schema: 1,
    protocol: adapter.protocol,
    operation: request,
    decision_digest: decision.decision_digest,
    plan,
    workspace_root: workspaceRoot,
    retry_count: retryCount,
  };
  const started = Date.now();
  const childEnv = safeEnvironment(adapter.environment_allowlist, env);
  let executable = adapter.executable, args = adapter.args;
  if (checkpointRegistration) {
    // Reconciliation admits Node adapters only. Register this exact process
    // durably before loading adapter code, including before any file effect.
    executable = process.execPath;
    args = ['--require', path.join(__dirname, '../../scripts/operation-register-adapter.js'), ...args];
    childEnv.CITADEL_CHECKPOINT_REGISTRATION = JSON.stringify(checkpointRegistration);
  }
  const result = spawn(executable, args, {
    cwd: workspaceRoot,
    env: childEnv,
    input: `${JSON.stringify(input)}\n`,
    encoding: 'utf8',
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: adapter.timeout_ms,
    maxBuffer: 4 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  if (result.error) {
    const failureCode = result.error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'ADAPTER_LAUNCH_FAILED';
    return { result: null, duration_ms: durationMs, failure_code: failureCode, stderr_digest: digest(String(result.stderr || result.error.message)) };
  }
  if (result.status !== 0) {
    return { result: null, duration_ms: durationMs, failure_code: 'ADAPTER_EXIT_NONZERO', stderr_digest: digest(String(result.stderr || '')) };
  }
  try {
    return { result: parseAdapterResult(result.stdout), duration_ms: durationMs, failure_code: null, stderr_digest: digest(String(result.stderr || '')) };
  } catch (error) {
    return { result: null, duration_ms: durationMs, failure_code: error.code || 'MALFORMED_OUTPUT', stderr_digest: digest(String(result.stderr || error.message)) };
  }
}

function changedWorkspacePaths(workspaceRoot, spawn = spawnSync, env = process.env) {
  const canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  const top = spawn('git', ['rev-parse', '--show-toplevel'], {
    cwd: workspaceRoot, env: safeEnvironment([], env), encoding: 'utf8', shell: false,
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
  });
  if (top.error || top.status !== 0) return { status: 'unknown', paths: [] };
  const repositoryRoot = fs.realpathSync.native(String(top.stdout || '').trim());
  const status = spawn('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], {
    cwd: workspaceRoot, env: safeEnvironment([], env), encoding: 'utf8', shell: false,
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
  });
  if (status.error || status.status !== 0) return { status: 'unknown', paths: [] };
  const paths = [];
  const entries = String(status.stdout || '').split('\0').filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const code = entry.slice(0, 2);
    const candidates = [entry.slice(3)];
    if (code.includes('R') || code.includes('C')) {
      const target = entries[index + 1];
      if (target) { candidates.push(target); index += 1; }
    }
    for (const candidate of candidates) {
      const absolute = path.resolve(repositoryRoot, candidate);
      if (!contained(canonicalWorkspaceRoot, absolute)) continue;
      paths.push(path.relative(canonicalWorkspaceRoot, absolute).replace(/\\/g, '/'));
    }
  }
  return { status: 'known', paths: [...new Set(paths)].sort() };
}

function verifyAttempt({ request, adapterResult, workspaceRoot, spawn = spawnSync, env = process.env }) {
  if (adapterResult?.status !== 'completed') {
    return {
      status: 'failed',
      failure_code: adapterResult?.failure_code || 'ADAPTER_REPORTED_FAILURE',
      evidence: { kind: 'adapter-result', exit_code: null, output_digest: digest(adapterResult?.output || '') },
    };
  }
  if (request.verifier.kind === 'adapter-result') {
    return { status: 'passed', failure_code: null, evidence: { kind: 'adapter-result', exit_code: null, output_digest: digest(adapterResult.output) } };
  }
  const cwd = resolveWorkspacePath(workspaceRoot, request.verifier.cwd, 'verifier cwd');
  const started = Date.now();
  const result = spawn(request.verifier.executable, request.verifier.args, {
    cwd,
    env: safeEnvironment([], env),
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: request.verifier.timeout_ms,
    maxBuffer: 4 * 1024 * 1024,
  });
  const combined = `[stdout]\n${result.stdout || ''}\n[stderr]\n${result.stderr || ''}`;
  if (result.error) {
    return {
      status: result.error.code === 'ETIMEDOUT' ? 'unknown' : 'failed',
      failure_code: result.error.code === 'ETIMEDOUT' ? 'VERIFIER_TIMEOUT' : 'VERIFIER_LAUNCH_FAILED',
      evidence: { kind: 'command', exit_code: null, duration_ms: Date.now() - started, output_digest: digest(combined) },
    };
  }
  if (result.status !== 0) return {
    status: 'failed',
    failure_code: 'VERIFICATION_FAILED',
    evidence: { kind: 'command', exit_code: result.status, duration_ms: Date.now() - started, output_digest: digest(combined), artifact_coverage: 'not-evaluated' },
  };
  const changed = changedWorkspacePaths(workspaceRoot, spawn, env);
  const required = request.verifier.required_changed_paths;
  const coverage = changed.status === 'known' && required.every((requiredPath) => changed.paths.includes(requiredPath));
  if (required.length && changed.status !== 'known') return {
    status: 'unknown', failure_code: 'ARTIFACT_OBSERVATION_FAILED',
    evidence: { kind: 'command', exit_code: 0, duration_ms: Date.now() - started, output_digest: digest(combined), artifact_coverage: 'unknown' },
  };
  return {
    status: coverage ? 'passed' : 'failed',
    failure_code: coverage ? null : 'REQUIRED_ARTIFACT_NOT_CHANGED',
    evidence: {
      kind: 'command', exit_code: 0, duration_ms: Date.now() - started,
      output_digest: digest(combined), artifact_coverage: coverage ? 'passed' : 'failed',
      required_paths_digest: digest(required), changed_paths_digest: digest(changed.paths),
    },
  };
}

function aggregateObservedCosts(attempts) {
  const output = {};
  for (const lens of COST_LENSES) {
    const costs = attempts.map((attempt) => attempt.costs[lens]);
    const unknown = costs.filter((cost) => cost.status === 'unknown');
    output[lens] = unknown.length
      ? { status: 'unknown', amount_usd: null, basis: 'observed', source: `${unknown.length} attempt(s) unknown` }
      : { status: 'known', amount_usd: Number(costs.reduce((sum, cost) => sum + cost.amount_usd, 0).toFixed(6)), basis: 'observed', source: `summed_attempts:${attempts.length}` };
  }
  return output;
}

function telemetryFor(attempt, request) {
  return Object.freeze({
    name: 'citadel.operation.attempt',
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.request.model': attempt.requested_model,
      'gen_ai.response.model': attempt.observed_model,
      'citadel.reasoning_effort.requested': attempt.requested_reasoning_effort ?? null,
      'citadel.reasoning_effort.observed': attempt.observed_reasoning_effort ?? null,
      'citadel.reasoning_effort.source': attempt.reasoning_effort_source ?? null,
      'citadel.service_tier.requested': attempt.requested_service_tier ?? null,
      'citadel.service_tier.observed': attempt.observed_service_tier ?? null,
      'citadel.service_tier.source': attempt.service_tier_source ?? null,
      'citadel.operation.id': request.operation_id,
      'citadel.plan.id': attempt.plan_id,
      'citadel.topology.requested': attempt.requested_topology,
      'citadel.topology.observed': attempt.observed_topology,
      'citadel.verification.status': attempt.completion_status,
      'citadel.control.status': attempt.control_status,
    },
  });
}

function runOperation({ request, catalog, history = [], workspaceRoot, spawn = spawnSync, env = process.env, checkpointRegistration }) {
  validateRequest(request);
  validateCatalog(catalog);
  validateHistory(history);
  const root = path.resolve(workspaceRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new TypeError('workspaceRoot must be an existing directory');
  const decision = routeOperation({ request, catalog, history });
  const plans = new Map(catalog.plans.map((plan) => [plan.plan_id, plan]));
  const attempts = [];
  const retries = new Map();
  let targetPlanId = decision.selected.plan_ids[0];
  let terminal = null;
  while (targetPlanId) {
    const plan = plans.get(targetPlanId);
    const retryCount = retries.get(targetPlanId) || 0;
    const adapter = catalog.adapters[plan.adapter_id];
    const execution = executeAdapter({ adapter, plan, request, decision, workspaceRoot: root, retryCount, spawn, env, checkpointRegistration });
    const adapterResult = execution.result;
    const control = adapterResult ? reconcile(plan, request, adapterResult) : { status: 'unknown', mismatch_codes: [], unknown_codes: ['ADAPTER_OBSERVATION_MISSING'] };
    const verification = adapterResult
      ? verifyAttempt({ request, adapterResult, workspaceRoot: root, spawn, env })
      : { status: 'unknown', failure_code: execution.failure_code, evidence: { kind: 'adapter', exit_code: null, output_digest: execution.stderr_digest } };
    const completionStatus = control.status === 'failed' ? 'failed' : verification.status;
    const failureCode = control.status === 'failed'
      ? control.mismatch_codes[0]
      : verification.failure_code || adapterResult?.failure_code || execution.failure_code;
    const attempt = {
      attempt: attempts.length + 1,
      plan_id: plan.plan_id,
      retry_count: retryCount,
      requested_model: plan.model,
      observed_model: adapterResult?.observations.model ?? null,
      requested_reasoning_effort: plan.reasoning_effort ?? null,
      observed_reasoning_effort: adapterResult?.observations.reasoning_effort ?? null,
      reasoning_effort_source: adapterResult?.observations.reasoning_effort_source ?? null,
      requested_service_tier: plan.service_tier ?? null,
      observed_service_tier: adapterResult?.observations.service_tier ?? null,
      service_tier_source: adapterResult?.observations.service_tier_source ?? null,
      requested_topology: plan.topology,
      observed_topology: adapterResult?.observations.topology ?? null,
      planned_tools: plan.tools,
      observed_tools: adapterResult?.observations.tools || [],
      observed_tool_calls: adapterResult?.observations.tool_calls || [],
      duration_ms: execution.duration_ms,
      completion_status: completionStatus,
      control_status: control.status,
      control_reason_codes: [...control.mismatch_codes, ...control.unknown_codes],
      failure_code: failureCode,
      output_digest: digest(adapterResult?.output || ''),
      evidence: verification.evidence,
      usage: adapterResult?.observations.usage || {},
      costs: adapterResult?.observations.costs || Object.fromEntries(COST_LENSES.map((lens) => [lens, { status: 'unknown', amount_usd: null, basis: 'observed', source: 'adapter result unavailable' }])),
    };
    attempts.push(attempt);
    const action = nextAction({ decision, attempt, catalog });
    if (action.action === 'retry') retries.set(targetPlanId, retryCount + 1);
    if (action.action.startsWith('stop-')) {
      terminal = action;
      targetPlanId = null;
    } else targetPlanId = action.target_plan_id;
  }
  const status = terminal.action === 'stop-passed' ? 'passed' : terminal.action === 'stop-failed' ? 'failed' : 'unknown';
  const unsigned = {
    schema: 1,
    kind: 'citadel_operation_control_report',
    operation_id: request.operation_id,
    request_digest: digest(request),
    decision,
    status,
    terminal_reason_code: terminal.reason_code,
    attempts,
    costs: aggregateObservedCosts(attempts),
    telemetry: attempts.map((attempt) => telemetryFor(attempt, request)),
    trust: {
      integrity: 'digest-bound',
      signer: 'unsigned',
      outcome: status === 'passed' ? 'independently-verified' : status,
      note: 'Digest integrity does not establish signer trust or semantic correctness.',
    },
  };
  return Object.freeze({ ...unsigned, report_digest: digest(unsigned) });
}

function verifyReport(report) {
  if (report?.kind === 'citadel_operation_recovery_report') return require('./recovery-report').verifyRecoveryReport(report);
  if (!report || typeof report !== 'object' || report.kind !== 'citadel_operation_control_report') {
    return { status: 'invalid', reason_code: 'NOT_OPERATION_CONTROL_REPORT' };
  }
  const { report_digest: claimed, ...unsigned } = report;
  const computed = digest(unsigned);
  if (claimed !== computed) return { status: 'invalid', reason_code: 'REPORT_DIGEST_MISMATCH', claimed, computed };
  if (!report.decision || typeof report.decision !== 'object') return { status: 'invalid', reason_code: 'DECISION_MISSING', claimed, computed };
  const { decision_digest: decisionClaimed, ...decisionUnsigned } = report.decision;
  if (decisionClaimed !== digest(decisionUnsigned)) return { status: 'invalid', reason_code: 'DECISION_DIGEST_MISMATCH', claimed, computed };
  if (report.request_digest !== report.decision.request_digest) return { status: 'invalid', reason_code: 'REQUEST_BINDING_MISMATCH', claimed, computed };
  if (!Array.isArray(report.attempts) || !report.attempts.length
    || report.attempts.some((attempt, index) => attempt.attempt !== index + 1)) {
    return { status: 'invalid', reason_code: 'ATTEMPT_SEQUENCE_INVALID', claimed, computed };
  }
  const passed = report.status !== 'passed' || report.attempts.some((attempt) => attempt.completion_status === 'passed' && attempt.control_status === 'passed');
  if (!passed) return { status: 'invalid', reason_code: 'PASS_WITHOUT_VERIFIED_ATTEMPT', claimed, computed };
  if (digest(report.costs) !== digest(aggregateObservedCosts(report.attempts))) return { status: 'invalid', reason_code: 'COST_AGGREGATE_MISMATCH', claimed, computed };
  return { status: 'verified', reason_code: 'REPORT_DIGEST_VERIFIED', claimed, computed, signer_trust: 'unknown' };
}

function historyRecordFromAttempt(request, attempt) {
  return {
    schema: 1,
    feature_key: request.feature_key,
    plan_id: attempt.plan_id,
    ...runtimeSettings({ reasoning_effort: attempt.requested_reasoning_effort ?? null, service_tier: attempt.requested_service_tier ?? null }),
    // An unknown settings observation cannot train the requested configuration
    // as successful, even when its independent output verifier passed.
    verification_status: (attempt.requested_reasoning_effort != null || attempt.requested_service_tier != null)
      && attempt.control_status !== 'passed' && attempt.completion_status === 'passed' ? 'unknown' : attempt.completion_status,
    duration_ms: attempt.duration_ms,
    costs: attempt.costs,
    observed_tools: attempt.observed_tool_calls,
  };
}

module.exports = Object.freeze({
  aggregateObservedCosts,
  changedWorkspacePaths,
  executeAdapter,
  historyRecordFromAttempt,
  parseAdapterResult,
  reconcile,
  resolveWorkspacePath,
  runOperation,
  safeEnvironment,
  telemetryFor,
  verifyAttempt,
  verifyReport,
});

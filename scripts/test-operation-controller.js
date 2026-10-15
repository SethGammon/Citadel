#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const operation = require('../core/operation-controller');
const runtimeAdapter = require('./operation-runtime-adapter');
const operationCli = require('./operation');

const ROOT = path.resolve(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'examples', 'operation-control');
const request = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'request.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'catalog.json'), 'utf8'));

assert.equal(operation.safeEnvironment, require('../core/runtime/environment').safeEnvironment);
const environment = Object.assign(Object.create({ INHERITED: 'excluded' }), {
  PATH: 'path', Path: 'windows-path', HOME: 'home', USERPROFILE: 'user', SystemRoot: 'system',
  CODEX_HOME: 'auth-home', CITADEL_CODEX_JS: 'runtime.js', SECRET: require('crypto').randomBytes(16).toString('hex'),
});
assert.deepEqual(operation.safeEnvironment(['CODEX_HOME', 'CITADEL_CODEX_JS', 'INHERITED'], environment), {
  PATH: 'path', Path: 'windows-path', SystemRoot: 'system', HOME: 'home', USERPROFILE: 'user',
  CODEX_HOME: 'auth-home', CITADEL_CODEX_JS: 'runtime.js',
});
assert.equal(Object.hasOwn(operation.safeEnvironment([], environment), 'CODEX_HOME'), false);

operation.validateRequest(request);
operation.validateCatalog(catalog);
assert.throws(() => operation.validateRequest({ ...request, surprise: true }), /fields must exactly match/);
assert.throws(() => operation.validateRequest({
  ...request,
  constraints: { ...request.constraints, required_tools: ['network'] },
}), /required tools must also be allowed/);
assert.throws(() => operation.validateRequest({
  ...request,
  verifier: { ...request.verifier, required_changed_paths: ['../escape'] },
}), /safe relative paths/);

const planned = operation.routeOperation({ request, catalog, history: [] });
assert.equal(planned.selection_status, 'meets-quality-target');
assert.deepEqual(planned.selected.plan_ids, ['local-filesystem-check']);
assert.equal(planned.selected.expected_costs.actual_cash.amount_usd, 0);
assert.match(planned.decision_digest, /^sha256:[a-f0-9]{64}$/);

const history = [{
  schema: 1,
  feature_key: 'repository-check',
  plan_id: 'local-filesystem-check',
  verification_status: 'passed',
  duration_ms: 50,
  costs: catalog.plans[0].costs,
  observed_tools: ['filesystem'],
}];
const learned = operation.calibratedPrediction(catalog.plans[0], request, history);
assert.equal(learned.evidence_basis, 'verified-outcome-history');
assert.equal(learned.evidence_records, 1);
assert.equal(learned.expected_duration_ms, 50);
assert.equal(operation.wilsonLowerBound(0.5, 100) > 0.4, true);

const configuredPlan = { ...catalog.plans[0], reasoning_effort: 'ultra', service_tier: 'default' };
operation.validateCatalog({ ...catalog, plans: [configuredPlan] });
operation.validateCatalog({ ...catalog, plans: [{ ...catalog.plans[0], reasoning_effort: null, service_tier: null }] });
assert.throws(() => operation.validateCatalog({ ...catalog, plans: [{ ...configuredPlan, surprise: true }] }), /fields must exactly match/);
for (const invalid of ['', ' ultra', '--flag', 'ultra\nservice_tier="priority"', 'x'.repeat(65), 1, true]) {
  for (const field of ['reasoning_effort', 'service_tier']) {
    assert.throws(() => operation.validateCatalog({ ...catalog, plans: [{ ...configuredPlan, [field]: invalid }] }), /bounded non-empty identifier/);
  }
}
const configuredHistory = [{ ...history[0], reasoning_effort: 'ultra', service_tier: 'default' }];
operation.validateHistory(configuredHistory);
for (const indexed of [null, operation.indexHistory([...history, ...configuredHistory])]) {
  const combined = [...history, ...configuredHistory];
  assert.equal(operation.calibratedPrediction(configuredPlan, request, combined, indexed).evidence_records, 1);
  assert.equal(operation.calibratedPrediction(catalog.plans[0], request, combined, indexed).evidence_records, 1);
  assert.equal(operation.calibratedPrediction({ ...configuredPlan, reasoning_effort: 'medium' }, request, combined, indexed).evidence_records, 0);
  assert.equal(operation.calibratedPrediction({ ...configuredPlan, service_tier: 'priority' }, request, combined, indexed).evidence_records, 0);
}
assert.equal(operation.calibratedPrediction(configuredPlan, request, [{ ...history[0], feature_key: 'all' }]).evidence_records, 0);
assert.equal(operation.calibratedPrediction(configuredPlan, request, [{ ...configuredHistory[0], feature_key: 'all' }]).evidence_records, 1);

const catalogArgs = ['--runtime', 'codex', '--model', 'gpt-test', '--fallback-model', 'other-model'];
const legacyRuntimeCatalog = operationCli.runtimeCatalog(catalogArgs);
assert.equal(legacyRuntimeCatalog.catalog_id, 'codex-gpt-test-runtime-catalog');
assert.equal(legacyRuntimeCatalog.plans[0].plan_id, 'codex-direct-gpt-test');
assert.equal(legacyRuntimeCatalog.plans[1].plan_id, 'codex-fallback-other-model');
assert.equal(Object.hasOwn(legacyRuntimeCatalog.plans[0], 'reasoning_effort'), false);
const explicitRuntimeCatalog = operationCli.runtimeCatalog([...catalogArgs, '--reasoning-effort=ultra', '--service-tier', 'default']);
operation.validateCatalog(explicitRuntimeCatalog);
for (const candidate of explicitRuntimeCatalog.plans) {
  assert.equal(candidate.reasoning_effort, 'ultra');
  assert.equal(candidate.service_tier, 'default');
}
assert.equal(explicitRuntimeCatalog.plans[0].fallback_plan_ids[0], explicitRuntimeCatalog.plans[1].plan_id);
assert.notEqual(explicitRuntimeCatalog.plans[0].plan_id, explicitRuntimeCatalog.plans[1].plan_id);
for (const changed of [[], ['--reasoning-effort', 'medium', '--service-tier', 'default'], ['--reasoning-effort', 'ultra', '--service-tier', 'priority']]) {
  const other = operationCli.runtimeCatalog([...catalogArgs, ...changed]);
  assert.notEqual(explicitRuntimeCatalog.catalog_id, other.catalog_id);
  assert.notEqual(explicitRuntimeCatalog.plans[0].plan_id, other.plans[0].plan_id);
}
for (const flags of [['--reasoning-effort'], ['--service-tier', '--tools', 'shell'], ['--reasoning-effort='], ['--service-tier=']]) {
  assert.throws(() => operationCli.runtimeCatalog([...catalogArgs, ...flags]), /requires a value|bounded non-empty/);
}
assert.throws(() => operationCli.runtimeCatalog(['--runtime', 'claude', '--model', 'opus', '--reasoning-effort', 'ultra']), /does not support/);
operation.validateCatalog(operationCli.runtimeCatalog(['--runtime', 'codex', '--model', 'm'.repeat(100), '--reasoning-effort', 'ultra']));
const configuredDecision = operation.routeOperation({ request, catalog: { ...catalog, plans: [configuredPlan] } });
assert.notEqual(planned.catalog_digest, configuredDecision.catalog_digest);
assert.notEqual(planned.decision_digest, configuredDecision.decision_digest);
for (const settings of [{ reasoning_effort: 'medium' }, { service_tier: 'priority' }]) {
  const changed = operation.routeOperation({ request, catalog: { ...catalog, plans: [{ ...configuredPlan, ...settings }] } });
  assert.notEqual(configuredDecision.catalog_digest, changed.catalog_digest);
  assert.notEqual(configuredDecision.decision_digest, changed.decision_digest);
}

function cost(amount) {
  return {
    actual_cash: { status: 'known', amount_usd: amount, basis: 'estimate', source: 'test' },
    marginal: { status: 'known', amount_usd: amount, basis: 'estimate', source: 'test' },
    market_equivalent: { status: 'known', amount_usd: amount, basis: 'estimate', source: 'test' },
  };
}

function plan(planId, probability, amount, fallbackPlanIds = []) {
  return {
    plan_id: planId,
    label: planId,
    adapter_id: 'test',
    topology: 'direct',
    model: planId,
    tools: [],
    privacy: 'local-only',
    feature_keys: [],
    prior: { success_probability: probability, strength: 100, source: 'test' },
    expected_duration_ms: amount * 1000 + 1,
    costs: cost(amount),
    retry_on: ['MALFORMED_OUTPUT'],
    max_retries: 1,
    fallback_plan_ids: fallbackPlanIds,
  };
}

const pathCatalog = {
  schema: 1,
  catalog_id: 'path-test',
  adapters: { test: { protocol: operation.ADAPTER_PROTOCOL, executable: 'node', args: [], timeout_ms: 1000, environment_allowlist: [] } },
  plans: [plan('direct-small', 0.75, 0.1, ['frontier']), plan('frontier', 0.99, 1)],
};
const pathRequest = {
  ...request,
  operation_id: 'path-test',
  feature_key: 'general',
  quality_target: 0.9,
  constraints: {
    ...request.constraints,
    allowed_tools: [], required_tools: [], max_duration_ms: 10000,
    budgets: { actual_cash: 3, marginal: 3, market_equivalent: 3 },
  },
  verifier: { kind: 'adapter-result' },
};
const pathDecision = operation.routeOperation({ request: pathRequest, catalog: pathCatalog, history: [] });
assert.deepEqual(pathDecision.selected.plan_ids, ['direct-small', 'frontier']);
assert(pathDecision.selected.expected_costs.actual_cash.amount_usd < 1);
assert.equal(pathDecision.selected.maximum_costs.actual_cash.amount_usd, 2.2);
assert.equal(pathDecision.selected.maximum_duration_ms, 2204);
assert(pathDecision.selected.verified_success_probability >= pathRequest.quality_target);

const retry = operation.nextAction({
  decision: pathDecision,
  catalog: pathCatalog,
  attempt: { plan_id: 'direct-small', completion_status: 'unknown', control_status: 'unknown', failure_code: 'MALFORMED_OUTPUT', retry_count: 0 },
});
assert.deepEqual(retry, { action: 'retry', reason_code: 'MALFORMED_OUTPUT', target_plan_id: 'direct-small' });
const escalate = operation.nextAction({
  decision: pathDecision,
  catalog: pathCatalog,
  attempt: { plan_id: 'direct-small', completion_status: 'failed', control_status: 'passed', failure_code: 'VERIFICATION_FAILED', retry_count: 0 },
});
assert.equal(escalate.action, 'escalate');
assert.equal(escalate.target_plan_id, 'frontier');

const blockedRequest = {
  ...pathRequest,
  constraints: { ...pathRequest.constraints, budgets: { actual_cash: 0.01, marginal: 0.01, market_equivalent: 0.01 } },
};
assert.throws(() => operation.routeOperation({ request: blockedRequest, catalog: pathCatalog, history: [] }), (error) => error.code === 'NO_ELIGIBLE_PATH');
const disallowed = { ...catalog, plans: [{ ...catalog.plans[0], tools: ['network'] }] };
assert.throws(() => operation.routeOperation({ request, catalog: disallowed, history: [] }), (error) => error.code === 'NO_ELIGIBLE_PATH');

const report = operation.runOperation({ request, catalog, history: [], workspaceRoot: EXAMPLE });
assert.equal(report.status, 'passed');
assert.equal(report.attempts.length, 1);
assert.equal(report.attempts[0].control_status, 'passed');
assert.equal(report.attempts[0].completion_status, 'passed');
assert.equal(report.trust.signer, 'unsigned');
assert.equal(operation.verifyReport(report).status, 'verified');
assert.equal(operation.verifyReport({ ...report, status: 'failed' }).reason_code, 'REPORT_DIGEST_MISMATCH');
const failedAdapterVerification = operation.verifyAttempt({
  request: { ...request, verifier: { kind: 'adapter-result' } },
  adapterResult: { status: 'failed', failure_code: 'RUNTIME_EXIT_NONZERO', output: '' },
  workspaceRoot: EXAMPLE,
});
assert.equal(failedAdapterVerification.status, 'failed');

const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-artifact-'));
spawnSync('git', ['init'], { cwd: artifactRoot, encoding: 'utf8', shell: false });
spawnSync('git', ['config', 'user.email', 'operation-test@example.invalid'], { cwd: artifactRoot, encoding: 'utf8', shell: false });
spawnSync('git', ['config', 'user.name', 'Operation Test'], { cwd: artifactRoot, encoding: 'utf8', shell: false });
fs.writeFileSync(path.join(artifactRoot, 'required.txt'), 'before\n');
spawnSync('git', ['add', 'required.txt'], { cwd: artifactRoot, encoding: 'utf8', shell: false });
spawnSync('git', ['commit', '-m', 'fixture'], { cwd: artifactRoot, encoding: 'utf8', shell: false });
fs.writeFileSync(path.join(artifactRoot, 'required.txt'), 'after\n');
const artifactRequest = {
  ...request,
  verifier: { kind: 'command', executable: process.execPath, args: ['-e', 'process.exit(0)'], cwd: '.', timeout_ms: 10000, required_changed_paths: ['required.txt'] },
};
const artifactVerification = operation.verifyAttempt({ request: artifactRequest, adapterResult: { status: 'completed', output: '' }, workspaceRoot: artifactRoot });
assert.equal(artifactVerification.status, 'passed');
const artifactAlias = `${artifactRoot}-alias`;
fs.symlinkSync(artifactRoot, artifactAlias, process.platform === 'win32' ? 'junction' : 'dir');
const aliasedArtifactVerification = operation.verifyAttempt({
  request: artifactRequest,
  adapterResult: { status: 'completed', output: '' },
  workspaceRoot: artifactAlias,
});
assert.equal(aliasedArtifactVerification.status, 'passed');
fs.unlinkSync(artifactAlias);
const uncoveredVerification = operation.verifyAttempt({
  request: { ...artifactRequest, verifier: { ...artifactRequest.verifier, required_changed_paths: ['missing.txt'] } },
  adapterResult: { status: 'completed', output: '' }, workspaceRoot: artifactRoot,
});
assert.equal(uncoveredVerification.failure_code, 'REQUIRED_ARTIFACT_NOT_CHANGED');
fs.rmSync(artifactRoot, { recursive: true, force: true });

const adapterInput = {
  schema: 1,
  protocol: operation.ADAPTER_PROTOCOL,
  operation: pathRequest,
  decision_digest: pathDecision.decision_digest,
  plan: { ...pathCatalog.plans[0], tools: ['filesystem', 'shell'] },
  workspace_root: EXAMPLE,
  retry_count: 0,
};
const fakeCodex = runtimeAdapter.execute(adapterInput, 'codex', {
  resolve: (invocation) => invocation,
  spawn: () => ({
    status: 0,
    stdout: [
      JSON.stringify({ type: 'item.completed', item: { type: 'file_change' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }),
      JSON.stringify({ type: 'turn.completed', model: 'direct-small', usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 20 } }),
    ].join('\n'),
    stderr: '',
  }),
  env: {},
});
assert.equal(fakeCodex.status, 'completed');
assert.equal(fakeCodex.observations.model, 'direct-small');
assert.deepEqual(fakeCodex.observations.tool_calls, ['filesystem', 'shell']);
assert.equal(fakeCodex.observations.costs.actual_cash.status, 'unknown');
assert.equal(runtimeAdapter.invocationFor('claude', 'opus').command, 'claude');
assert.match(runtimeAdapter.invocationFor('claude', 'opus', {}, ['filesystem', 'shell']).args.join(' '), /Bash\(node \*\)/);
assert.equal(runtimeAdapter.claudeAllowedTools(['filesystem']).includes('Bash'), false);
assert.equal(runtimeAdapter.invocationFor('codex', 'gpt').args.at(-1), '-');
assert.equal(runtimeAdapter.invocationFor('codex', 'gpt', { CITADEL_CODEX_JS: 'codex.js' }).args[0], 'codex.js');

const platformSandboxArgs = process.platform === 'win32' ? ['-c', 'windows.sandbox="elevated"'] : [];
assert.deepEqual(runtimeAdapter.invocationFor('codex', 'gpt', {}, []).args,
  ['exec', '--json', '--sandbox', 'workspace-write', '--ignore-user-config', ...platformSandboxArgs, '--model', 'gpt', '-']);
for (const platform of ['linux', 'darwin']) {
  assert.deepEqual(runtimeAdapter.invocationFor('codex', 'gpt', {}, [], {}, platform).args,
    ['exec', '--json', '--sandbox', 'workspace-write', '--ignore-user-config', '--model', 'gpt', '-']);
}
assert.deepEqual(runtimeAdapter.invocationFor('codex', 'gpt', {}, [], {}, 'win32').args,
  ['exec', '--json', '--sandbox', 'workspace-write', '--ignore-user-config', '-c', 'windows.sandbox="elevated"', '--model', 'gpt', '-']);
assert.deepEqual(runtimeAdapter.invocationFor('claude', 'opus', {}, [], {}, 'win32'),
  runtimeAdapter.invocationFor('claude', 'opus', {}, [], {}, 'linux'));
assert(runtimeAdapter.invocationFor('codex', 'gpt', { CITADEL_CODEX_JS: 'codex.js' }, [], {}, 'win32').args.includes('windows.sandbox="elevated"'));
assert.deepEqual(runtimeAdapter.invocationFor('codex', 'gpt', {}, [], { reasoning_effort: null, service_tier: null }).args,
  runtimeAdapter.invocationFor('codex', 'gpt', {}, []).args);
const settingInput = { ...adapterInput, plan: { ...adapterInput.plan, reasoning_effort: 'ultra', service_tier: 'default' } };
let capturedInvocation;
const explicitCodex = runtimeAdapter.execute(settingInput, 'codex', {
  resolve: (invocation) => invocation,
  spawn: (command, args, options) => {
    capturedInvocation = { command, args, options };
    return { status: 0, stdout: JSON.stringify({ type: 'turn.completed', model: 'direct-small', reasoning_effort: 'ultra', service_tier: 'default' }), stderr: '' };
  },
  env: {},
  platform: 'win32',
});
assert.equal(capturedInvocation.command, 'codex');
assert.deepEqual(capturedInvocation.args, [
  'exec', '--json', '--sandbox', 'workspace-write', '--ignore-user-config', '-c', 'windows.sandbox="elevated"', '--model', 'direct-small',
  '-c', 'model_reasoning_effort="ultra"', '-c', 'service_tier="default"', '-',
]);
assert.equal(capturedInvocation.options.shell, false);
let sandboxLaunches = 0;
const sandboxRefusal = runtimeAdapter.execute(settingInput, 'codex', {
  resolve: (invocation) => invocation,
  spawn: (_command, args) => {
    sandboxLaunches += 1;
    assert(args.includes('windows.sandbox="elevated"'));
    return { status: 1, stdout: '', stderr: 'sandbox implementation prohibited by managed requirements' };
  },
  env: {}, platform: 'win32',
});
assert.equal(sandboxLaunches, 1, 'a sandbox refusal must not trigger a less restrictive fallback');
assert.equal(sandboxRefusal.status, 'failed');
assert.equal(sandboxRefusal.failure_code, 'RUNTIME_EXIT_NONZERO');
assert.equal(explicitCodex.observations.reasoning_effort, null, 'stdout setting claims are not trusted session metadata');
assert.equal(explicitCodex.observations.service_tier, null, 'a requested tier is not an observed served tier');
assert.throws(() => runtimeAdapter.invocationFor('claude', 'opus', {}, [], { service_tier: 'default' }), /does not support/);
assert.throws(() => runtimeAdapter.invocationFor('codex', 'gpt', {}, [], { reasoning_effort: 'ultra"\nservice_tier="priority' }), /bounded non-empty/);

const legacyAdapterResult = { ...fakeCodex, observations: { ...fakeCodex.observations } };
for (const field of ['reasoning_effort', 'service_tier', 'reasoning_effort_source', 'service_tier_source']) delete legacyAdapterResult.observations[field];
assert.deepEqual(operation.parseAdapterResult(JSON.stringify(legacyAdapterResult)), legacyAdapterResult);
for (const observations of [
  { ...legacyAdapterResult.observations, service_tier: '' },
  { ...legacyAdapterResult.observations, reasoning_effort: false },
  { ...legacyAdapterResult.observations, service_tier_source: {} },
  { ...legacyAdapterResult.observations, surprise: 'value' },
]) {
  assert.throws(() => operation.parseAdapterResult(JSON.stringify({ ...legacyAdapterResult, observations })), (error) => error.code === 'MALFORMED_OUTPUT');
}
assert.throws(() => operation.parseAdapterResult('partial JSON'), (error) => error.code === 'MALFORMED_OUTPUT');
const parityPlan = { ...pathCatalog.plans[0], reasoning_effort: 'ultra', service_tier: 'default', fallback_plan_ids: [] };
const parityResult = {
  schema: 1, status: 'completed', failure_code: null, output: 'verified artifact',
  observations: {
    model: parityPlan.model, topology: parityPlan.topology, tools: [], tool_calls: [], usage: {}, costs: cost(0.1),
    reasoning_effort: 'ultra', reasoning_effort_source: 'runtime-metadata', service_tier: 'default', service_tier_source: 'runtime-served-tier',
  },
};
const parityCatalog = { ...pathCatalog, plans: [parityPlan] };
function runParity(result, planOverrides = {}) {
  return operation.runOperation({
    request: { ...pathRequest, quality_target: 0.1, verifier: { kind: 'command', executable: 'verify-test', args: [], cwd: '.', timeout_ms: 1000, required_changed_paths: [] } },
    catalog: { ...parityCatalog, plans: [{ ...parityPlan, ...planOverrides }] },
    workspaceRoot: EXAMPLE,
    spawn: (command, args) => command === 'node' ? result : command === 'verify-test'
      ? { status: 0, stdout: 'independent verification passed' }
      : { status: 0, stdout: args[0] === 'rev-parse' ? EXAMPLE : '' },
  });
}
const parityReport = runParity({ status: 0, stdout: JSON.stringify(parityResult) });
assert.equal(parityReport.status, 'passed');
assert.equal(parityReport.attempts[0].observed_reasoning_effort, 'ultra');
assert.equal(parityReport.attempts[0].observed_service_tier, 'default');
assert.equal(parityReport.telemetry[0].attributes['citadel.service_tier.requested'], 'default');
assert.equal(operation.verifyReport(parityReport).status, 'verified');
const parityHistory = operation.historyRecordFromAttempt(pathRequest, parityReport.attempts[0]);
operation.validateHistory([parityHistory]);
assert.equal(parityHistory.reasoning_effort, 'ultra');
assert.equal(parityHistory.service_tier, 'default');
for (const [field, observed] of [['reasoning_effort', 'medium'], ['service_tier', 'priority']]) {
  const mismatch = runParity({ status: 0, stdout: JSON.stringify({ ...parityResult, observations: { ...parityResult.observations, [field]: observed } }) });
  assert.equal(mismatch.status, 'failed');
  assert.equal(mismatch.attempts[0].control_status, 'failed');
  assert.equal(mismatch.attempts[0].failure_code, `${field.toUpperCase()}_MISMATCH`);
  assert.equal(mismatch.attempts[0].evidence.exit_code, 0);
}
const unknownSettings = { ...parityResult.observations };
for (const field of ['reasoning_effort', 'service_tier', 'reasoning_effort_source', 'service_tier_source']) delete unknownSettings[field];
assert.equal(operation.reconcile({ ...parityPlan, service_tier: null }, pathRequest,
  { ...parityResult, observations: { ...unknownSettings, reasoning_effort: 'ultra' } }).status, 'passed');
assert.equal(operation.reconcile({ ...parityPlan, reasoning_effort: null }, pathRequest,
  { ...parityResult, observations: { ...unknownSettings, service_tier: 'default' } }).status, 'passed');
const unknownReport = runParity({ status: 0, stdout: JSON.stringify({ ...parityResult, observations: unknownSettings }) });
assert.equal(unknownReport.status, 'unknown');
assert.equal(unknownReport.attempts[0].completion_status, 'passed');
assert.equal(unknownReport.attempts[0].control_status, 'unknown');
assert.deepEqual(unknownReport.attempts[0].control_reason_codes, ['REASONING_EFFORT_NOT_OBSERVED', 'SERVICE_TIER_NOT_OBSERVED']);
assert.equal(unknownReport.attempts[0].requested_service_tier, 'default');
assert.equal(unknownReport.attempts[0].observed_service_tier, null);
assert.equal(operation.historyRecordFromAttempt(pathRequest, unknownReport.attempts[0]).verification_status, 'unknown');
const runtimeRejected = runParity({ status: 0, stdout: JSON.stringify({ ...parityResult, status: 'failed', failure_code: 'RUNTIME_EXIT_NONZERO', observations: unknownSettings }) });
assert.equal(runtimeRejected.status, 'failed');
assert.equal(runtimeRejected.attempts[0].failure_code, 'RUNTIME_EXIT_NONZERO');
const tampered = JSON.parse(JSON.stringify(unknownReport));
tampered.attempts[0].observed_service_tier = 'default';
assert.equal(operation.verifyReport(tampered).reason_code, 'REPORT_DIGEST_MISMATCH');
const launchFailed = runParity({ error: { code: 'ENOENT', message: 'no runtime' } });
assert.equal(launchFailed.attempts[0].requested_reasoning_effort, 'ultra');
assert.equal(launchFailed.attempts[0].requested_service_tier, 'default');
assert.equal(launchFailed.attempts[0].observed_reasoning_effort, null);
assert.equal(launchFailed.attempts[0].observed_service_tier, null);
assert.equal(launchFailed.attempts[0].failure_code, 'ADAPTER_LAUNCH_FAILED');

const settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-settings-'));
try {
  const sessionDir = path.join(settingsRoot, 'sessions', '2026', '10', '15');
  fs.mkdirSync(sessionDir, { recursive: true });
  const thread = '019f5e9b-f6e6-7031-a377-7aeb4de3daea';
  const sessionFile = path.join(sessionDir, `rollout-${thread}.jsonl`);
  const sessionEnv = { CODEX_HOME: settingsRoot };
  const stdout = JSON.stringify({ type: 'thread.started', thread_id: thread });
  const meta = { type: 'session_meta', payload: { id: thread, cwd: EXAMPLE } };
  const context = { type: 'turn_context', payload: { cwd: EXAMPLE, model: 'direct-small', effort: 'ultra', service_tier: 'default' } };
  const observe = () => runtimeAdapter.codexSettingsObservation(stdout, EXAMPLE, sessionEnv);
  const writeSession = (events) => fs.writeFileSync(sessionFile, events.map((event) => JSON.stringify(event)).join('\n'));
  writeSession([meta, context]);
  assert.equal(observe().reasoning_effort, 'ultra');
  assert.equal(observe().reasoning_effort_source, 'codex-session-turn-context');
  assert.equal(observe().service_tier, null, 'configured session tier is not served-tier evidence');
  const originalOpen = fs.openSync;
  // macOS resolves /var to /private/var before opening the session file.
  const canonicalSessionFile = fs.realpathSync(sessionFile);
  try {
    fs.openSync = (file, ...args) => {
      if (fs.realpathSync(file) === canonicalSessionFile) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return originalOpen(file, ...args);
    };
    assert.equal(observe().reasoning_effort, null, 'inaccessible session cannot confirm effort');
  } finally { fs.openSync = originalOpen; }
  const configFile = path.join(settingsRoot, 'config.toml');
  fs.writeFileSync(configFile, 'model_reasoning_effort="medium"\nservice_tier="priority"\n');
  const configBefore = fs.readFileSync(configFile, 'utf8');
  const withSession = runtimeAdapter.execute(settingInput, 'codex', {
    resolve: (invocation) => invocation,
    spawn: () => ({ status: 0, stdout: `${stdout}\n${JSON.stringify({ type: 'turn.completed', model: 'direct-small' })}` }), env: sessionEnv,
  });
  assert.equal(withSession.observations.reasoning_effort, 'ultra');
  assert.equal(withSession.observations.service_tier, null);
  assert.equal(fs.readFileSync(configFile, 'utf8'), configBefore);
  const effortOnlyInput = { ...settingInput, plan: { ...parityPlan, service_tier: null } };
  const executeWithModel = (model) => runtimeAdapter.execute(effortOnlyInput, 'codex', {
    resolve: (invocation) => invocation,
    spawn: () => ({ status: 0, stdout: `${stdout}\n${JSON.stringify({ type: 'turn.completed', model })}` }), env: sessionEnv,
  });
  const matching = executeWithModel('direct-small');
  assert.equal(matching.observations.reasoning_effort, 'ultra');
  const matchingReport = runParity({ status: 0, stdout: JSON.stringify(matching) }, { service_tier: null });
  assert.equal(matchingReport.status, 'passed');
  assert.equal(operation.historyRecordFromAttempt(pathRequest, matchingReport.attempts[0]).verification_status, 'passed');
  writeSession([meta, { ...context, payload: { ...context.payload, model: 'gpt-other-model' } }]);
  const conflicting = executeWithModel('direct-small');
  assert.equal(conflicting.observations.model, 'direct-small', 'preserve legacy stdout model parsing');
  assert.equal(conflicting.observations.reasoning_effort, null, 'effort for another model cannot establish requested model/effort parity');
  assert.equal(conflicting.observations.reasoning_effort_source, null);
  const conflictReport = runParity({ status: 0, stdout: JSON.stringify(conflicting) }, { service_tier: null });
  assert.equal(conflictReport.status, 'unknown');
  assert.equal(conflictReport.attempts[0].completion_status, 'passed', 'independent verifier still passed');
  assert.equal(conflictReport.attempts[0].control_status, 'unknown');
  assert.equal(operation.historyRecordFromAttempt(pathRequest, conflictReport.attempts[0]).verification_status, 'unknown');
  writeSession([meta, context]);
  const conflictingStdout = `${stdout}\n${JSON.stringify({ type: 'turn.started', model: 'gpt-other-model' })}\n${JSON.stringify({ type: 'turn.completed', model: 'direct-small' })}`;
  assert.equal(runtimeAdapter.codexSettingsObservation(conflictingStdout, EXAMPLE, sessionEnv).reasoning_effort, null);
  assert.equal(runtimeAdapter.codexSettingsObservation(stdout, EXAMPLE, sessionEnv, 'gpt-other-model').reasoning_effort, null);
  for (const events of [
    [meta, { ...context, payload: { ...context.payload, cwd: settingsRoot } }],
    [{ ...meta, payload: { ...meta.payload, id: '00000000-0000-0000-0000-000000000000' } }, context],
    [meta, { ...context, payload: { ...context.payload, effort: null } }],
    [meta, context, { ...context, payload: { ...context.payload, effort: 'medium' } }],
    [meta, context, { ...context, payload: { ...context.payload, model: 'different-model' } }],
    [meta, { ...context, payload: { ...context.payload, collaboration_mode: { settings: { reasoning_effort: 'medium' } } } }],
    [meta, { ...context, payload: { ...context.payload, collaboration_mode: { settings: { model: 'gpt-other-model' } } } }],
    [context],
  ]) { writeSession(events); assert.equal(observe().reasoning_effort, null); }
  writeSession([meta, context]);
  fs.appendFileSync(sessionFile, '\n{"type":"turn_context"');
  assert.equal(observe().reasoning_effort, null);
  writeSession([meta, context]);
  fs.appendFileSync(sessionFile, `\n${' '.repeat(2 * 1024 * 1024)}`);
  assert.equal(observe().reasoning_effort, null);
  writeSession([meta, context]);
  const duplicate = path.join(sessionDir, `other-${thread}.jsonl`);
  fs.copyFileSync(sessionFile, duplicate);
  assert.equal(observe().reasoning_effort, null);
  fs.unlinkSync(duplicate);
  const escaped = path.join(settingsRoot, 'outside');
  fs.mkdirSync(escaped);
  fs.renameSync(sessionFile, path.join(escaped, path.basename(sessionFile)));
  const link = path.join(sessionDir, 'escape');
  fs.symlinkSync(escaped, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(observe().reasoning_effort, null);
  fs.unlinkSync(link);
  assert.equal(observe().reasoning_effort, null, 'missing or unreadable session cannot confirm effort');
  assert.equal(runtimeAdapter.codexSettingsObservation(`${stdout}\nmalformed`, EXAMPLE, sessionEnv).reasoning_effort, null);
} finally { fs.rmSync(settingsRoot, { recursive: true, force: true }); }

const scalePlans = Array.from({ length: 64 }, (_, index) => ({
  ...plan(`scale-${index}`, 0.6 + ((index % 4) * 0.05), 0.1 + (index / 1000)),
  feature_keys: ['scale'],
  max_retries: 0,
}));
const scaleCatalog = { ...pathCatalog, catalog_id: 'scale-test', plans: scalePlans };
const scaleRequest = {
  ...pathRequest,
  operation_id: 'scale-test', feature_key: 'scale', quality_target: 0.4,
  constraints: { ...pathRequest.constraints, budgets: { actual_cash: null, marginal: null, market_equivalent: null } },
};
const scaleHistory = Array.from({ length: 20000 }, (_, index) => ({
  schema: 1,
  feature_key: 'scale',
  plan_id: `scale-${index % 64}`,
  verification_status: index % 3 === 0 ? 'failed' : 'passed',
  duration_ms: 100 + (index % 50),
  costs: cost(0.1 + ((index % 64) / 1000)),
  observed_tools: [],
}));
const scaleStarted = Date.now();
operation.routeOperation({ request: scaleRequest, catalog: scaleCatalog, history: scaleHistory });
assert(Date.now() - scaleStarted < 1500, '20,000-outcome route should stay below 1.5 seconds');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-test-'));
const initialized = path.join(temp, 'initialized');
const cliInit = spawnSync(process.execPath, [
  path.join(ROOT, 'bin', 'citadel.js'), 'operation', 'init',
  '--objective', 'Run the repository verification',
  '--runtime', 'codex', '--model', 'gpt-test', '--fallback-model', 'gpt-frontier',
  '--reasoning-effort', 'ultra', '--service-tier', 'default',
  '--verifier-executable', 'node', '--verifier-arg', 'check.js', '--out-dir', initialized,
  '--required-changed-path', 'scripts/test.js',
  '--json',
], { cwd: ROOT, encoding: 'utf8', shell: false });
assert.equal(cliInit.status, 0, cliInit.stderr);
assert.equal(JSON.parse(cliInit.stdout).status, 'initialized');
const initializedRequest = JSON.parse(fs.readFileSync(path.join(initialized, 'request.json'), 'utf8'));
const initializedCatalog = JSON.parse(fs.readFileSync(path.join(initialized, 'catalog.json'), 'utf8'));
operation.validateRequest(initializedRequest);
operation.validateCatalog(initializedCatalog);
assert.equal(initializedRequest.constraints.budgets.actual_cash, null);
assert.deepEqual(initializedRequest.verifier.required_changed_paths, ['scripts/test.js']);
assert.equal(initializedCatalog.plans[0].fallback_plan_ids[0], initializedCatalog.plans[1].plan_id);
assert.equal(initializedCatalog.plans[0].reasoning_effort, 'ultra');
assert.equal(initializedCatalog.plans[1].service_tier, 'default');
const output = path.join(temp, 'report.json');
const cliRun = spawnSync(process.execPath, [
  path.join(ROOT, 'bin', 'citadel.js'), 'operation', 'run',
  '--request', path.join(EXAMPLE, 'request.json'),
  '--catalog', path.join(EXAMPLE, 'catalog.json'),
  '--workspace', EXAMPLE,
  '--out', output,
  '--json',
], { cwd: ROOT, encoding: 'utf8', shell: false });
assert.equal(cliRun.status, 0, cliRun.stderr);
assert.equal(JSON.parse(cliRun.stdout).status, 'passed');
const cliVerify = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'citadel.js'), 'operation', 'verify', '--input', output, '--json'], { cwd: ROOT, encoding: 'utf8', shell: false });
assert.equal(cliVerify.status, 0, cliVerify.stderr);
assert.equal(JSON.parse(cliVerify.stdout).signer_trust, 'unknown');
fs.rmSync(temp, { recursive: true, force: true });

process.stdout.write('Operation controller tests passed: contracts, whole-path routing, conservative outcomes, budgets, tools, retries, execution, verification, tamper detection, and CLI.\n');

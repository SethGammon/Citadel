'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { digest, scenarioSetIdentity, validateScenario } = require('./contract');

const FIXTURE_START = Date.parse('2026-01-01T00:00:00.000Z');
const FAILURE_CODES = Object.freeze({
  clone: 'CLONE_FAILED',
  checkout: 'CHECKOUT_FAILED',
  setup: 'SETUP_FAILED',
  execution_timeout: 'EXECUTION_TIMEOUT',
  execution: 'EXECUTION_FAILED',
  adapter_output: 'ADAPTER_OUTPUT_INVALID',
  verification: 'VERIFICATION_FAILED',
  unexpected: 'UNEXPECTED_FAILED',
});

class BenchmarkRunError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BenchmarkRunError';
    this.code = Object.values(FAILURE_CODES).includes(code) ? code : FAILURE_CODES.unexpected;
  }
}

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveContained(root, relative) {
  const candidate = path.resolve(root, relative);
  if (!contained(root, candidate)) throw new Error(`Path escapes benchmark workspace: ${relative}`);
  return candidate;
}

function isContainedPath(root, candidate, options = {}) {
  const fsImpl = options.fsImpl || fs;
  try {
    if (!contained(root, candidate)) return false;
    const stat = fsImpl.lstatSync(candidate);
    if (stat.isSymbolicLink()) return false;
    if (options.regularFile && !stat.isFile()) return false;
    if (!options.regularFile && !stat.isFile() && !stat.isDirectory()) return false;
    return contained(root, fsImpl.realpathSync(candidate));
  } catch (_) {
    return false;
  }
}

function safeEnvironment(extra = {}) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', ...extra };
}

function execute(argv, cwd, timeoutMs, env = safeEnvironment()) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    stdout: (result.stdout || '').slice(-16384),
    stderr: (result.stderr || '').slice(-16384),
    timed_out: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
  };
}

function generateFixtureRuns(scenarios, repetitions = 3, citadelVersion = 'fixture-contract') {
  if (!Number.isInteger(repetitions) || repetitions < 3) throw new Error('Fixture evidence requires at least 3 repetitions per mode');
  const scenarioSetId = scenarioSetIdentity(scenarios);
  const runs = [];
  let sequence = 0;
  for (const scenario of scenarios) {
    for (const mode of ['bare', 'harnessed']) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const isHarnessed = mode === 'harnessed';
        const base = 1000 + scenario.id.length * 10 + repetition;
        runs.push({
          schema: 1,
          evidence_kind: 'fixture-simulation',
          scenario_set_id: scenarioSetId,
          scenario_id: scenario.id,
          category: scenario.category,
          mode,
          repetition,
          citadel_version: citadelVersion,
          runtime_version: scenario.runtime,
          model: scenario.model,
          timeout_minutes: scenario.timeout_minutes,
          task_hash: digest(scenario.task),
          verification_command: scenario.verification_command,
          started_at: new Date(FIXTURE_START + sequence * 1000).toISOString(),
          duration_ms: Math.round(base * (isHarnessed ? 1.1 : 1)),
          completed: true,
          verification_passed: true,
          human_interventions: 1,
          input_tokens: isHarnessed ? 1100 : 1000,
          output_tokens: isHarnessed ? 550 : 500,
          estimated_cost: isHarnessed ? 1.1 : 1,
          resume_succeeded: scenario.context_reset_at === null ? false : true,
          cleanup_passed: true,
          regressions: 0,
          artifact_paths: scenario.expected_artifacts,
          attestation: null,
        });
        sequence += 1;
      }
    }
  }
  return runs;
}

const ADAPTER_FIELDS = Object.freeze([
  'schema', 'human_interventions', 'input_tokens', 'output_tokens',
  'estimated_cost', 'regressions', 'resume_succeeded',
]);

function validateAdapter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BenchmarkRunError(FAILURE_CODES.adapter_output);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...ADAPTER_FIELDS].sort())) {
    throw new BenchmarkRunError(FAILURE_CODES.adapter_output);
  }
  if (value.schema !== 1 || typeof value.resume_succeeded !== 'boolean') {
    throw new BenchmarkRunError(FAILURE_CODES.adapter_output);
  }
  for (const field of ['human_interventions', 'input_tokens', 'output_tokens', 'regressions']) {
    if (!Number.isInteger(value[field]) || value[field] < 0) throw new BenchmarkRunError(FAILURE_CODES.adapter_output);
  }
  if (!Number.isFinite(value.estimated_cost) || value.estimated_cost < 0) {
    throw new BenchmarkRunError(FAILURE_CODES.adapter_output);
  }
  return value;
}

function runScenario({
  scenario,
  scenarios,
  mode,
  repetition,
  executorFile,
  citadelVersion = 'unknown',
  executeCommand = execute,
}) {
  validateScenario(scenario);
  if (!['bare', 'harnessed'].includes(mode)) throw new Error('mode must be bare or harnessed');
  if (!Number.isInteger(repetition) || repetition < 1) throw new Error('repetition must be positive');
  const resolvedExecutor = path.resolve(executorFile);
  if (!fs.statSync(resolvedExecutor).isFile()) throw new Error('executorFile must be a file');
  const timeoutMs = scenario.timeout_minutes * 60 * 1000;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-product-benchmark-'));
  const workspace = resolveContained(sandbox, 'repository');
  const inputFile = resolveContained(sandbox, 'executor-input.json');
  const outputFile = resolveContained(sandbox, 'executor-output.json');
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let adapter = {
    schema: 1, human_interventions: 0, input_tokens: 0, output_tokens: 0,
    estimated_cost: 0, regressions: 0, resume_succeeded: false,
  };
  let completed = false;
  let verificationPassed = false;
  let gitClean = false;
  let artifactPaths = [];
  let failure = null;
  try {
    const clone = executeCommand(['git', 'clone', '--quiet', '--no-checkout', scenario.repository, workspace], sandbox, timeoutMs);
    if (clone.status !== 0) throw new BenchmarkRunError(FAILURE_CODES.clone);
    const checkout = executeCommand(['git', 'checkout', '--quiet', '--detach', scenario.pinned_ref], workspace, timeoutMs);
    if (checkout.status !== 0) throw new BenchmarkRunError(FAILURE_CODES.checkout);
    const setup = executeCommand(scenario.setup_command, workspace, timeoutMs);
    if (setup.status !== 0) throw new BenchmarkRunError(FAILURE_CODES.setup);
    fs.writeFileSync(inputFile, `${JSON.stringify({
      schema: 1,
      mode,
      task: scenario.task,
      runtime: scenario.runtime,
      model: scenario.model,
      timeout_minutes: scenario.timeout_minutes,
      context_reset_at: scenario.context_reset_at,
      repository_path: workspace,
      output_path: outputFile,
    }, null, 2)}\n`);
    const execution = executeCommand([process.execPath, resolvedExecutor, inputFile], workspace, timeoutMs, safeEnvironment({
      CITADEL_BENCHMARK_MODE: mode,
    }));
    completed = execution.status === 0;
    if (execution.timed_out) failure = { code: FAILURE_CODES.execution_timeout };
    else if (!completed) failure = { code: FAILURE_CODES.execution };
    if (isContainedPath(sandbox, outputFile, { regularFile: true })) {
      try {
        adapter = validateAdapter(JSON.parse(fs.readFileSync(outputFile, 'utf8')));
      } catch (_) {
        failure = failure || { code: FAILURE_CODES.adapter_output };
        completed = false;
      }
    } else if (completed) {
      failure = failure || { code: FAILURE_CODES.adapter_output };
      completed = false;
    }
    const verification = executeCommand(scenario.verification_command, workspace, timeoutMs);
    artifactPaths = scenario.expected_artifacts.filter((relative) => (
      isContainedPath(workspace, resolveContained(workspace, relative))
    ));
    verificationPassed = verification.status === 0 && artifactPaths.length === scenario.expected_artifacts.length;
    if (!verificationPassed) failure = failure || { code: FAILURE_CODES.verification };
    const status = executeCommand(['git', 'status', '--porcelain'], workspace, timeoutMs);
    gitClean = status.status === 0 && status.stdout.trim() === '';
  } catch (error) {
    failure = { code: error instanceof BenchmarkRunError ? error.code : FAILURE_CODES.unexpected };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
  const workspaceRemoved = !fs.existsSync(sandbox);
  const checks = scenario.cleanup_assertions.map((assertion) => (
    assertion === 'git_clean' ? gitClean : workspaceRemoved
  ));
  return {
    schema: 1,
    evidence_kind: 'actual-run',
    scenario_set_id: scenarioSetIdentity(scenarios),
    scenario_id: scenario.id,
    category: scenario.category,
    mode,
    repetition,
    citadel_version: citadelVersion,
    runtime_version: scenario.runtime,
    model: scenario.model,
    timeout_minutes: scenario.timeout_minutes,
    task_hash: digest(scenario.task),
    verification_command: scenario.verification_command,
    started_at: startedAt,
    duration_ms: Date.now() - started,
    completed,
    verification_passed: verificationPassed,
    failure,
    human_interventions: adapter.human_interventions,
    input_tokens: adapter.input_tokens,
    output_tokens: adapter.output_tokens,
    estimated_cost: adapter.estimated_cost,
    regressions: adapter.regressions,
    resume_succeeded: adapter.resume_succeeded,
    cleanup_passed: checks.every(Boolean),
    artifact_paths: artifactPaths,
    attestation: null,
  };
}

module.exports = {
  FAILURE_CODES,
  contained,
  execute,
  generateFixtureRuns,
  isContainedPath,
  resolveContained,
  runScenario,
  safeEnvironment,
  validateAdapter,
};

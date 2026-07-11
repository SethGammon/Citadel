#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CATEGORIES,
  loadFreeze,
  loadScenarios,
  metricSetIdentity,
  scenarioSetIdentity,
  validateScenario,
  validateFreeze,
} = require('../core/benchmark/contract');
const { attestRun, buildReport } = require('../core/benchmark/report');
const {
  FAILURE_CODES, contained, execute, generateFixtureRuns, isContainedPath, resolveContained,
  runScenario, safeEnvironment,
} = require('../core/benchmark/runner');

const ROOT = path.resolve(__dirname, '..');
const SCENARIOS = path.join(ROOT, 'benchmarks', 'product-proof', 'scenarios');
const CLI = path.join(__dirname, 'product-benchmark.js');

function invoke(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
}

function main() {
  const scenarios = loadScenarios(SCENARIOS);
  assert.strictEqual(scenarios.length, 10);
  for (const category of CATEGORIES) assert(scenarios.some((item) => item.category === category));
  for (const scenario of scenarios) {
    assert.match(scenario.pinned_ref, /^[0-9a-f]{40}$/);
    if (scenario.verification_command[0] === 'node') {
      assert(fs.existsSync(path.join(ROOT, scenario.verification_command[1])), `${scenario.id} verifier must exist`);
    }
  }

  const freezePath = path.join(ROOT, 'benchmarks', 'product-proof', 'freeze.json');
  const freeze = loadFreeze(freezePath, scenarios);
  assert.strictEqual(freeze.scenario_set_id, scenarioSetIdentity(scenarios));
  assert.strictEqual(freeze.metric_set_id, metricSetIdentity());
  assert.strictEqual(freeze.external_scenario, null, 'external selection must not be fabricated');
  const reportOptions = { freeze, scenarios };

  assert.throws(() => validateScenario({ ...scenarios[0], unexpected: true }), /fields must exactly match/);
  assert.throws(() => validateScenario({ ...scenarios[0], pinned_ref: 'main' }), /full commit SHA/);
  assert.throws(() => validateScenario({ ...scenarios[0], expected_artifacts: ['../escape'] }), /escapes/);

  const runs = generateFixtureRuns(scenarios, 3);
  assert.strictEqual(runs.length, 60);
  assert(runs.every((run) => run.evidence_kind === 'fixture-simulation'));
  for (const scenario of scenarios) {
    for (const mode of ['bare', 'harnessed']) {
      assert.strictEqual(runs.filter((run) => run.scenario_id === scenario.id && run.mode === mode).length, 3);
    }
  }
  const report = buildReport(runs, reportOptions);
  assert.strictEqual(report.utility_gate.status, 'open');
  assert.strictEqual(report.utility_gate.engineering_threshold_met, false);
  assert(report.utility_gate.blockers.includes('UTILITY_THRESHOLD_MISSED'));
  assert(report.utility_gate.blockers.includes('EXTERNAL_SCENARIO_NOT_SELECTED'));
  assert(report.utility_gate.blockers.includes('ACTUAL_RUNS_REQUIRED'));
  assert.match(report.limitations[0], /engineering contract only/);
  assert.deepStrictEqual(buildReport([...runs].reverse(), reportOptions), report, 'raw order must not change aggregates');
  assert.throws(() => buildReport(runs.slice(0, -1), reportOptions), /Missing symmetric pair/);

  const asymmetric = runs.map((run) => ({ ...run }));
  asymmetric.find((run) => run.mode === 'harnessed').model = 'different-model';
  assert.throws(() => buildReport(asymmetric, reportOptions), /frozen scenario manifest/);
  assert.throws(() => validateFreeze({ ...freeze, scenario_set_id: 'scenario-set-sha256:forged' }, scenarios), /scenario_set_id mismatch/);
  assert.throws(() => buildReport(runs.map((run) => ({ ...run, scenario_set_id: 'scenario-set-sha256:forged' })), reportOptions), /frozen scenario set identity/);

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const selectedFreeze = {
    ...freeze,
    external_scenario: {
      scenario_id: scenarios[0].id,
      selected_by: 'external-reviewer',
      selected_at: '2026-07-10',
      selection_source: 'https://example.com/benchmark-review',
    },
    attestation_public_key: publicKeyPem,
  };
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaPublicPem = rsa.publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => validateFreeze({ ...selectedFreeze, attestation_public_key: rsaPublicPem }, scenarios), /must be Ed25519/);
  assert.throws(() => attestRun(runs[0], rsa.privateKey), /must be Ed25519/);
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.throws(() => attestRun(runs[0], ec.privateKey), /must be Ed25519/);
  const passingActual = runs.map((run) => attestRun({
    ...run,
    human_interventions: run.mode === 'bare' ? 2 : 1,
    estimated_cost: run.mode === 'bare' ? 1 : 1.1,
  }, privateKey));
  const passingReport = buildReport(passingActual, { freeze: selectedFreeze, scenarios });
  assert.strictEqual(passingReport.utility_gate.status, 'passed');
  assert.strictEqual(passingReport.utility_gate.no_worse_verified_completion, true);
  assert.strictEqual(passingReport.utility_gate.intervention_reduction_met, true);
  assert.strictEqual(passingReport.utility_gate.median_cost_overhead_met, true);

  const retainedFailure = passingActual.map((run, index) => (index === 0 ? attestRun({
    ...run, attestation: null, completed: false, verification_passed: false,
    failure: { code: FAILURE_CODES.execution },
  }, privateKey) : run));
  const retainedReport = buildReport(retainedFailure, { freeze: selectedFreeze, scenarios });
  assert.strictEqual(retainedReport.modes.bare.runs + retainedReport.modes.harnessed.runs, 60);
  assert(retainedReport.modes.bare.verified_completion_rate < 1, 'failed run must remain in aggregates');
  const relabeledFixture = runs.map((run) => ({ ...run, evidence_kind: 'actual-run' }));
  assert.throws(() => buildReport(relabeledFixture, { freeze: selectedFreeze, scenarios }), /Invalid actual-run attestation/);
  const tamperedActual = passingActual.map((run, index) => (index === 0 ? { ...run, estimated_cost: 0 } : run));
  const tamperedReport = buildReport(tamperedActual, { freeze: selectedFreeze, scenarios });
  assert.strictEqual(tamperedReport.utility_gate.status, 'open');
  assert(tamperedReport.utility_gate.blockers.includes('ACTUAL_RUNS_UNATTESTED'));
  assert.throws(() => buildReport(runs.map((run, index) => (index === 0 ? { ...run, completed: 'false' } : run)), reportOptions), /Invalid completed/);
  assert.throws(() => buildReport(runs.map((run, index) => (index === 0 ? { ...run, repetition: '1' } : run)), reportOptions), /Invalid repetition/);

  const sandbox = path.join(os.tmpdir(), 'citadel-benchmark-containment');
  assert.strictEqual(contained(sandbox, path.join(sandbox, 'child')), true);
  assert.strictEqual(contained(sandbox, path.resolve(sandbox, '..', 'escape')), false);
  assert.throws(() => resolveContained(sandbox, '../escape'), /escapes/);
  const fileStat = { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
  const symlinkStat = { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false };
  assert.strictEqual(isContainedPath(sandbox, path.join(sandbox, 'output.json'), {
    regularFile: true,
    fsImpl: { lstatSync: () => symlinkStat, realpathSync: () => path.join(sandbox, 'output.json') },
  }), false, 'final symlinks must be rejected without relying on host symlink support');
  assert.strictEqual(isContainedPath(sandbox, path.join(sandbox, 'linked', 'output.json'), {
    regularFile: true,
    fsImpl: { lstatSync: () => fileStat, realpathSync: () => path.resolve(sandbox, '..', 'outside.json') },
  }), false, 'intermediate symlink escapes must be rejected by realpath containment');
  process.env.CITADEL_TEST_SECRET = 'must-not-cross';
  assert.strictEqual(safeEnvironment().CITADEL_TEST_SECRET, undefined);
  delete process.env.CITADEL_TEST_SECRET;
  const timed = execute([process.execPath, '-e', 'setInterval(() => {}, 1000)'], ROOT, 50);
  assert(timed.timed_out || timed.signal, 'executor must enforce a timeout');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-product-benchmark-test-'));
  try {
    const executorFile = path.join(temp, 'executor.js');
    fs.writeFileSync(executorFile, '// test adapter\n', 'utf8');
    const containmentRoot = path.join(temp, 'containment');
    const externalJson = path.join(temp, 'external.json');
    const liveLink = path.join(containmentRoot, 'executor-output.json');
    fs.mkdirSync(containmentRoot);
    fs.writeFileSync(externalJson, '{"human_interventions":999}', 'utf8');
    let symlinkSupported = false;
    try {
      fs.symlinkSync(externalJson, liveLink, 'file');
      symlinkSupported = true;
      assert.strictEqual(isContainedPath(containmentRoot, liveLink, { regularFile: true }), false);
      fs.unlinkSync(liveLink);
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
    const scenario = scenarios[0];
    const sensitiveMarker = ['sensitive', 'marker'].join('-');
    const sensitivePassword = ['sample', 'password'].join('-');
    const authorizationFailure = ['Authorization:', 'Bearer', sensitiveMarker].join(' ');
    function fakeCommand(failStage = null) {
      return (argv) => {
        const ok = { status: 0, stdout: '', stderr: '', error: null, timed_out: false };
        if (argv[0] === 'git' && argv[1] === 'clone') {
          if (failStage === 'clone') return { ...ok, status: 1, stderr: authorizationFailure };
          const workspace = argv.at(-1);
          fs.mkdirSync(workspace, { recursive: true });
          for (const artifact of scenario.expected_artifacts) {
            const file = path.join(workspace, artifact);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, 'fixture', 'utf8');
          }
          return ok;
        }
        if (argv[0] === 'git' && argv[1] === 'checkout') {
          return failStage === 'checkout' ? { ...ok, status: 1, error: sensitiveMarker } : ok;
        }
        if (argv[0] === 'node' && argv[1] === '--version') {
          return failStage === 'setup' ? { ...ok, status: 1, stderr: ['password', sensitivePassword].join('=') } : ok;
        }
        if (argv[0] === process.execPath && path.resolve(argv[1] || '') === path.resolve(executorFile)) {
          const input = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
          if (failStage === 'adapter') fs.writeFileSync(input.output_path, '{invalid', 'utf8');
          else if (failStage === 'adapter-symlink') fs.symlinkSync(externalJson, input.output_path, 'file');
          else if (failStage === 'adapter-empty') fs.writeFileSync(input.output_path, '{}', 'utf8');
          else if (!['execution', 'timeout'].includes(failStage)) fs.writeFileSync(input.output_path, JSON.stringify({
            schema: 1,
            human_interventions: 1,
            input_tokens: 100,
            output_tokens: 50,
            estimated_cost: 0.1,
            regressions: 0,
            resume_succeeded: false,
          }), 'utf8');
          if (failStage === 'timeout') return { ...ok, status: null, timed_out: true, stderr: ['token', sensitiveMarker].join('=') };
          if (failStage === 'execution') return { ...ok, status: 1, stderr: ['api_key', sensitiveMarker].join('=') };
          return ok;
        }
        if (argv[0] === 'git' && argv[1] === 'status') {
          return failStage === 'git-status' ? { ...ok, status: 1 } : ok;
        }
        if (failStage === 'verification') return { ...ok, status: 1, stderr: ['Authorization:', sensitiveMarker].join(' ') };
        return ok;
      };
    }
    const expectedFailures = {
      clone: FAILURE_CODES.clone,
      checkout: FAILURE_CODES.checkout,
      setup: FAILURE_CODES.setup,
      execution: FAILURE_CODES.execution,
      timeout: FAILURE_CODES.execution_timeout,
      adapter: FAILURE_CODES.adapter_output,
      'adapter-empty': FAILURE_CODES.adapter_output,
      verification: FAILURE_CODES.verification,
    };
    if (symlinkSupported) expectedFailures['adapter-symlink'] = FAILURE_CODES.adapter_output;
    for (const [stage, code] of Object.entries(expectedFailures)) {
      const failedRun = runScenario({
        scenario,
        scenarios,
        mode: 'bare',
        repetition: 1,
        executorFile,
        executeCommand: fakeCommand(stage),
      });
      assert.deepStrictEqual(failedRun.failure, { code }, `${stage} must use a closed failure code`);
      if (stage === 'verification') {
        assert.strictEqual(failedRun.verification_passed, false);
      } else {
        assert.strictEqual(failedRun.completed, false, `${stage} failure must not count as completed`);
      }
      assert(!JSON.stringify(failedRun).includes(sensitiveMarker));
      assert(!JSON.stringify(failedRun).includes(sensitivePassword));
      if (stage === 'adapter-symlink') assert.strictEqual(failedRun.human_interventions, 0, 'symlink target must not be read');
    }
    const dirtyEvidence = runScenario({
      scenario: { ...scenario, cleanup_assertions: ['git_clean'] },
      scenarios,
      mode: 'bare',
      repetition: 1,
      executorFile,
      executeCommand: fakeCommand('git-status'),
    });
    assert.strictEqual(dirtyEvidence.cleanup_passed, false, 'failed git status must not prove a clean workspace');

    const raw = path.join(temp, 'raw.jsonl');
    const aggregate = path.join(temp, 'aggregate.json');
    const fixture = invoke(['fixture', '--output', raw, '--repetitions', '3']);
    assert.strictEqual(fixture.status, 0, fixture.stderr);
    const generated = fs.readFileSync(raw, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.deepStrictEqual(generated, runs);
    const reportRun = invoke(['report', '--input', raw, '--output', aggregate]);
    assert.strictEqual(reportRun.status, 0, reportRun.stderr);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(aggregate, 'utf8')), report);
    const forgedSelection = invoke(['report', '--input', raw, '--output', aggregate, '--external-scenario-selected', 'true']);
    assert.strictEqual(forgedSelection.status, 0, forgedSelection.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(aggregate, 'utf8')).external_scenario_selected, false,
      'CLI flags must not fabricate external selection outside the freeze record');
    const overrideAttempt = invoke(['report', '--input', raw, '--output', aggregate, '--freeze', path.join(temp, 'fake-freeze.json')]);
    assert.notStrictEqual(overrideAttempt.status, 0, 'publishable report must reject caller-controlled freeze paths');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  process.stdout.write('Product benchmark tests passed.\n');
}

main();

'use strict';

const crypto = require('crypto');
const { assertSymmetricPair, canonical, digest, metricSetIdentity, scenarioSetIdentity, validateFreeze } = require('./contract');

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rate(runs, predicate) {
  return runs.length ? runs.filter(predicate).length / runs.length : null;
}

function rounded(value) {
  return value === null ? null : Number(value.toFixed(6));
}

function validateRun(run) {
  const required = [
    'schema', 'evidence_kind', 'scenario_set_id', 'scenario_id', 'category', 'mode',
    'repetition', 'citadel_version', 'runtime_version', 'model', 'timeout_minutes',
    'task_hash', 'verification_command', 'started_at', 'duration_ms', 'completed',
    'verification_passed', 'human_interventions', 'input_tokens', 'output_tokens',
    'estimated_cost', 'resume_succeeded', 'cleanup_passed', 'regressions', 'artifact_paths',
    'attestation',
  ];
  for (const field of required) if (!(field in run)) throw new Error(`Run is missing ${field}`);
  if (run.schema !== 1 || !['fixture-simulation', 'actual-run'].includes(run.evidence_kind)) throw new Error('Invalid run schema or evidence kind');
  if (!['bare', 'harnessed'].includes(run.mode)) throw new Error('Invalid run mode');
  for (const field of ['scenario_set_id', 'scenario_id', 'category', 'citadel_version', 'runtime_version', 'model', 'task_hash', 'started_at']) {
    if (typeof run[field] !== 'string' || !run[field]) throw new Error(`Invalid ${field}`);
  }
  if (!Number.isInteger(run.repetition) || run.repetition < 1) throw new Error('Invalid repetition');
  if (!Number.isInteger(run.timeout_minutes) || run.timeout_minutes < 1) throw new Error('Invalid timeout_minutes');
  for (const field of ['completed', 'verification_passed', 'resume_succeeded', 'cleanup_passed']) {
    if (typeof run[field] !== 'boolean') throw new Error(`Invalid ${field}`);
  }
  for (const field of ['duration_ms', 'human_interventions', 'input_tokens', 'output_tokens', 'estimated_cost', 'regressions']) {
    if (typeof run[field] !== 'number' || run[field] < 0 || !Number.isFinite(run[field])) throw new Error(`Invalid ${field}`);
  }
  for (const field of ['human_interventions', 'input_tokens', 'output_tokens', 'regressions']) {
    if (!Number.isInteger(run[field])) throw new Error(`Invalid ${field}`);
  }
  for (const field of ['verification_command', 'artifact_paths']) {
    if (!Array.isArray(run[field]) || run[field].some((value) => typeof value !== 'string')) throw new Error(`Invalid ${field}`);
  }
  if ('failure' in run && run.failure !== null
    && (typeof run.failure !== 'object' || typeof run.failure.code !== 'string' || !run.failure.code)) {
    throw new Error('Invalid failure');
  }
  if (run.evidence_kind === 'fixture-simulation' && run.attestation !== null) throw new Error('Fixture evidence cannot be attested');
  if (run.evidence_kind === 'actual-run') {
    const keys = run.attestation && typeof run.attestation === 'object' && !Array.isArray(run.attestation)
      ? Object.keys(run.attestation).sort() : [];
    if (canonical(keys) !== canonical(['algorithm', 'signature_base64'])
      || run.attestation.algorithm !== 'ed25519'
      || typeof run.attestation.signature_base64 !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(run.attestation.signature_base64)) {
      throw new Error('Invalid actual-run attestation');
    }
  }
  return run;
}

function unsignedRun(run) {
  return { ...run, attestation: null };
}

function attestRun(run, privateKey) {
  const parsedPrivateKey = privateKey && privateKey.type === 'private'
    ? privateKey : crypto.createPrivateKey(privateKey);
  if (parsedPrivateKey.asymmetricKeyType !== 'ed25519') throw new Error('Benchmark attestation private key must be Ed25519');
  const checked = { ...run, evidence_kind: 'actual-run', attestation: null };
  const signature = crypto.sign(null, Buffer.from(canonical(checked)), parsedPrivateKey).toString('base64');
  return { ...checked, attestation: { algorithm: 'ed25519', signature_base64: signature } };
}

function verifyRunAttestation(run, publicKey) {
  try {
    const parsedPublicKey = publicKey && publicKey.type === 'public'
      ? publicKey : crypto.createPublicKey(publicKey);
    return run.evidence_kind === 'actual-run'
      && run.attestation?.algorithm === 'ed25519'
      && parsedPublicKey.asymmetricKeyType === 'ed25519'
      && crypto.verify(
        null,
        Buffer.from(canonical(unsignedRun(run))),
        parsedPublicKey,
        Buffer.from(run.attestation.signature_base64, 'base64'),
      );
  } catch {
    return false;
  }
}

function summarize(runs) {
  return {
    runs: runs.length,
    verified_completion_rate: rate(runs, (run) => !run.failure && run.completed && run.verification_passed),
    completion_recovery_rate: rate(runs, (run) => !run.failure && ((run.completed && run.verification_passed) || run.resume_succeeded)),
    total_human_interventions: runs.reduce((sum, run) => sum + run.human_interventions, 0),
    median_duration_ms: median(runs.map((run) => run.duration_ms)),
    median_estimated_cost: median(runs.map((run) => run.estimated_cost)),
    regression_count: runs.reduce((sum, run) => sum + run.regressions, 0),
    cleanup_rate: rate(runs, (run) => run.cleanup_passed),
  };
}

function improvement(bare, harnessed) {
  const interventionReduction = bare.total_human_interventions === 0
    ? 0
    : (bare.total_human_interventions - harnessed.total_human_interventions) / bare.total_human_interventions;
  const recoveryGain = harnessed.completion_recovery_rate - bare.completion_recovery_rate;
  const overhead = bare.median_estimated_cost === 0
    ? (harnessed.median_estimated_cost === 0 ? 0 : null)
    : (harnessed.median_estimated_cost - bare.median_estimated_cost) / bare.median_estimated_cost;
  return {
    intervention_reduction: rounded(interventionReduction),
    completion_recovery_gain: rounded(recoveryGain),
    median_cost_overhead: rounded(overhead),
  };
}

function buildReport(inputRuns, options = {}) {
  if (!Array.isArray(options.scenarios)) throw new Error('Benchmark report requires the authoritative scenarios');
  const freeze = validateFreeze(options.freeze, options.scenarios);
  const runs = inputRuns.map(validateRun).sort((a, b) => canonical([
    a.scenario_id, a.mode, a.repetition,
  ]).localeCompare(canonical([b.scenario_id, b.mode, b.repetition])));
  if (!runs.length) throw new Error('At least one run is required');
  const scenarioSetIds = new Set(runs.map((run) => run.scenario_set_id));
  if (scenarioSetIds.size !== 1) throw new Error('Runs mix scenario set identities');
  if (runs[0].scenario_set_id !== scenarioSetIdentity(options.scenarios)) throw new Error('Runs do not match the frozen scenario set identity');
  const keys = new Set();
  for (const run of runs) {
    const key = `${run.scenario_id}/${run.mode}/${run.repetition}`;
    if (keys.has(key)) throw new Error(`Duplicate run: ${key}`);
    keys.add(key);
  }
  const scenarios = [...new Set(runs.map((run) => run.scenario_id))];
  const expectedScenarioIds = options.scenarios.map((scenario) => scenario.id).sort();
  if (canonical([...scenarios].sort()) !== canonical(expectedScenarioIds)) throw new Error('Runs do not cover the frozen scenario set');
  const manifests = new Map(options.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const run of runs) {
    const scenario = manifests.get(run.scenario_id);
    const expected = {
      category: scenario.category,
      runtime_version: scenario.runtime,
      model: scenario.model,
      timeout_minutes: scenario.timeout_minutes,
      task_hash: digest(scenario.task),
      verification_command: scenario.verification_command,
    };
    for (const [field, value] of Object.entries(expected)) {
      if (canonical(run[field]) !== canonical(value)) throw new Error(`Run does not match frozen scenario manifest: ${run.scenario_id}/${field}`);
    }
  }
  for (const scenarioId of scenarios) {
    const scenarioRuns = runs.filter((run) => run.scenario_id === scenarioId);
    for (const repetition of [...new Set(scenarioRuns.map((run) => run.repetition))]) {
      const pair = scenarioRuns.filter((run) => run.repetition === repetition);
      if (pair.length !== 2) throw new Error(`Missing symmetric pair for ${scenarioId}/${repetition}`);
      assertSymmetricPair(pair[0], pair[1]);
    }
  }
  const repetitions = Math.min(...scenarios.flatMap((id) => ['bare', 'harnessed'].map((mode) => (
    runs.filter((run) => run.scenario_id === id && run.mode === mode).length
  ))));
  if (repetitions < 3) throw new Error('Benchmark reports require at least 3 repetitions per mode and scenario');
  const bare = summarize(runs.filter((run) => run.mode === 'bare'));
  const harnessed = summarize(runs.filter((run) => run.mode === 'harnessed'));
  const target = runs.filter((run) => ['long_task', 'context_reset', 'parallel_work'].includes(run.category));
  const targetBare = summarize(target.filter((run) => run.mode === 'bare'));
  const targetHarnessed = summarize(target.filter((run) => run.mode === 'harnessed'));
  const delta = improvement(targetBare, targetHarnessed);
  const noWorse = harnessed.verified_completion_rate >= bare.verified_completion_rate;
  const utility = noWorse
    && (delta.intervention_reduction >= 0.25 || delta.completion_recovery_gain >= 0.20)
    && delta.median_cost_overhead !== null && delta.median_cost_overhead <= 0.15;
  const evidenceKinds = [...new Set(runs.map((run) => run.evidence_kind))].sort();
  const externalScenarioSelected = freeze.external_scenario !== null;
  const actualRunsAttested = runs.filter((run) => run.evidence_kind === 'actual-run')
    .every((run) => verifyRunAttestation(run, freeze.attestation_public_key));
  return {
    schema: 1,
    report_id: `benchmark-report-sha256:${digest(runs)}`,
    scenario_set_id: runs[0].scenario_set_id,
    metric_set_id: metricSetIdentity(),
    evidence_kind: evidenceKinds.length === 1 ? evidenceKinds[0] : 'mixed',
    generated_from_raw_sha256: digest(runs),
    generated_at: options.generatedAt || runs.map((run) => run.started_at).sort().at(-1),
    frozen_inputs: true,
    external_scenario_selected: externalScenarioSelected,
    external_scenario: freeze.external_scenario,
    actual_run_attestation_verified: actualRunsAttested && evidenceKinds.every((kind) => kind === 'actual-run'),
    repetitions_per_mode_minimum: repetitions,
    modes: { bare, harnessed },
    target_long_segment: { bare: targetBare, harnessed: targetHarnessed, delta },
    utility_gate: {
      status: utility && externalScenarioSelected && evidenceKinds.every((kind) => kind === 'actual-run') && actualRunsAttested ? 'passed' : 'open',
      engineering_threshold_met: utility,
      no_worse_verified_completion: noWorse,
      intervention_reduction_met: delta.intervention_reduction >= 0.25,
      completion_recovery_gain_met: delta.completion_recovery_gain >= 0.20,
      median_cost_overhead_met: delta.median_cost_overhead !== null && delta.median_cost_overhead <= 0.15,
      blockers: [
        ...(!utility ? ['UTILITY_THRESHOLD_MISSED'] : []),
        ...(!externalScenarioSelected ? ['EXTERNAL_SCENARIO_NOT_SELECTED'] : []),
        ...(!evidenceKinds.every((kind) => kind === 'actual-run') ? ['ACTUAL_RUNS_REQUIRED'] : []),
        ...(evidenceKinds.includes('actual-run') && !actualRunsAttested ? ['ACTUAL_RUNS_UNATTESTED'] : []),
      ],
    },
    limitations: evidenceKinds.includes('fixture-simulation') ? [
      'Fixture/simulation evidence validates the engineering contract only.',
      'No LLM, human reviewer, or external repository task was executed.',
      'The real benchmark gate remains open until actual symmetric runs and external scenario selection complete.',
    ] : [],
  };
}

module.exports = { attestRun, buildReport, median, summarize, validateRun, verifyRunAttestation };

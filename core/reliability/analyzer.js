'use strict';

const { assertValidRecord } = require('./schema');

const MINIMUMS = Object.freeze({ runs: 100, repositories: 20, runtimes: 2, held_out_runs: 20 });

function rounded(value) {
  return Number(value.toFixed(6));
}

function countBy(records, field) {
  return Object.fromEntries([...new Set(records.map((record) => record[field]))].sort()
    .map((value) => [value, records.filter((record) => record[field] === value).length]));
}

function mean(records, field) {
  return records.length ? rounded(records.reduce((sum, record) => sum + record[field], 0) / records.length) : null;
}

function successRate(records) {
  return records.length ? rounded(records.filter((record) => record.outcome === 'passed' && record.verified).length / records.length) : null;
}

function candidateStats(records, mode) {
  const selected = records.filter((record) => record.execution_mode === mode);
  return Object.freeze({
    execution_mode: mode,
    runs: selected.length,
    verified_passes: selected.filter((record) => record.outcome === 'passed' && record.verified).length,
    verified_success_rate: successRate(selected),
    mean_human_interventions: mean(selected, 'human_interventions'),
    mean_duration_ms: mean(selected, 'duration_ms'),
    mean_estimated_cost_microusd: mean(selected, 'estimated_cost_microusd'),
  });
}

function compareCandidates(left, right) {
  if (left.verified_success_rate !== right.verified_success_rate) return right.verified_success_rate - left.verified_success_rate;
  if (left.mean_human_interventions !== right.mean_human_interventions) return left.mean_human_interventions - right.mean_human_interventions;
  if (left.mean_estimated_cost_microusd !== right.mean_estimated_cost_microusd) return left.mean_estimated_cost_microusd - right.mean_estimated_cost_microusd;
  if (left.mean_duration_ms !== right.mean_duration_ms) return left.mean_duration_ms - right.mean_duration_ms;
  return left.execution_mode.localeCompare(right.execution_mode);
}

function sufficiency(records) {
  const repositoryCount = new Set(records.map((record) => record.repo_id)).size;
  const runtimeCount = new Set(records.map((record) => record.runtime)).size;
  const heldOutCount = records.filter((record) => record.held_out).length;
  const trainingModes = new Set(records.filter((record) => !record.held_out).map((record) => record.execution_mode));
  const heldOutModes = new Set(records.filter((record) => record.held_out).map((record) => record.execution_mode));
  const overlap = [...trainingModes].filter((mode) => heldOutModes.has(mode)).length;
  const gates = Object.freeze({
    runs: { actual: records.length, required: MINIMUMS.runs, passed: records.length >= MINIMUMS.runs },
    repositories: { actual: repositoryCount, required: MINIMUMS.repositories, passed: repositoryCount >= MINIMUMS.repositories },
    runtimes: { actual: runtimeCount, required: MINIMUMS.runtimes, passed: runtimeCount >= MINIMUMS.runtimes },
    held_out_runs: { actual: heldOutCount, required: MINIMUMS.held_out_runs, passed: heldOutCount >= MINIMUMS.held_out_runs },
    training_held_out_overlap: { actual: overlap, required: 1, passed: overlap >= 1 },
  });
  return Object.freeze({ passed: Object.values(gates).every((gate) => gate.passed), gates });
}

function confidenceFor(records) {
  const rate = successRate(records) || 0;
  const score = rounded(Math.min(1, records.length / 20) * rate);
  const level = records.length >= 20 && rate >= 0.8 ? 'high'
    : records.length >= 10 && rate >= 0.6 ? 'medium' : 'low';
  return Object.freeze({
    level,
    score,
    basis: Object.freeze({ held_out_runs: records.length, held_out_verified_success_rate: rate }),
  });
}

function unknownResult(records, gate) {
  return Object.freeze({
    schema: 1,
    kind: 'reliability_analysis',
    status: 'unknown',
    sufficiency: gate,
    recommendation: null,
    reason_code: 'INSUFFICIENT_REPRESENTATIVE_EVIDENCE',
    auto_apply: false,
  });
}

function analyze(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  records.forEach(assertValidRecord);
  if (new Set(records.map((record) => record.run_id)).size !== records.length) throw new TypeError('run_id values must be unique');
  const gate = sufficiency(records);
  if (!gate.passed) return unknownResult(records, gate);

  const training = records.filter((record) => !record.held_out);
  const heldOut = records.filter((record) => record.held_out);
  const candidates = [...new Set(training.map((record) => record.execution_mode))]
    .filter((mode) => heldOut.some((record) => record.execution_mode === mode))
    .map((mode) => candidateStats(training, mode)).sort(compareCandidates);
  if (!candidates.length) return unknownResult(records, gate);
  const selected = candidates[0];
  const heldOutSelected = heldOut.filter((record) => record.execution_mode === selected.execution_mode);
  const heldOutStats = candidateStats(heldOut, selected.execution_mode);
  const confidence = confidenceFor(heldOutSelected);
  return Object.freeze({
    schema: 1,
    kind: 'reliability_analysis',
    status: 'available',
    sufficiency: gate,
    recommendation: Object.freeze({
      kind: 'execution_mode',
      value: selected.execution_mode,
      explanation: `Selected from training evidence by verified success, interventions, cost, duration, then stable name order. Held-out evidence remains separate.`,
      evidence: Object.freeze({
        total_runs: records.length,
        training_runs: training.length,
        held_out_runs: heldOut.length,
        opaque_repository_count: new Set(records.map((record) => record.repo_id)).size,
        runtime_counts: countBy(records, 'runtime'),
        selected_training: selected,
        selected_held_out: heldOutStats,
        candidate_training: candidates,
      }),
      confidence,
    }),
    reason_code: 'HELD_OUT_EVIDENCE_AVAILABLE',
    auto_apply: false,
  });
}

module.exports = Object.freeze({
  MINIMUMS,
  analyze,
  candidateStats,
  compareCandidates,
  confidenceFor,
  sufficiency,
});

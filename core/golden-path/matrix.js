'use strict';

const crypto = require('crypto');

const PLATFORMS = ['win32', 'linux', 'darwin'];
const RUNTIMES = ['claude', 'codex'];
const MODE = 'fixture-automation-matrix';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function finiteMetric(value, name, allowUnavailable = false) {
  if (allowUnavailable && value === null) return null;
  invariant(Number.isFinite(value) && value >= 0, `Invalid ${name} metric`);
  return value;
}

function stepPassed(steps, id) {
  const step = steps.find((item) => item && item.id === id);
  return Boolean(step && ['passed', 'succeeded'].includes(step.status));
}

function normalizeResult(result, options = {}) {
  invariant(isObject(result), 'Golden-path result must be an object');
  invariant(result.schema === 1, 'Golden-path result schema must be 1');
  invariant(result.mode === 'fixture-automation', 'Golden-path result mode is incompatible');
  invariant(RUNTIMES.includes(result.runtime), `Unsupported runtime: ${result.runtime}`);
  invariant(PLATFORMS.includes(result.platform), `Unsupported platform: ${result.platform}`);
  invariant(typeof result.fixture_id === 'string' && result.fixture_id, 'Result fixture_id is required');
  invariant(['passed', 'failed'].includes(result.status), 'Result status must be passed or failed');
  invariant(Array.isArray(result.steps), 'Result steps must be an array');
  invariant(isObject(result.metrics), 'Result metrics are required');
  invariant(isObject(result.resume), 'Result resume evidence is required');
  invariant(isObject(result.rollback), 'Result rollback evidence is required');
  invariant(Array.isArray(result.limitations), 'Result limitations must be an array');

  const passed = result.status === 'passed';
  const metrics = {
    install_to_route_ms: finiteMetric(result.metrics.install_to_route_ms, 'install_to_route_ms', !passed),
    install_to_verified_handoff_ms: finiteMetric(
      result.metrics.install_to_verified_handoff_ms,
      'install_to_verified_handoff_ms',
      !passed,
    ),
    total_ms: finiteMetric(result.metrics.total_ms, 'total_ms', !passed),
  };
  const resumeResolved = ['passed', 'resolved'].includes(result.resume.status) || result.resume.resolved === true;
  const rollbackExact = ['passed', 'exact'].includes(result.rollback.status)
    && result.rollback.before_digest === result.rollback.after_digest
    && result.rollback.workspace_removed === true;
  const runId = result.run_id || options.runId || stableId(canonical(result));

  return {
    run_id: runId,
    fixture_id: result.fixture_id,
    runtime: result.runtime,
    platform: result.platform,
    status: result.status,
    failure: result.failure || null,
    metrics,
    install_setup_succeeded: passed && stepPassed(result.steps, 'install') && stepPassed(result.steps, 'setup'),
    verified_handoff_succeeded: passed && stepPassed(result.steps, 'verified-handoff'),
    resume_resolved: resumeResolved,
    rollback_exact: rollbackExact,
    limitations: [...result.limitations],
  };
}

function validateRun(run) {
  invariant(isObject(run), 'Matrix run must be an object');
  invariant(typeof run.run_id === 'string' && run.run_id, 'Matrix run_id is required');
  invariant(typeof run.fixture_id === 'string' && run.fixture_id, 'Matrix run fixture_id is required');
  invariant(RUNTIMES.includes(run.runtime), `Unsupported runtime: ${run.runtime}`);
  invariant(PLATFORMS.includes(run.platform), `Unsupported platform: ${run.platform}`);
  invariant(['passed', 'failed'].includes(run.status), 'Matrix run status is invalid');
  invariant(isObject(run.metrics), 'Matrix run metrics are required');
  for (const name of ['install_to_route_ms', 'install_to_verified_handoff_ms', 'total_ms']) {
    finiteMetric(run.metrics[name], name, run.status === 'failed');
  }
  for (const name of ['install_setup_succeeded', 'verified_handoff_succeeded', 'resume_resolved', 'rollback_exact']) {
    invariant(typeof run[name] === 'boolean', `Matrix run ${name} must be boolean`);
  }
  return { ...run, metrics: { ...run.metrics }, limitations: [...(run.limitations || [])] };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  invariant(fraction > 0 && fraction <= 1, 'Percentile fraction must be in (0, 1]');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function rate(runs, predicate) {
  return runs.length ? runs.filter(predicate).length / runs.length : 0;
}

function summarizeCell(runs) {
  const routeTimings = runs.map((run) => run.metrics.install_to_route_ms).filter(Number.isFinite);
  const handoffTimings = runs.map((run) => run.metrics.install_to_verified_handoff_ms).filter(Number.isFinite);
  return {
    total: runs.length,
    successes: runs.filter((run) => run.status === 'passed').length,
    success_rate: rate(runs, (run) => run.status === 'passed'),
    aggregate_metrics: {
      median_install_to_route_ms: median(routeTimings),
      p90_install_to_verified_handoff_ms: percentile(handoffTimings, 0.9),
    },
  };
}

function buildMatrix({ fixtureId, runs, sources = [], generatedAt = new Date().toISOString(), limitations = [] }) {
  invariant(typeof fixtureId === 'string' && fixtureId, 'Matrix fixture_id is required');
  const normalized = runs.map(validateRun);
  const ids = new Set();
  for (const run of normalized) {
    invariant(!ids.has(run.run_id), `Duplicate run_id: ${run.run_id}`);
    invariant(run.fixture_id === fixtureId, `Run ${run.run_id} fixture_id does not match matrix fixture_id`);
    ids.add(run.run_id);
  }

  const cells = {};
  for (const platform of PLATFORMS) {
    for (const runtime of RUNTIMES) {
      const key = `${platform}/${runtime}`;
      cells[key] = summarizeCell(normalized.filter((run) => run.platform === platform && run.runtime === runtime));
    }
  }
  const completeGrid = Object.values(cells).every((cell) => cell.total >= 5);
  const routeTimings = normalized.map((run) => run.metrics.install_to_route_ms).filter(Number.isFinite);
  const handoffTimings = normalized.map((run) => run.metrics.install_to_verified_handoff_ms).filter(Number.isFinite);
  const summary = {
    total_runs: normalized.length,
    complete_grid: completeGrid,
    fixture_success_rate: rate(normalized, (run) => run.status === 'passed'),
    install_setup_success_rate: rate(normalized, (run) => run.install_setup_succeeded),
    verified_handoff_success_rate: rate(normalized, (run) => run.verified_handoff_succeeded),
    resume_success_rate: rate(normalized, (run) => run.resume_resolved),
    rollback_success_rate: rate(normalized, (run) => run.rollback_exact),
    median_install_to_route_ms: median(routeTimings),
    p90_install_to_verified_handoff_ms: percentile(handoffTimings, 0.9),
  };
  summary.gates = {
    complete_grid: { threshold: '6 cells with >=5 actual runs', actual: completeGrid, passed: completeGrid },
    fixture_success: { threshold: '>0.95', actual: summary.fixture_success_rate, passed: summary.fixture_success_rate > 0.95 },
    install_setup_success: { threshold: '>0.95', actual: summary.install_setup_success_rate, passed: summary.install_setup_success_rate > 0.95 },
    verified_handoff_success: { threshold: '>0.95', actual: summary.verified_handoff_success_rate, passed: summary.verified_handoff_success_rate > 0.95 },
    route_median_ms: { threshold: '<600000', actual: summary.median_install_to_route_ms, passed: Number.isFinite(summary.median_install_to_route_ms) && summary.median_install_to_route_ms < 600000 },
    handoff_p90_ms: { threshold: '<900000', actual: summary.p90_install_to_verified_handoff_ms, passed: Number.isFinite(summary.p90_install_to_verified_handoff_ms) && summary.p90_install_to_verified_handoff_ms < 900000 },
    rollback_success: { threshold: '=1.0', actual: summary.rollback_success_rate, passed: summary.rollback_success_rate === 1 },
  };
  const gatesPassed = Object.values(summary.gates).every((gate) => gate.passed);
  const failureCode = !completeGrid ? 'MATRIX_INCOMPLETE_GRID' : (!gatesPassed ? 'MATRIX_GATES_FAILED' : null);

  return {
    schema: 1,
    mode: MODE,
    generated_at: generatedAt,
    fixture_id: fixtureId,
    status: failureCode ? 'failed' : 'passed',
    failure: failureCode ? { code: failureCode } : null,
    evidence_kind: 'fixture-automation-timing',
    sources,
    runs: normalized,
    cells,
    summary,
    limitations: [...new Set([
      'Fixture automation timings are not human or stranger install-to-value timings.',
      'Each run proves only the platform recorded by that run; missing platforms are never synthesized.',
      ...limitations,
      ...normalized.flatMap((run) => run.limitations),
    ])],
  };
}

function mergeMatrices(matrices, options = {}) {
  invariant(matrices.length > 0, 'At least one matrix is required');
  const fixtureId = matrices[0].fixture_id;
  const runs = [];
  const sources = [];
  const limitations = [];
  for (const matrix of matrices) {
    invariant(matrix.schema === 1 && matrix.mode === MODE, 'Incompatible matrix schema or mode');
    invariant(matrix.fixture_id === fixtureId, 'Cannot merge matrices with different fixture_id values');
    invariant(Array.isArray(matrix.runs), 'Matrix runs must be an array');
    runs.push(...matrix.runs);
    sources.push(...(matrix.sources || []));
    limitations.push(...(matrix.limitations || []));
  }
  const merged = buildMatrix({ fixtureId, runs, sources, limitations, generatedAt: options.generatedAt });
  if (options.requireComplete && !merged.summary.complete_grid) {
    merged.failure = { code: 'MATRIX_INCOMPLETE_GRID', required_runs: 30 };
  }
  return merged;
}

module.exports = {
  MODE,
  PLATFORMS,
  RUNTIMES,
  buildMatrix,
  median,
  mergeMatrices,
  normalizeResult,
  percentile,
  stableId,
};

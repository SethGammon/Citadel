'use strict';

const {
  COST_LENSES,
  digest,
  runtimeSettings,
  validateCatalog,
  validateHistory,
  validateRequest,
} = require('./contracts');

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function historyKey(planId, featureKey, value) {
  const settings = runtimeSettings(value);
  const suffix = Object.keys(settings).length ? `\u0000${digest(settings)}` : '';
  return `${planId}\u0000${featureKey}${suffix}`;
}

function indexHistory(history) {
  const index = new Map();
  for (const record of history) {
    const key = historyKey(record.plan_id, record.feature_key, record);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(record);
  }
  return index;
}

function recordsFor(plan, request, history, indexed = null) {
  const exactKey = historyKey(plan.plan_id, request.feature_key, plan);
  const allKey = historyKey(plan.plan_id, 'all', plan);
  if (indexed) {
    const exact = indexed.get(exactKey) || [];
    return exact.length ? exact : indexed.get(allKey) || [];
  }
  const exact = history.filter((record) => historyKey(record.plan_id, record.feature_key, record) === exactKey);
  return exact.length ? exact : history.filter((record) => historyKey(record.plan_id, record.feature_key, record) === allKey);
}

function wilsonLowerBound(probability, sampleSize, z = 1.281552) {
  if (sampleSize <= 0) return 0;
  const zSquared = z * z;
  const denominator = 1 + (zSquared / sampleSize);
  const center = probability + (zSquared / (2 * sampleSize));
  const margin = z * Math.sqrt(((probability * (1 - probability)) / sampleSize) + (zSquared / (4 * sampleSize * sampleSize)));
  return Math.max(0, (center - margin) / denominator);
}

function calibratedPrediction(plan, request, history, indexed = null) {
  const records = recordsFor(plan, request, history, indexed);
  const decided = records.filter((record) => record.verification_status !== 'unknown');
  const passed = decided.filter((record) => record.verification_status === 'passed').length;
  const strength = plan.prior.strength;
  const mean = ((plan.prior.success_probability * strength) + passed) / (strength + decided.length);
  const effectiveSample = strength + decided.length;
  const conservative = wilsonLowerBound(mean, effectiveSample);
  const observedDurations = records.map((record) => record.duration_ms).filter(Number.isFinite);
  const costs = {};
  for (const lens of COST_LENSES) {
    const observed = records
      .map((record) => record.costs[lens])
      .filter((cost) => cost.status === 'known')
      .map((cost) => cost.amount_usd);
    if (observed.length) {
      costs[lens] = {
        status: 'known',
        amount_usd: median(observed),
        basis: 'observed',
        source: `history:${records.length}-records`,
      };
    } else {
      costs[lens] = { ...plan.costs[lens] };
    }
  }
  return Object.freeze({
    plan_id: plan.plan_id,
    evidence_records: records.length,
    decided_records: decided.length,
    passed_records: passed,
    posterior_mean: Number(mean.toFixed(6)),
    conservative_probability: Number(conservative.toFixed(6)),
    expected_duration_ms: median(observedDurations) ?? plan.expected_duration_ms,
    costs,
    evidence_basis: decided.length ? 'verified-outcome-history' : 'declared-prior',
    confidence_method: '90-percent-one-sided-wilson-with-prior-pseudocounts',
  });
}

function planEligible(plan, request) {
  const reasons = [];
  if (plan.feature_keys.length && !plan.feature_keys.includes(request.feature_key)) reasons.push('FEATURE_NOT_SUPPORTED');
  if (request.constraints.privacy === 'local-only' && plan.privacy !== 'local-only') reasons.push('PRIVACY_REQUIRES_LOCAL');
  const disallowed = plan.tools.filter((tool) => !request.constraints.allowed_tools.includes(tool));
  if (disallowed.length) reasons.push('PLAN_USES_DISALLOWED_TOOL');
  return reasons;
}

function buildPath(root, byId) {
  const path = [];
  const seen = new Set();
  let current = root;
  while (current) {
    if (seen.has(current.plan_id)) throw new TypeError(`fallback cycle includes ${current.plan_id}`);
    seen.add(current.plan_id);
    path.push(current);
    const nextId = current.fallback_plan_ids[0];
    current = nextId ? byId.get(nextId) : null;
  }
  return path;
}

function aggregatePath(path, predictions) {
  let reach = 1;
  let success = 0;
  let duration = 0;
  let maximumDuration = 0;
  const costs = {};
  const maximumCosts = {};
  for (const lens of COST_LENSES) costs[lens] = { status: 'known', amount_usd: 0, unknown_plan_ids: [] };
  for (const lens of COST_LENSES) maximumCosts[lens] = { status: 'known', amount_usd: 0, unknown_plan_ids: [] };
  const stages = [];
  for (const plan of path) {
    const prediction = predictions.get(plan.plan_id);
    const stageReach = reach;
    const stageSuccess = stageReach * prediction.conservative_probability;
    success += stageSuccess;
    duration += stageReach * prediction.expected_duration_ms;
    maximumDuration += prediction.expected_duration_ms * (plan.max_retries + 1);
    for (const lens of COST_LENSES) {
      const cost = prediction.costs[lens];
      if (cost.status === 'known') {
        costs[lens].amount_usd += stageReach * cost.amount_usd;
        maximumCosts[lens].amount_usd += cost.amount_usd * (plan.max_retries + 1);
      }
      else {
        costs[lens].status = 'unknown';
        costs[lens].amount_usd = null;
        costs[lens].unknown_plan_ids.push(plan.plan_id);
        maximumCosts[lens].status = 'unknown';
        maximumCosts[lens].amount_usd = null;
        maximumCosts[lens].unknown_plan_ids.push(plan.plan_id);
      }
    }
    stages.push({
      plan_id: plan.plan_id,
      reach_probability: Number(stageReach.toFixed(6)),
      success_probability: prediction.conservative_probability,
      evidence_basis: prediction.evidence_basis,
    });
    reach *= 1 - prediction.conservative_probability;
  }
  for (const lens of COST_LENSES) {
    if (costs[lens].status === 'known') costs[lens].amount_usd = Number(costs[lens].amount_usd.toFixed(6));
    if (maximumCosts[lens].status === 'known') maximumCosts[lens].amount_usd = Number(maximumCosts[lens].amount_usd.toFixed(6));
  }
  return {
    plan_ids: path.map((plan) => plan.plan_id),
    stages,
    verified_success_probability: Number(Math.min(1, success).toFixed(6)),
    expected_duration_ms: Math.round(duration),
    maximum_duration_ms: Math.round(maximumDuration),
    expected_costs: costs,
    maximum_costs: maximumCosts,
  };
}

function constraintReasons(candidate, request, path) {
  const reasons = [];
  const allTools = new Set(path.flatMap((plan) => plan.tools));
  if (request.constraints.required_tools.some((tool) => !allTools.has(tool))) reasons.push('REQUIRED_TOOL_NOT_PLANNED');
  if (candidate.maximum_duration_ms > request.constraints.max_duration_ms) reasons.push('DURATION_LIMIT_EXCEEDED');
  for (const lens of COST_LENSES) {
    const budget = request.constraints.budgets[lens];
    if (budget === null) continue;
    const cost = candidate.maximum_costs[lens];
    if (cost.status === 'unknown' && request.constraints.unknown_cost_policy === 'deny') reasons.push(`UNKNOWN_${lens.toUpperCase()}_COST`);
    if (cost.status === 'known' && cost.amount_usd > budget) reasons.push(`${lens.toUpperCase()}_BUDGET_EXCEEDED`);
  }
  return reasons;
}

function economicScore(candidate) {
  for (const lens of ['marginal', 'actual_cash', 'market_equivalent']) {
    const cost = candidate.expected_costs[lens];
    if (cost.status === 'known') return cost.amount_usd;
  }
  return Number.POSITIVE_INFINITY;
}

function routeOperation({ request, catalog, history = [] }) {
  validateRequest(request);
  validateCatalog(catalog);
  validateHistory(history);
  const byId = new Map(catalog.plans.map((plan) => [plan.plan_id, plan]));
  const indexedHistory = indexHistory(history);
  const predictions = new Map(catalog.plans.map((plan) => [plan.plan_id, calibratedPrediction(plan, request, history, indexedHistory)]));
  const candidates = [];
  for (const root of catalog.plans) {
    const path = buildPath(root, byId);
    const eligibility = path.flatMap((plan) => planEligible(plan, request));
    const aggregate = aggregatePath(path, predictions);
    const reasons = [...new Set([...eligibility, ...constraintReasons(aggregate, request, path)])];
    candidates.push({
      root_plan_id: root.plan_id,
      ...aggregate,
      eligible: reasons.length === 0,
      reason_codes: reasons,
    });
  }
  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (!eligible.length) {
    const error = new Error('No operation path satisfies the declared privacy, tool, duration, and cost constraints');
    error.code = 'NO_ELIGIBLE_PATH';
    error.candidates = candidates;
    throw error;
  }
  const meetingTarget = eligible.filter((candidate) => candidate.verified_success_probability >= request.quality_target);
  const pool = meetingTarget.length ? meetingTarget : eligible;
  pool.sort((left, right) => {
    if (meetingTarget.length) return economicScore(left) - economicScore(right)
      || left.expected_duration_ms - right.expected_duration_ms
      || right.verified_success_probability - left.verified_success_probability;
    return right.verified_success_probability - left.verified_success_probability
      || economicScore(left) - economicScore(right)
      || left.expected_duration_ms - right.expected_duration_ms;
  });
  const selected = pool[0];
  const unsigned = {
    schema: 1,
    kind: 'citadel_operation_decision',
    operation_id: request.operation_id,
    request_digest: digest(request),
    catalog_digest: digest(catalog),
    history_digest: digest(history),
    selection_status: meetingTarget.length ? 'meets-quality-target' : 'best-available',
    quality_target: request.quality_target,
    selected,
    candidates,
    predictions: Object.fromEntries(predictions),
  };
  return Object.freeze({ ...unsigned, decision_digest: digest(unsigned) });
}

function nextAction({ decision, attempt, catalog }) {
  validateCatalog(catalog);
  const path = decision.selected.plan_ids;
  const plan = catalog.plans.find((candidate) => candidate.plan_id === attempt.plan_id);
  if (!plan || !path.includes(plan.plan_id)) throw new TypeError('attempt plan is not in the selected path');
  if (attempt.completion_status === 'passed' && attempt.control_status === 'passed') {
    return Object.freeze({ action: 'stop-passed', reason_code: 'VERIFIED_SUCCESS', target_plan_id: null });
  }
  if (attempt.control_status === 'failed') {
    return Object.freeze({ action: 'stop-failed', reason_code: 'CONTROL_RECONCILIATION_FAILED', target_plan_id: null });
  }
  const retryCount = Number.isInteger(attempt.retry_count) ? attempt.retry_count : 0;
  if (plan.retry_on.includes(attempt.failure_code) && retryCount < plan.max_retries) {
    return Object.freeze({ action: 'retry', reason_code: attempt.failure_code, target_plan_id: plan.plan_id });
  }
  const index = path.indexOf(plan.plan_id);
  const fallback = path[index + 1] || null;
  if (fallback) return Object.freeze({ action: 'escalate', reason_code: attempt.failure_code || 'VERIFICATION_NOT_PASSED', target_plan_id: fallback });
  return Object.freeze({
    action: attempt.completion_status === 'unknown'
      || (attempt.completion_status === 'passed' && attempt.control_status === 'unknown'
        && Object.keys(runtimeSettings(plan)).length) ? 'stop-unknown' : 'stop-failed',
    reason_code: attempt.failure_code || 'PATH_EXHAUSTED',
    target_plan_id: null,
  });
}

module.exports = Object.freeze({
  aggregatePath,
  calibratedPrediction,
  economicScore,
  indexHistory,
  nextAction,
  planEligible,
  recordsFor,
  routeOperation,
  wilsonLowerBound,
});

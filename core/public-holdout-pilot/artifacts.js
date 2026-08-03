'use strict';

const { digest } = require('../operation-control/contracts');
const { attest, calibrationHistory } = require('../public-holdout/artifacts');
const { buildPilotAssignment, PILOT_DESIGN } = require('./design');
const { PILOT_PLAN_IDS, routePilotTask } = require('./router');
const { analyzePilot } = require('./statistics');

function buildPilotFreeze({ parentRequest, parentSelection, parentPreflight, parentAssignment, sourceDigests, privateKey, frozenAt = new Date().toISOString() }) {
  const unsigned = {
    schema: 1,
    kind: 'citadel_public_holdout_fast_pilot_freeze',
    freeze_id: null,
    frozen_at: frozenAt,
    parent_request_id: parentRequest.request_id,
    parent_selection_id: parentSelection.selection_id,
    parent_preflight_id: parentPreflight.preflight_id,
    parent_terminal_assignment_id: parentAssignment.assignment_id,
    parent_terminal_status: parentAssignment.status,
    design: PILOT_DESIGN,
    source_digests: sourceDigests,
    attestation_public_key: parentRequest.attestation_public_key,
  };
  return attest({ ...unsigned, freeze_id: digest(unsigned) }, privateKey);
}

function buildSignedPilotAssignment({ freeze, selection, preflight, privateKey }) {
  return attest(buildPilotAssignment({ freezeId: freeze.freeze_id, selection, preflight }), privateKey);
}

function buildPilotVisible({ freeze, assignment, tasks, privateKey }) {
  const assigned = [...assignment.assignments.calibration, ...assignment.assignments.evaluation];
  const byId = new Map(tasks.map((task) => [task.instance_id, task]));
  const visible = assigned.map((instanceId) => {
    const task = byId.get(instanceId);
    if (!task) throw new Error(`pilot visible task missing: ${instanceId}`);
    return task;
  });
  const unsigned = { schema: 1, kind: 'citadel_public_holdout_fast_pilot_visible_tasks', artifact_id: null, freeze_id: freeze.freeze_id, assignment_id: assignment.assignment_id, tasks: visible };
  return attest({ ...unsigned, artifact_id: digest(unsigned) }, privateKey);
}

function buildPilotRouteLedger({ freeze, assignment, visibleTasks, calibrationAttemptSets, calibrationVerdictBundles, privateKey }) {
  const evaluationIds = new Set(assignment.assignments.evaluation);
  const history = calibrationHistory(calibrationAttemptSets, calibrationVerdictBundles, visibleTasks);
  const routes = visibleTasks.filter((task) => evaluationIds.has(task.instance_id)).map((task) => routePilotTask(task, history));
  const unsigned = { schema: 1, kind: 'citadel_public_holdout_fast_pilot_route_ledger', ledger_id: null, freeze_id: freeze.freeze_id, assignment_id: assignment.assignment_id, calibration_history_digest: digest(history), calibration_records: history.length, routes };
  return attest({ ...unsigned, ledger_id: digest(unsigned) }, privateKey);
}

function policyOutcome(path, attemptsByPlan, verdictsByPlan) {
  const visited = [];
  let status = 'failed';
  for (const planId of path) {
    const attempt = attemptsByPlan.get(planId);
    const verdict = verdictsByPlan.get(planId);
    if (!attempt || !verdict) throw new Error(`pilot attempt or verdict missing for ${planId}`);
    visited.push({ plan_id: planId, attempt_id: attempt.attempt_id, verification_status: verdict.verification_status, comparison_cost_usd: attempt.economics.comparison_cost.amount_usd });
    if (verdict.verification_status === 'passed') { status = 'passed'; break; }
    if (verdict.verification_status === 'unknown') { status = 'unknown'; break; }
  }
  const costs = visited.map((attempt) => attempt.comparison_cost_usd);
  return { status, visited_attempts: visited, comparison_cost_usd: costs.every(Number.isFinite) ? Number(costs.reduce((sum, value) => sum + value, 0).toFixed(9)) : null };
}

function buildPilotAnalysis({ freeze, assignment, visibleTasks, routeLedger, evaluationAttemptSets, evaluationVerdictBundles, privateKey }) {
  const evaluationIds = new Set(assignment.assignments.evaluation);
  const attemptsByTask = new Map();
  for (const attempt of evaluationAttemptSets.flat()) {
    if (!attemptsByTask.has(attempt.instance_id)) attemptsByTask.set(attempt.instance_id, new Map());
    attemptsByTask.get(attempt.instance_id).set(attempt.plan_id, attempt);
  }
  const verdictsByTask = new Map();
  for (const bundle of evaluationVerdictBundles) for (const verdict of bundle.verdicts) {
    if (!verdictsByTask.has(verdict.instance_id)) verdictsByTask.set(verdict.instance_id, new Map());
    verdictsByTask.get(verdict.instance_id).set(bundle.plan_id, verdict);
  }
  const routeById = new Map(routeLedger.routes.map((route) => [route.instance_id, route]));
  const rows = visibleTasks.filter((task) => evaluationIds.has(task.instance_id)).map((task) => {
    const attempts = attemptsByTask.get(task.instance_id);
    const verdicts = verdictsByTask.get(task.instance_id);
    const route = routeById.get(task.instance_id);
    if (!attempts || !verdicts || !route) throw new Error(`pilot evaluation evidence incomplete: ${task.instance_id}`);
    return { instance_id: task.instance_id, repo: task.repo, feature_key: task.public_features.feature_key, outcomes: { 'always-claude': policyOutcome([PILOT_PLAN_IDS.cloud], attempts, verdicts), 'static-local-first': policyOutcome([PILOT_PLAN_IDS.local, PILOT_PLAN_IDS.cloud], attempts, verdicts), 'citadel-controller': policyOutcome(route.decision.selected.plan_ids, attempts, verdicts) } };
  });
  const executed = evaluationAttemptSets.flat();
  const unsigned = {
    schema: 1,
    kind: 'citadel_public_holdout_fast_pilot_final_analysis',
    analysis_id: null,
    freeze_id: freeze.freeze_id,
    assignment_id: assignment.assignment_id,
    route_ledger_id: routeLedger.ledger_id,
    rows,
    primary: analyzePilot(rows),
    counterfactual_execution_disclosure: { generated_attempts: executed.length, policy_cost_excludes_unvisited_generated_tiers: true, total_observed_generation_comparison_usd: executed.every((attempt) => Number.isFinite(attempt.economics.comparison_cost.amount_usd)) ? Number(executed.reduce((sum, attempt) => sum + attempt.economics.comparison_cost.amount_usd, 0).toFixed(9)) : null },
    actual_subscription_cash_status: 'unknown',
  };
  return attest({ ...unsigned, analysis_id: digest(unsigned) }, privateKey);
}

module.exports = Object.freeze({ buildPilotAnalysis, buildPilotFreeze, buildPilotRouteLedger, buildPilotVisible, buildSignedPilotAssignment, policyOutcome });

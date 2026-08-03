'use strict';

const { digest } = require('../operation-control/contracts');

const PILOT_DESIGN = Object.freeze({
  design_id: 'public-holdout-fast-pilot-v1',
  parent_protocol: 'public-holdout-capstone-v1-terminal-setup-unknown',
  feature_strata: Object.freeze(['js.issue-short', 'js.issue-long', 'ts.issue-short', 'ts.issue-long']),
  calibration_per_feature_stratum: 2,
  evaluation_per_feature_stratum: 4,
  calibration_total: 8,
  evaluation_total: 16,
  maximum_tasks_per_repo: 1,
  required_gold_passes: 3,
  gold_attempts: 3,
  plan_ids: Object.freeze(['qwen-3b', 'claude-sonnet']),
  assignment_rule: 'within each frozen feature-stratum order, take the first two gold-valid tasks from unique repositories for calibration and the next four for untouched evaluation',
  stopping_rule: 'if any stratum cannot fill two calibration and four evaluation tasks under the one-task-per-repository cap, stop setup-unknown before model inference',
  inference_scope: 'bounded paired descriptive pilot; no population-wide noninferiority or universal savings claim',
});

function goldDisposition(result) {
  if (!result) return 'not-preflighted';
  if (result.attempts === PILOT_DESIGN.gold_attempts && result.passes === PILOT_DESIGN.required_gold_passes) return 'gold-valid';
  if (result.failures > 0) return 'gold-invalid';
  return 'setup-unknown';
}

function buildPilotAssignment({ freezeId, selection, preflight }) {
  if (!freezeId || selection.selection_id !== preflight.selection_id) throw new Error('pilot parent evidence identity invalid');
  const assignments = { calibration: [], evaluation: [] };
  const decisions = [];
  const usedRepos = new Set();
  const byId = new Map(preflight.tasks.map((task) => [task.instance_id, task]));

  for (const featureKey of PILOT_DESIGN.feature_strata) {
    const split = featureKey.slice(0, 2);
    let calibration = 0;
    let evaluation = 0;
    for (const ordered of selection.ordered_candidates[split].filter((candidate) => candidate.feature_key === featureKey)) {
      const result = byId.get(ordered.instance_id);
      const repo = result?.repo || ordered.repo;
      const gold = goldDisposition(result);
      let disposition = gold;
      if (gold === 'gold-valid' && usedRepos.has(repo)) disposition = 'repo-cap';
      else if (gold === 'gold-valid' && calibration < PILOT_DESIGN.calibration_per_feature_stratum) {
        disposition = 'calibration';
        calibration += 1;
        usedRepos.add(repo);
        assignments.calibration.push(ordered.instance_id);
      } else if (gold === 'gold-valid' && evaluation < PILOT_DESIGN.evaluation_per_feature_stratum) {
        disposition = 'evaluation';
        evaluation += 1;
        usedRepos.add(repo);
        assignments.evaluation.push(ordered.instance_id);
      } else if (gold === 'gold-valid') disposition = 'unused-valid-reserve';
      decisions.push({ split, feature_key: featureKey, rank: ordered.rank, instance_id: ordered.instance_id, repo, gold_disposition: gold, disposition });
      if (calibration === PILOT_DESIGN.calibration_per_feature_stratum && evaluation === PILOT_DESIGN.evaluation_per_feature_stratum) break;
    }
  }

  const ready = assignments.calibration.length === PILOT_DESIGN.calibration_total
    && assignments.evaluation.length === PILOT_DESIGN.evaluation_total
    && usedRepos.size === PILOT_DESIGN.calibration_total + PILOT_DESIGN.evaluation_total;
  const unsigned = {
    schema: 1,
    kind: 'citadel_public_holdout_fast_pilot_assignment',
    assignment_id: null,
    freeze_id: freezeId,
    parent_selection_id: selection.selection_id,
    parent_preflight_id: preflight.preflight_id,
    status: ready ? 'ready' : 'setup-unknown',
    assignments,
    decisions,
    unique_repository_count: usedRepos.size,
  };
  return Object.freeze({ ...unsigned, assignment_id: digest(unsigned) });
}

module.exports = Object.freeze({ PILOT_DESIGN, buildPilotAssignment, goldDisposition });

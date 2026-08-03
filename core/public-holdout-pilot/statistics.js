'use strict';

const { analyzePaired } = require('../public-holdout/statistics');

function analyzePilot(rows) {
  const bootstrap = analyzePaired(rows, { seed: 'citadel-public-holdout-fast-pilot-v1' });
  const point = bootstrap.point_estimate;
  const sampleQualityPreserved = point.candidate_verified_rate >= point.baseline_verified_rate;
  const sampleCostReduced = sampleQualityPreserved && Number.isFinite(point.comparison_cost_reduction) && point.comparison_cost_reduction > 0;
  return Object.freeze({
    schema: 1,
    kind: 'citadel_public_holdout_fast_pilot_analysis',
    task_count: rows.length,
    point_estimate: point,
    sample_gates: { quality_preserved_in_observed_sample: sampleQualityPreserved, comparison_cost_reduced_after_sample_quality: sampleCostReduced, overall_preliminary_signal: sampleQualityPreserved && sampleCostReduced },
    exploratory_bootstrap: { confidence_method: bootstrap.confidence_method, quality_difference_interval: bootstrap.quality_difference_interval, comparison_cost_reduction_interval: bootstrap.comparison_cost_reduction_interval, by_feature_stratum: bootstrap.by_feature_stratum },
    inference_scope: 'Secondary bounded pilot. The sample gates describe these sixteen prospectively assigned tasks and are not a population noninferiority test.',
    claim_boundary: 'Comparison USD is not actual subscription cash. This pilot cannot establish universal model performance, production savings, or best-in-class status.',
  });
}

module.exports = Object.freeze({ analyzePilot });

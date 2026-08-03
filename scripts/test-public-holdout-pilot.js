'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { generateAttestationKeyPair } = require('../core/operation-control/receipt');
const { verifyAttestation } = require('../core/public-holdout/artifacts');
const { buildPilotFreeze, buildSignedPilotAssignment } = require('../core/public-holdout-pilot/artifacts');
const { buildPilotAssignment, PILOT_DESIGN } = require('../core/public-holdout-pilot/design');
const { PILOT_PLAN_IDS, pilotCatalog, routePilotTask } = require('../core/public-holdout-pilot/router');
const { analyzePilot } = require('../core/public-holdout-pilot/statistics');

const ROOT = path.resolve(__dirname, '..');
function readJson(relative) { return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')); }
function costs(amount) { return { actual_cash: { status: 'unknown', amount_usd: null, basis: 'subscription', source: 'test' }, marginal: { status: 'known', amount_usd: amount, basis: 'observed', source: 'test' }, market_equivalent: { status: 'known', amount_usd: amount, basis: 'observed', source: 'test' } }; }

function main() {
  const request = readJson('benchmarks/public-holdout-capstone/selection-request.json');
  const selection = readJson('benchmarks/public-holdout-capstone/selection.json');
  const preflight = readJson('benchmarks/public-holdout-capstone/gold-preflight.json');
  const parentAssignment = readJson('benchmarks/public-holdout-capstone/assignment.json');
  const assignment = buildPilotAssignment({ freezeId: 'sha256:test-freeze', selection, preflight });
  assert.strictEqual(assignment.status, 'ready');
  assert.strictEqual(assignment.assignments.calibration.length, PILOT_DESIGN.calibration_total);
  assert.strictEqual(assignment.assignments.evaluation.length, PILOT_DESIGN.evaluation_total);
  assert.strictEqual(assignment.unique_repository_count, 24);
  const repos = assignment.decisions.filter((decision) => ['calibration', 'evaluation'].includes(decision.disposition)).map((decision) => decision.repo);
  assert.strictEqual(new Set(repos).size, 24);
  const featureCounts = assignment.decisions.filter((decision) => ['calibration', 'evaluation'].includes(decision.disposition)).reduce((counts, decision) => { counts[decision.feature_key] = (counts[decision.feature_key] || 0) + 1; return counts; }, {});
  for (const featureKey of PILOT_DESIGN.feature_strata) assert.strictEqual(featureCounts[featureKey], 6);

  const history = PILOT_DESIGN.feature_strata.flatMap((featureKey) => [
    { feature_key: featureKey, plan_id: PILOT_PLAN_IDS.local, verification_status: 'failed', duration_ms: 100, costs: costs(0.01) },
    { feature_key: featureKey, plan_id: PILOT_PLAN_IDS.local, verification_status: 'passed', duration_ms: 100, costs: costs(0.01) },
    { feature_key: featureKey, plan_id: PILOT_PLAN_IDS.cloud, verification_status: 'passed', duration_ms: 100, costs: costs(1) },
    { feature_key: featureKey, plan_id: PILOT_PLAN_IDS.cloud, verification_status: 'passed', duration_ms: 100, costs: costs(1) },
  ]);
  const routed = routePilotTask({ instance_id: 'fixture', problem_statement: 'repair', public_features: { feature_key: 'js.issue-short' } }, history, pilotCatalog());
  assert.ok(Object.values(PILOT_PLAN_IDS).includes(routed.decision.selected.root_plan_id));
  assert.deepStrictEqual(routed.decision.candidates.map((candidate) => candidate.root_plan_id).sort(), Object.values(PILOT_PLAN_IDS).sort());

  const rows = Array.from({ length: 16 }, (_, index) => ({ instance_id: `task-${index}`, feature_key: PILOT_DESIGN.feature_strata[index % 4], outcomes: { 'always-claude': { status: 'passed', comparison_cost_usd: 1 }, 'citadel-controller': { status: 'passed', comparison_cost_usd: 0.5 } } }));
  const analysis = analyzePilot(rows);
  assert.strictEqual(analysis.sample_gates.overall_preliminary_signal, true);
  assert.strictEqual(analysis.point_estimate.comparison_cost_reduction, 0.5);

  const pair = generateAttestationKeyPair();
  const signedFreeze = buildPilotFreeze({ parentRequest: request, parentSelection: selection, parentPreflight: preflight, parentAssignment, sourceDigests: { fixture: 'sha256:test' }, privateKey: pair.private_key, frozenAt: '2026-08-03T00:00:00.000Z' });
  const signedAssignment = buildSignedPilotAssignment({ freeze: signedFreeze, selection, preflight, privateKey: pair.private_key });
  assert.strictEqual(verifyAttestation(signedFreeze, pair.public_key).design.evaluation_total, 16);
  assert.strictEqual(verifyAttestation(signedAssignment, pair.public_key).status, 'ready');
  process.stdout.write('public holdout fast pilot tests passed\n');
}

main();

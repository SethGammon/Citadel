'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildPool, candidateFromRow, eligibilityFor } = require('../core/public-holdout/dataset');
const { assignGoldValidTasks, buildSelectionRecord, createSelectionRequest, DESIGN } = require('../core/public-holdout/selection');
const { PLAN_IDS, catalog, routeTask } = require('../core/public-holdout/router');
const { analyzePaired } = require('../core/public-holdout/statistics');
const { digest } = require('../core/operation-control/contracts');
const { generateAttestationKeyPair } = require('../core/operation-control/receipt');
const { buildAnalysis, buildAssignment, buildPreflight, buildRouteLedger, buildVerdictBundle, buildVisibleArtifact, verifyAttestation } = require('../core/public-holdout/artifacts');
const { retrieve } = require('../core/public-holdout/retrieval');
const { parseFiles, promptFor } = require('../core/public-holdout/runner');
const { goldMatrix } = require('./public-holdout-matrix');
const { EVALUATOR_COMMIT, EVALUATOR_LAUNCH_COMMIT, readResult } = require('./public-holdout-evaluator-summary');

function row(index, split, issueSize = 'short') {
  const extension = split === 'js' ? 'js' : 'ts';
  return {
    repo: `owner/repo-${index % 24}`,
    pull_number: String(1000 + index),
    instance_id: `${split}-owner__repo-${index}-${1000 + index}`,
    issue_numbers: [String(index)],
    base_commit: 'a'.repeat(40),
    patch: `diff --git a/src/file.${extension} b/src/file.${extension}\n--- a/src/file.${extension}\n+++ b/src/file.${extension}\n@@ -1 +1 @@\n-old\n+new`,
    test_patch: 'diff --git a/test/file.test.js b/test/file.test.js\n--- a/test/file.test.js\n+++ b/test/file.test.js\n@@ -1 +1 @@\n-old\n+new',
    problem_statement: issueSize === 'short' ? `Repair the externally authored ${split} behavior without changing the public contract. ${'detail '.repeat(20)}` : `Repair the externally authored ${split} behavior. ${'detailed reproduction and acceptance criteria '.repeat(70)}`,
    hints_text: '', all_hints_text: '', commit_urls: [], created_at: '2026-05-01T00:00:00.000Z', commit_url: '', rebuild_cmds: [], test_cmds: ['npm test'], print_cmds: [], log_parser: '', FAIL_TO_PASS: ['one'], PASS_TO_PASS: ['two'], docker_image: `image-${index}`,
  };
}

function fakePool() {
  const rows = { js: [], ts: [] };
  for (const split of ['js', 'ts']) {
    for (let index = 0; index < 90; index += 1) rows[split].push({ row_idx: index, row: row(index, split, index % 2 ? 'long' : 'short') });
  }
  return buildPool(rows, '2026-08-02T00:00:00.000Z');
}

function costs(amount) {
  return {
    actual_cash: { status: 'unknown', amount_usd: null, basis: 'subscription', source: 'test' },
    marginal: { status: 'known', amount_usd: amount, basis: 'observed', source: 'test' },
    market_equivalent: { status: 'known', amount_usd: amount, basis: 'observed', source: 'test' },
  };
}

function evaluatorSummary(mode, candidate, status = 'passed', repetitions = 1) {
  const attempts = Array.from({ length: repetitions }, (_, index) => ({ repetition: index + 1, status, result_digest: digest(`${candidate.instance_id}-${index}`), process_exit_status: 0, reason: null }));
  const unsigned = { schema: 1, kind: 'citadel_public_holdout_evaluator_summary', summary_id: null, mode, instance_id: candidate.instance_id, repo: candidate.repo, split: candidate.split, feature_key: candidate.public_features.feature_key, evaluator_repo: 'https://github.com/microsoft/SWE-bench-Live', evaluator_commit: EVALUATOR_COMMIT, evaluator_launch_commit: EVALUATOR_LAUNCH_COMMIT, runner: { os: 'Linux', arch: 'X64', name: 'test', image: 'ubuntu24' }, attempts, passes: status === 'passed' ? repetitions : 0, failures: status === 'failed' ? repetitions : 0, errors: status === 'error' ? repetitions : 0 };
  return { ...unsigned, summary_id: digest(unsigned) };
}

function fakeAttempt(task, planId, amount) {
  const unsigned = { schema: 1, kind: 'citadel_public_holdout_model_attempt', attempt_id: null, instance_id: task.instance_id, plan_id: planId, duration_ms: 100, economics: { comparison_cost: { status: 'known', amount_usd: amount, source: 'test' }, actual_subscription_cash: planId === PLAN_IDS.cloud ? { status: 'unknown', amount_usd: null, source: 'test-subscription' } : { status: 'not-applicable', amount_usd: 0 }, gpu: { status: 'test' } } };
  return { ...unsigned, attempt_id: digest(unsigned) };
}

function main() {
  assert.strictEqual(eligibilityFor(row(1, 'js')).eligible, true);
  const invalid = row(2, 'js'); invalid.FAIL_TO_PASS = [];
  assert.deepStrictEqual(eligibilityFor(invalid).reason_codes, ['FAIL_TO_PASS_MISSING']);
  assert.strictEqual(candidateFromRow({ row_idx: 1, row: row(1, 'ts') }, 'ts').public_features.feature_key, 'ts.issue-short');

  const pool = fakePool();
  const evaluatorFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-evaluator-summary-test-'));
  try {
    const exitStatusFile = path.join(evaluatorFixture, 'process-exit-status.txt');
    fs.writeFileSync(exitStatusFile, '1\n', 'utf8');
    assert.deepStrictEqual(readResult(path.join(evaluatorFixture, 'results.json'), 'fixture', exitStatusFile), { status: 'error', result_digest: null, process_exit_status: 1, reason: 'evaluator-exit-1-results-json-missing' });
    const result = { success_ids: ['fixture'], failure_ids: [], empty_patch_ids: [], error_ids: [] };
    fs.writeFileSync(path.join(evaluatorFixture, 'results.json'), `${JSON.stringify(result)}\n`, 'utf8');
    fs.writeFileSync(exitStatusFile, '0\n', 'utf8');
    assert.deepStrictEqual(readResult(path.join(evaluatorFixture, 'results.json'), 'fixture', exitStatusFile), { status: 'passed', result_digest: digest(result), process_exit_status: 0, reason: null });
  } finally { fs.rmSync(evaluatorFixture, { recursive: true, force: true }); }
  assert.strictEqual(pool.counts.total, 180);
  const signature = 'ab'.repeat(96);
  const randomness = crypto.createHash('sha256').update(Buffer.from(signature, 'hex')).digest('hex');
  const request = createSelectionRequest({ pool, round: 7000000, roundTime: '2026-08-03T00:00:00.000Z', frozenAt: '2026-08-02T00:00:00.000Z', attestationPublicKey: 'test-public-key' });
  const beacon = { round: 7000000, randomness, signature, previous_signature: 'cd'.repeat(96) };
  const relayResponses = request.beacon.source_urls.map((source_url) => ({ source_url, beacon }));
  const selection = buildSelectionRecord({ request, pool, relayResponses, observedAt: '2026-08-03T00:00:01.000Z' });
  assert.strictEqual(selection.ordered_candidates.js.length, 90);
  assert.notStrictEqual(selection.ordered_candidates.js[0].rank_digest, selection.ordered_candidates.js[1].rank_digest);
  assert.strictEqual(goldMatrix(selection, 2).length, 8);
  const candidates = new Map(pool.candidates.map((candidate) => [candidate.instance_id, candidate]));
  const tasks = Object.values(selection.ordered_candidates).flat().map((entry) => ({ instance_id: entry.instance_id, repo: candidates.get(entry.instance_id).repo, attempts: 3, passes: 3 }));
  const preflightUnsigned = { schema: 1, preflight_id: null, tasks };
  const preflight = { ...preflightUnsigned, preflight_id: require('../core/operation-control/contracts').digest(preflightUnsigned) };
  const assignment = assignGoldValidTasks(selection, preflight);
  assert.strictEqual(assignment.status, 'ready');
  assert.strictEqual(assignment.assignments.calibration.length, DESIGN.calibration_per_feature_stratum * 4);
  assert.strictEqual(assignment.assignments.evaluation.length, DESIGN.evaluation_total);

  const task = { instance_id: 'js-owner__repo-1-1001', problem_statement: 'repair', public_features: { feature_key: 'js.issue-short' } };
  const history = [];
  for (const plan_id of Object.values(PLAN_IDS)) for (let index = 0; index < 5; index += 1) history.push({ feature_key: 'js.issue-short', plan_id, verification_status: plan_id === PLAN_IDS.cloud || index < 3 ? 'passed' : 'failed', duration_ms: 100 + index, costs: costs(plan_id === PLAN_IDS.cloud ? 0.08 : 0.001) });
  const routed = routeTask(task, history, catalog());
  assert.ok(Object.values(PLAN_IDS).includes(routed.decision.selected.root_plan_id));
  assert.strictEqual(routed.decision.history_digest.startsWith('sha256:'), true);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-retrieval-test-'));
  try {
    fs.mkdirSync(path.join(temporary, 'src')); fs.writeFileSync(path.join(temporary, 'src', 'lookup.ts'), 'export function lookup(name: string) { return name; }\n', 'utf8'); fs.writeFileSync(path.join(temporary, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    const retrieval = retrieve(temporary, { instance_id: 'fixture-1', problem_statement: 'Fix lookup.ts so lookup is case insensitive.' });
    assert.strictEqual(retrieval.files[0].path, 'src/lookup.ts');
    const prompt = promptFor({ problem_statement: 'Fix lookup.', instance_id: 'fixture-1' }, retrieval);
    assert.ok(prompt.includes('src/lookup.ts'));
    assert.strictEqual(parseFiles('{"files":{"src/lookup.ts":"replacement"}}', retrieval).status, 'passed');
    assert.strictEqual(parseFiles('{"files":{"src/hidden.ts":"replacement"}}', retrieval).code, 'OUTPUT_PATH_NOT_RETRIEVED');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }

  const paired = Array.from({ length: 60 }, (_, index) => ({ instance_id: `task-${index}`, feature_key: DESIGN.feature_strata[index % 4], outcomes: { 'always-claude': { status: 'passed', comparison_cost_usd: 1 }, 'citadel-controller': { status: 'passed', comparison_cost_usd: 0.5 } } }));
  const analysis = analyzePaired(paired, { repetitions: 2000 });
  assert.strictEqual(analysis.hierarchical_gates.quality_noninferiority, true);
  assert.strictEqual(analysis.hierarchical_gates.cost_superiority_after_quality, true);
  assert.strictEqual(analysis.point_estimate.comparison_cost_reduction, 0.5);

  const pair = generateAttestationKeyPair();
  const goldSummaries = pool.candidates.filter((candidate) => candidate.eligible).map((candidate) => evaluatorSummary('gold', candidate, 'passed', 3));
  const signedPreflight = buildPreflight(selection, goldSummaries, pair.private_key);
  const signedAssignment = buildAssignment(selection, signedPreflight, pair.private_key);
  assert.strictEqual(verifyAttestation(signedAssignment, pair.public_key).status, 'ready');
  const assignedIds = [...signedAssignment.assignments.calibration, ...signedAssignment.assignments.evaluation];
  const visibleTasks = assignedIds.map((instanceId) => { const candidate = candidates.get(instanceId); return { instance_id: instanceId, repo: candidate.repo, problem_statement: 'repair this issue', public_features: candidate.public_features }; });
  const visible = buildVisibleArtifact(selection, signedAssignment, visibleTasks, pair.private_key);
  const calibrationIds = new Set(signedAssignment.assignments.calibration);
  const evaluationIds = new Set(signedAssignment.assignments.evaluation);
  const calibrationTasks = visible.tasks.filter((entry) => calibrationIds.has(entry.instance_id));
  const evaluationTasks = visible.tasks.filter((entry) => evaluationIds.has(entry.instance_id));
  const calibrationAttempts = Object.values(PLAN_IDS).map((planId) => calibrationTasks.map((entry) => fakeAttempt(entry, planId, planId === PLAN_IDS.cloud ? 1 : 0.1)));
  const calibrationVerdicts = Object.values(PLAN_IDS).map((planId, index) => buildVerdictBundle({ phase: 'calibration', planId, attempts: calibrationAttempts[index], summaries: calibrationTasks.map((entry) => evaluatorSummary('prediction', candidates.get(entry.instance_id), 'passed', 1)), privateKey: pair.private_key }));
  const routeLedger = buildRouteLedger({ assignment: signedAssignment, visibleTasks: visible.tasks, calibrationAttemptSets: calibrationAttempts, calibrationVerdictBundles: calibrationVerdicts, privateKey: pair.private_key });
  assert.strictEqual(routeLedger.routes.length, 60);
  const evaluationAttempts = Object.values(PLAN_IDS).map((planId) => evaluationTasks.map((entry) => fakeAttempt(entry, planId, planId === PLAN_IDS.cloud ? 1 : 0.1)));
  const evaluationVerdicts = Object.values(PLAN_IDS).map((planId, index) => buildVerdictBundle({ phase: 'evaluation', planId, attempts: evaluationAttempts[index], summaries: evaluationTasks.map((entry) => evaluatorSummary('prediction', candidates.get(entry.instance_id), 'passed', 1)), privateKey: pair.private_key }));
  const final = buildAnalysis({ assignment: signedAssignment, visibleTasks: visible.tasks, routeLedger, evaluationAttemptSets: evaluationAttempts, evaluationVerdictBundles: evaluationVerdicts, privateKey: pair.private_key });
  assert.strictEqual(final.rows.length, 60);
  assert.strictEqual(verifyAttestation(final, pair.public_key).primary.hierarchical_gates.overall, true);
  process.stdout.write('public holdout capstone tests passed\n');
}

main();

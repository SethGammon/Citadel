#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const proof = require('../core/product-proof');
const cli = require('./product-proof-trial');

const EXPERIMENT_MANIFEST = path.join(
  __dirname,
  '..',
  'benchmarks',
  'citadel-proof-experiments',
  'experiment-manifest.json',
);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`  FAIL ${name}: ${error.stack}\n`);
    process.exitCode = 1;
  }
}

function keyPair() {
  const generated = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: generated.publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: generated.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function gates() {
  return {
    telemetry_join_min: 0.95,
    accepted_completion_margin: -0.05,
    recovery_gain_min: 0.2,
    intervention_reduction_min: 0.25,
    time_overhead_max: 0.15,
    verification_accuracy_min: 0.95,
    false_pass_max: 0,
    d7_retention_min: 0.15,
    minimum_public_cell: 5,
  };
}

function spec(options = {}) {
  return {
    evidence_kind: options.evidenceKind || 'instrument-proof',
    created_day: '2026-07-30',
    participant_count: options.participantCount || 6,
    metric_set_id: 'real-user-proof-v2',
    scenario_pairs: options.scenarioPairs || [{
      pair_id: 'pair-routing',
      scenario_a: 'route-regression-a',
      scenario_b: 'route-regression-b',
      category: 'short-control',
    }],
    strata: options.strata || [{
      runtime_family: 'codex',
      model_id: 'gpt-5.6',
      os_family: 'windows',
    }],
    gates: gates(),
    randomization_seed: options.seed || 'fixed-randomization-seed-v2',
    signing_public_key: options.publicKey || null,
  };
}

function scoreFor(assignment, overrides = {}) {
  return {
    schema: 2,
    kind: 'trial_score_v2',
    protocol_id: assignment.protocol_id,
    assignment_id: assignment.assignment_id,
    completed: true,
    claimed_verdict: 'passed',
    oracle_verdict: 'passed',
    owner_accepted: true,
    resume_correct: null,
    corrective_interventions: 0,
    required_approvals: 0,
    clarifications: 0,
    rework_cycles: 0,
    regressions: 0,
    ...overrides,
  };
}

function retentionFor(plan, participantIndex, day, overrides = {}) {
  const participant = [...new Set(plan.assignments.map((item) => item.participant_id))][participantIndex];
  return {
    schema: 2,
    kind: 'retention_observation_v2',
    protocol_id: plan.protocol.protocol_id,
    participant_id: participant,
    install_succeeded: true,
    observation_day: day,
    meaningful_task_completed: false,
    canonical_verification_passed: false,
    ...overrides,
  };
}

function capture() {
  let text = '';
  return {
    stdout: { write(value) { text += value; } },
    read() { return text; },
  };
}

process.stdout.write('Real User Proof v2 tests\n');

test('assignment generation is deterministic and exactly balanced AB/BA', () => {
  const first = proof.createPlan(spec());
  const second = proof.createPlan(spec());
  assert.deepEqual(first, second);
  assert.equal(first.assignments.length, 12);
  assert.equal(first.balance.valid, true);
  const firstModes = first.assignments.filter((item) => item.order === 1);
  assert.equal(firstModes.filter((item) => item.mode === 'bare').length, 3);
  assert.equal(firstModes.filter((item) => item.mode === 'harnessed').length, 3);
  for (const scenario of ['route-regression-a', 'route-regression-b']) {
    assert.equal(first.assignments.filter((item) => item.scenario_id === scenario && item.mode === 'bare').length, 3);
    assert.equal(first.assignments.filter((item) => item.scenario_id === scenario && item.mode === 'harnessed').length, 3);
  }
});

test('assignment commitment detects schedule mutation', () => {
  const plan = proof.createPlan(spec());
  const mutated = plan.assignments.map((item) => ({ ...item }));
  mutated[0].order = 2;
  assert.throws(() => proof.validatePlan(plan.protocol, mutated), /commitment|orders|unbalanced|exactly/);
});

test('records reject extra and prohibited fields', () => {
  const plan = proof.createPlan(spec());
  const record = { ...scoreFor(plan.assignments[0]), prompt: 'private task text' };
  assert.throws(() => proof.validateRecord(record), /prohibited|exactly/);
  assert.throws(() => proof.assertPublicAggregate({ safe: 'C:\\Users\\person\\repo' }), /path/);
  assert.throws(() => proof.assertPublicAggregate({ email: 'person@example.com' }), /prohibited/);
});

test('stage, score, artifact, exit, and retention records use exact closed schemas', () => {
  const plan = proof.createPlan(spec());
  const assignment = plan.assignments[0];
  const records = [
    {
      schema: 2,
      kind: 'trial_stage_v2',
      protocol_id: assignment.protocol_id,
      assignment_id: assignment.assignment_id,
      stage: 'handoff',
      status: 'succeeded',
      duration_ms: 1200,
      failure_code: null,
      day_since_install: 0,
    },
    scoreFor(assignment),
    {
      schema: 2,
      kind: 'trial_artifacts_v2',
      protocol_id: assignment.protocol_id,
      assignment_id: assignment.assignment_id,
      expected_task_artifacts: 1,
      receipt_owned_artifacts: 2,
      receipt_owned_bytes: 100,
      unexpected_tracked: 0,
      unexpected_untracked: 0,
      unexpected_untracked_bytes: 0,
      cleanup_verdict: 'passed',
    },
    {
      schema: 2,
      kind: 'trial_exit_v2',
      protocol_id: assignment.protocol_id,
      assignment_id: assignment.assignment_id,
      plan_reviewed: true,
      archive_verdict: 'passed',
      user_state_verdict: 'passed',
      hooks_removed_verdict: 'passed',
      footprint_verdict: 'passed',
      restore_verdict: 'passed',
    },
    retentionFor(plan, 0, 7, {
      meaningful_task_completed: true,
      canonical_verification_passed: true,
    }),
  ];
  records.forEach((record) => assert.equal(proof.validateRecord(record), record));
  assert.throws(() => proof.validateRecord({ ...records[0], status: 'passed' }), /status/);
});

test('signed receipts verify and tampering is rejected', () => {
  const keys = keyPair();
  const plan = proof.createPlan(spec({ publicKey: keys.publicKey }));
  const record = scoreFor(plan.assignments[0]);
  const receipt = proof.signReceipt([record], keys.privateKey, {
    protocol: plan.protocol,
    signer: 'reviewer-local',
    now: new Date('2026-07-30T12:00:00.000Z'),
  });
  assert.equal(proof.verifyPinnedReceipt(receipt, plan.protocol), true);
  const tampered = {
    ...receipt,
    records: [{ ...receipt.records[0], owner_accepted: false }],
  };
  assert.equal(proof.verifyPinnedReceipt(tampered, plan.protocol), false);
});

test('intention-to-treat scoring retains missing and failed attempts', () => {
  const plan = proof.createPlan(spec());
  const oneBare = plan.assignments.find((item) => item.mode === 'bare');
  const report = proof.buildReport({
    ...plan,
    records: [scoreFor(oneBare)],
    receipts: [],
  });
  assert.equal(report.intention_to_treat.assigned_attempts, 12);
  assert.equal(report.intention_to_treat.scored_attempts, 1);
  assert.equal(report.intention_to_treat.missing_attempts, 11);
  assert.equal(report.modes.bare.accepted_verified_rate, 0.166667);
  assert.equal(report.modes.harnessed.accepted_verified_rate, 0);
  assert.equal(report.gates.telemetry_join.state, 'failed');
  assert.equal(report.utility_claim, false);
  assert.equal(report.claim_status, 'instrument_only');
});

test('accepted-completion gate uses a deterministic paired bootstrap lower bound', () => {
  const plan = proof.createPlan(spec());
  const records = plan.assignments.map((assignment) => scoreFor(assignment));
  const first = proof.buildReport({ ...plan, records, receipts: [] });
  const second = proof.buildReport({ ...plan, records, receipts: [] });
  assert.deepEqual(
    first.comparisons.accepted_completion_paired_bootstrap_95,
    second.comparisons.accepted_completion_paired_bootstrap_95,
  );
  assert.deepEqual(first.comparisons.accepted_completion_paired_bootstrap_95, {
    point: 0,
    lower_95: 0,
    upper_95: 0,
    replicates: 2000,
  });
  assert.equal(first.gates.accepted_completion.state, 'passed');
  assert.equal(first.gates.accepted_completion.value, 0);
});

test('a false pass fails the gate and can never become a utility claim', () => {
  const plan = proof.createPlan(spec());
  const assignment = plan.assignments.find((item) => item.mode === 'harnessed');
  const report = proof.buildReport({
    ...plan,
    records: [scoreFor(assignment, {
      completed: false,
      claimed_verdict: 'passed',
      oracle_verdict: 'failed',
      owner_accepted: false,
    })],
    receipts: [],
  });
  assert.equal(report.modes.harnessed.false_passes, 1);
  assert.equal(report.gates.false_pass.state, 'failed');
  assert.equal(report.instrument_status, 'needs_attention');
  assert.equal(report.utility_claim, false);
});

test('D7 and D30 retention require meaningful verified work in exact windows', () => {
  const plan = proof.createPlan(spec());
  const records = [
    retentionFor(plan, 0, 6, { meaningful_task_completed: true, canonical_verification_passed: true }),
    retentionFor(plan, 1, 7, { meaningful_task_completed: true, canonical_verification_passed: true }),
    retentionFor(plan, 2, 14, { meaningful_task_completed: true, canonical_verification_passed: true }),
    retentionFor(plan, 3, 30, { meaningful_task_completed: true, canonical_verification_passed: true }),
    retentionFor(plan, 4, 45, { meaningful_task_completed: true, canonical_verification_passed: true }),
  ];
  const report = proof.buildReport({ ...plan, records, receipts: [] });
  assert.equal(report.retention.d7.eligible, 4);
  assert.equal(report.retention.d7.returned, 1);
  assert.equal(report.retention.d7.rate, 0.25);
  assert.equal(report.retention.d30.eligible, 2);
  assert.equal(report.retention.d30.returned, 1);
  assert.equal(report.retention.d30.rate, 0.5);
});

test('aggregate share preview suppresses cells smaller than five', () => {
  const small = proof.createPlan(spec({ participantCount: 2 }));
  const smallReport = proof.buildReport({ ...small, records: [], receipts: [] });
  const suppressed = proof.buildSharePreview(smallReport, 5);
  assert.equal(suppressed.cells.bare.suppressed, true);
  assert.equal(suppressed.cells.bare.assigned, null);
  assert.equal(suppressed.comparisons.suppressed, true);
  assert.equal(suppressed.instrument_status, 'suppressed');
  assert.equal(suppressed.gates.false_pass, 'suppressed');
  assert.equal(suppressed.gates.d7_meaningful_retention, 'suppressed');
  assert.doesNotMatch(JSON.stringify(suppressed), /participant-/);

  const adequate = proof.createPlan(spec({ participantCount: 6 }));
  const adequateReport = proof.buildReport({ ...adequate, records: [], receipts: [] });
  const visible = proof.buildSharePreview(adequateReport, 5);
  assert.equal(visible.cells.bare.suppressed, false);
  assert.equal(visible.cells.bare.assigned, 6);
  assert.equal(visible.utility_claim, false);
});

test('local store persists exact records and explicit purge removes only v2 store', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-proof-v2-'));
  const plan = proof.createPlan(spec());
  proof.startStore(root, plan);
  proof.appendRecord(root, scoreFor(plan.assignments[0]));
  const loaded = proof.loadStore(root);
  assert.equal(loaded.records.length, 1);
  fs.mkdirSync(path.join(root, '.planning', 'keep-me'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'keep-me', 'user.txt'), 'preserve');
  const result = proof.purgeStore(root);
  assert.equal(result.outcome, 'purged');
  assert.equal(fs.existsSync(proof.pathsFor(root).dir), false);
  assert.equal(fs.readFileSync(path.join(root, '.planning', 'keep-me', 'user.txt'), 'utf8'), 'preserve');
});

test('CLI rejects unknown options and hash-binds the experiment manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-proof-binding-'));
  const specFile = path.join(root, 'spec.json');
  const manifestFile = path.join(root, 'experiment-manifest.json');
  fs.writeFileSync(specFile, JSON.stringify(spec()));
  fs.copyFileSync(EXPERIMENT_MANIFEST, manifestFile);

  assert.throws(
    () => cli.run(['plan', '--spec', specFile, '--experiment-manifest', manifestFile, '--surprise']),
    /unknown option: --surprise/,
  );
  const planned = cli.run([
    'plan', '--spec', specFile, '--experiment-manifest', manifestFile, '--root', root,
  ], capture());
  assert.equal(planned.experiment_manifest_binding.experiment_id, 'real-user-proof-v2');
  cli.run(['start', '--spec', specFile, '--experiment-manifest', manifestFile, '--root', root], capture());

  assert.throws(() => cli.run(['report', '--root', root], capture()), /--experiment-manifest is required/);
  const tampered = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  tampered.created_at = '2026-08-04T00:00:01.000Z';
  fs.writeFileSync(manifestFile, JSON.stringify(tampered));
  assert.throws(
    () => cli.run(['report', '--root', root, '--experiment-manifest', manifestFile], capture()),
    /manifest binding mismatch/,
  );
});

test('CLI plan is non-mutating and full local lifecycle makes no network request', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-proof-cli-'));
  const specFile = path.join(root, 'spec.json');
  const recordFile = path.join(root, 'record.json');
  fs.writeFileSync(specFile, JSON.stringify(spec()));
  let output = capture();
  const planned = cli.run([
    'plan', '--spec', specFile, '--experiment-manifest', EXPERIMENT_MANIFEST, '--root', root,
  ], output);
  assert.equal(planned.wrote_files, false);
  assert.equal(fs.existsSync(path.join(root, '.planning')), false);

  output = capture();
  cli.run([
    'start', '--spec', specFile, '--experiment-manifest', EXPERIMENT_MANIFEST, '--root', root,
  ], output);
  const store = proof.loadStore(root);
  fs.writeFileSync(recordFile, JSON.stringify(scoreFor(store.assignments[0])));
  cli.run([
    'record', '--input', recordFile, '--experiment-manifest', EXPERIMENT_MANIFEST, '--root', root,
  ], capture());
  const report = cli.run([
    'report', '--experiment-manifest', EXPERIMENT_MANIFEST, '--root', root,
  ], capture());
  assert.equal(report.claim_status, 'instrument_only');
  const preview = cli.run([
    'share-preview', '--experiment-manifest', EXPERIMENT_MANIFEST, '--root', root,
  ], capture());
  assert.equal(preview.transmitted, false);
  assert.ok(fs.existsSync(proof.pathsFor(root).sharePreview));
  const reportBytes = fs.readFileSync(proof.pathsFor(root).report, 'utf8');
  const previewBytes = fs.readFileSync(proof.pathsFor(root).sharePreview, 'utf8');
  const writeFileSync = fs.writeFileSync;
  fs.writeFileSync = (file, ...args) => {
    if (String(file).includes('.tmp-')) throw new Error('unchanged artifact attempted an atomic rewrite');
    return writeFileSync(file, ...args);
  };
  try {
    cli.run(['report', '--experiment-manifest', EXPERIMENT_MANIFEST, '--root', root], capture());
    cli.run(['share-preview', '--experiment-manifest', EXPERIMENT_MANIFEST, '--root', root], capture());
  } finally {
    fs.writeFileSync = writeFileSync;
  }
  assert.equal(fs.readFileSync(proof.pathsFor(root).report, 'utf8'), reportBytes);
  assert.equal(fs.readFileSync(proof.pathsFor(root).sharePreview, 'utf8'), previewBytes);
  const source = fs.readFileSync(path.join(__dirname, 'product-proof-trial.js'), 'utf8');
  assert.doesNotMatch(source, /require\s*\(\s*['"](?:node:)?(?:http|https|net|tls|dgram|dns)['"]\s*\)/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  const purged = cli.run(['purge', '--root', root], capture());
  assert.equal(purged.outcome, 'purged');
});

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`\n${passed} real user proof v2 tests passed.\n`);

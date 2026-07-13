#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const activation = require('../core/telemetry/activation');
const cohort = require('../core/telemetry/activation-cohort');
const activationCli = require('./activation-telemetry');
const cohortCli = require('./activation-cohort');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  PASS ${name}\n`); }
  catch (error) { process.stderr.write(`  FAIL ${name}: ${error.stack}\n`); process.exitCode = 1; }
}

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-cohort-')); }
function id(index) { return `activation-${index.toString(16).padStart(32, '0')}`; }
function submission(index, overrides = {}) {
  const base = {
    schema: 1,
    kind: 'activation_cohort_submission',
    submission_id: id(index),
    consent_aggregate: true,
    observation_day: 8,
    citadel_version: '1.1.0',
    journey: {
      event_count: 7,
      install_attempted: true,
      install_completed: true,
      setup_completed: true,
      route_completed: true,
      verified_handoff: true,
      resume_completed: true,
      return_session: true,
      install_failed: false,
      route_failed: false,
    },
  };
  return { ...base, ...overrides, journey: { ...base.journey, ...(overrides.journey || {}) } };
}
function envelope(item, index, captured = '2026-07-13T00:00:00.000Z') {
  return {
    schema: 1,
    kind: 'activation_cohort_evidence',
    evidence_url: `https://github.com/SethGammon/Citadel/discussions/182#discussioncomment-${1000 + index}`,
    captured_at: captured,
    submission: item,
  };
}

process.stdout.write('Activation cohort tests\n');

test('share command writes a stable, privacy-minimal bundle without transmitting', () => {
  const root = tempRoot();
  const created = new Date('2026-07-01T00:00:00.000Z');
  const localIdentity = { schema: 1, installation_id: '11111111-1111-4111-8111-111111111111', created_at: created.toISOString() };
  const files = activation.pathsFor(root);
  fs.mkdirSync(files.dir, { recursive: true });
  fs.writeFileSync(files.identity, JSON.stringify(localIdentity));
  const stages = ['install_started', 'install_completed', 'setup_completed', 'route_completed', 'verified_handoff', 'resume_completed', 'return_session'];
  stages.forEach((stage, index) => activation.record({
    stage,
    status: stage === 'install_started' ? 'started' : 'succeeded',
    runtime: 'codex',
  }, { root, identity: localIdentity, now: new Date(created.getTime() + index * 86400000), version: '1.1.0' }));
  const first = activationCli.run(['share', '--root', root]);
  const second = activationCli.run(['share', '--root', root]);
  assert.equal(first.outcome, 'opt_in_bundle_written');
  assert.equal(first.transmitted, false);
  assert.equal(first.submission.submission_id, second.submission.submission_id);
  assert.equal(first.submission.journey.verified_handoff, true);
  assert.deepEqual(Object.keys(first.submission).sort(), [...cohort.SUBMISSION_FIELDS].sort());
  const serialized = JSON.stringify(first.submission);
  assert.doesNotMatch(serialized, /11111111|prompt|repository_name|file_path|command/);
  assert.ok(fs.existsSync(first.output));
});

test('submission validation rejects extra data and impossible journey claims', () => {
  assert.throws(() => cohort.validateSubmission({ ...submission(1), prompt: 'private' }), /fields must be exact/);
  assert.throws(() => cohort.validateSubmission(submission(1, { journey: { install_completed: false, setup_completed: true } })), /requires install/);
  assert.throws(() => cohort.validateSubmission(submission(1, { observation_day: 0, journey: { return_session: true } })), /at least one observation day/);
});

test('cohort keeps the newest observation for one opaque installation', () => {
  const early = envelope(submission(1, { observation_day: 1, journey: { return_session: false } }), 1);
  const mature = envelope(submission(1, { observation_day: 8 }), 2, '2026-07-20T00:00:00.000Z');
  const latest = cohort.latestSubmissions([mature, early]);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].submission.observation_day, 8);
});

test('decision report uses explicit denominators and reaches ready only after 25 mature submissions', () => {
  const records = Array.from({ length: 25 }, (_, index) => envelope(submission(index + 1), index + 1));
  const result = cohort.cohortReport(records);
  assert.equal(result.cohort.shared_installations, 25);
  assert.equal(result.cohort.seven_day_eligible, 25);
  assert.equal(result.cohort.verified_handoff_rate, 1);
  assert.equal(result.cohort.seven_day_return_rate, 1);
  assert.equal(result.gates.install_or_route_failure_rate.state, 'passed');
  assert.equal(result.milestone_status, 'ready');
});

test('seven-day return remains waiting when the cohort is large but immature', () => {
  const records = Array.from({ length: 25 }, (_, index) => envelope(submission(index + 1, {
    observation_day: 2,
    journey: { return_session: false },
  }), index + 1));
  const result = cohort.cohortReport(records);
  assert.equal(result.cohort.seven_day_eligible, 0);
  assert.equal(result.gates.seven_day_return_rate.state, 'waiting');
  assert.equal(result.gates.seven_day_return_rate.eligible_count, 0);
  assert.equal(result.gates.seven_day_return_rate.required_eligible, 25);
  assert.equal(result.milestone_status, 'observing');
});

test('maintainer ingest stores evidence, upserts same comment, and refreshes report', () => {
  const root = tempRoot();
  const bundle = path.join(root, 'bundle.json');
  fs.writeFileSync(bundle, JSON.stringify(submission(7)));
  const url = 'https://github.com/SethGammon/Citadel/discussions/182#discussioncomment-7777';
  const first = cohortCli.run(['ingest', '--root', root, '--bundle', bundle, '--evidence-url', url], { now: new Date('2026-07-13T00:00:00.000Z') });
  const second = cohortCli.run(['ingest', '--root', root, '--bundle', bundle, '--evidence-url', url], { now: new Date('2026-07-14T00:00:00.000Z') });
  assert.equal(first.outcome, 'submission_ingested');
  assert.equal(second.records, 1);
  assert.ok(fs.existsSync(cohort.sharePaths(root).report));
  assert.equal(JSON.parse(fs.readFileSync(cohort.sharePaths(root).report)).cohort.shared_installations, 1);
});

test('empty report is collecting and never manufactures zero retention', () => {
  const result = cohort.cohortReport([]);
  assert.equal(result.milestone_status, 'collecting');
  assert.equal(result.cohort.seven_day_return_rate, null);
  assert.equal(result.gates.seven_day_return_rate.state, 'waiting');
});

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`\n${passed} activation cohort tests passed.\n`);

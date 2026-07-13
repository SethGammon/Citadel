#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const activation = require('../core/telemetry/activation');
const cli = require('./activation-telemetry');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  PASS ${name}\n`); }
  catch (error) { process.stderr.write(`  FAIL ${name}: ${error.stack}\n`); process.exitCode = 1; }
}

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-activation-')); }
const identity = { installation_id: '11111111-1111-4111-8111-111111111111', created_at: '2026-01-01T00:00:00.000Z' };
function make(input = {}, options = {}) {
  return activation.createEvent({
    runtime: 'codex', stage: 'setup_completed', status: 'succeeded', ...input,
  }, {
    root: options.root || tempRoot(), identity, version: '1.1.0',
    os_family: 'linux', now: options.now || new Date('2026-01-03T00:00:00.000Z'),
  });
}

process.stdout.write('Activation telemetry tests\n');

test('schema covers every allowed stage', () => {
  for (const stage of activation.STAGES) assert.equal(make({ stage }).stage, stage);
});

test('schema covers every status', () => {
  for (const status of activation.STATUSES) {
    const event = make({ status, failure_code: status === 'failed' ? 'unknown_error' : null });
    assert.equal(event.status, status);
  }
});

test('schema covers every failure code', () => {
  for (const failure_code of activation.FAILURE_CODES) {
    assert.equal(make({ status: 'failed', failure_code }).failure_code, failure_code);
  }
});

test('schema covers every acquisition source and defaults unknown', () => {
  for (const acquisition_source of activation.ACQUISITION_SOURCES) {
    assert.equal(make({ acquisition_source }).acquisition_source, acquisition_source);
  }
  assert.equal(make().acquisition_source, 'unknown');
});

test('event shape is exact and day since install is derived', () => {
  const event = make({ duration_ms: 24 });
  assert.deepEqual(Object.keys(event), activation.EVENT_FIELDS);
  assert.equal(event.schema, 1);
  assert.equal(event.day_since_install, 2);
  assert.equal(event.duration_ms, 24);
});

test('invalid duration, day and schema are rejected', () => {
  const event = make();
  for (const duration_ms of [-1, 1.5, '1']) assert.equal(activation.validateEvent({ ...event, duration_ms }).valid, false);
  for (const day_since_install of [-1, 1.5, '1']) assert.equal(activation.validateEvent({ ...event, day_since_install }).valid, false);
  assert.equal(activation.validateEvent({ ...event, schema: 2 }).valid, false);
});

test('unknown input and event fields are strictly rejected', () => {
  assert.throws(() => make({ extra: true }), /unknown field/);
  assert.equal(activation.validateEvent({ ...make(), extra: true }).valid, false);
});

test('prohibited content fields are explicitly rejected', () => {
  const prohibited = ['prompt', 'repository_name', 'repo', 'path', 'file_path', 'command', 'body', 'source_code', 'user_identity', 'token', 'secret'];
  for (const field of prohibited) {
    assert.throws(() => make({ [field]: 'sensitive' }), /prohibited field/);
    const validation = activation.validateEvent({ ...make(), [field]: 'sensitive' });
    assert.equal(validation.valid, false, field);
    assert.match(validation.errors.join(' '), /prohibited field/);
  }
});

test('failed status gets closed fallback while non-failure rejects codes', () => {
  assert.equal(make({ status: 'failed' }).failure_code, 'unknown_error');
  assert.throws(() => make({ failure_code: 'timeout' }), /must be null/);
  assert.throws(() => make({ status: 'failed', failure_code: 'invented' }), /require failure_code/);
});

test('local identity and record store contain schema-one event', () => {
  const root = tempRoot();
  const result = activation.record({ stage: 'install_started', status: 'started', runtime: 'codex' }, { root });
  assert.equal(result.recorded, true);
  const files = activation.pathsFor(root);
  assert.ok(fs.existsSync(files.identity));
  assert.ok(fs.existsSync(files.events));
  const local = JSON.parse(fs.readFileSync(files.identity));
  assert.match(local.installation_id, /^[0-9a-f-]{36}$/i);
  assert.equal(JSON.parse(fs.readFileSync(files.events, 'utf8').trim()).schema, 1);
});

test('marker opt-out and environment opt-out write no identity or event', () => {
  const markerRoot = tempRoot();
  assert.equal(activation.setOptOut(markerRoot, true), true);
  assert.deepEqual(activation.record({ stage: 'install_started', status: 'started' }, { root: markerRoot }), { recorded: false, reason: 'opted_out' });
  assert.equal(fs.existsSync(activation.pathsFor(markerRoot).identity), false);
  activation.setOptOut(markerRoot, false);
  assert.equal(activation.isEnabled(markerRoot), true);

  const envRoot = tempRoot();
  activation.record({ stage: 'install_started', status: 'started' }, { root: envRoot, env: { CITADEL_ACTIVATION_TELEMETRY: '0' } });
  assert.equal(fs.existsSync(activation.pathsFor(envRoot).events), false);
  assert.equal(fs.existsSync(activation.pathsFor(envRoot).identity), false);
});

test('documented schema-zero camelCase event migrates to schema one', () => {
  const legacy = {
    schema: 0, timestamp: '2026-01-01T00:00:00.000Z', installationId: identity.installation_id,
    citadelVersion: '1.0.0', runtime: 'claude-code', osFamily: 'macos',
    stage: 'setup_completed', status: 'succeeded', durationMs: 5, failureCode: null,
    daySinceInstall: 0, acquisitionSource: 'github_search',
  };
  const migrated = activation.migrateLegacy(legacy);
  assert.equal(migrated.schema, 1);
  assert.equal(migrated.installation_id, legacy.installationId);
  assert.equal(migrated.acquisition_source, 'github_search');
  assert.throws(() => activation.migrateLegacy({ ...legacy, prompt: 'no' }), /prohibited field/);
});

test('fixture journey records install through return and reports redacted aggregates', () => {
  const root = tempRoot();
  const files = activation.pathsFor(root);
  const stages = activation.STAGES;
  stages.forEach((stage, index) => activation.record({
    stage, status: index === 0 ? 'started' : 'succeeded', runtime: 'codex',
    duration_ms: index, acquisition_source: index === 0 ? 'github_trending' : 'unknown',
  }, { root, now: new Date(Date.UTC(2026, 0, 1 + index)) }));
  const localId = JSON.parse(fs.readFileSync(files.identity)).installation_id;
  const result = activation.report(root);
  assert.equal(result.total_events, 7);
  assert.equal(result.unique_installations, 1);
  assert.equal(result.by_stage.return_session, 1);
  assert.equal(result.by_status.started, 1);
  assert.equal(result.by_status.succeeded, 6);
  assert.equal(result.activation_funnel.successful_installs, 1);
  assert.equal(result.activation_funnel.setup_completed.rate_from_install, 1);
  assert.deepEqual(result.decision_metrics.verified_activation_rate, { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(result.decision_metrics.durable_resume_rate, { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(result.decision_metrics.return_use_rate, { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(result.guardrails, { failed_events: 0, failure_event_rate: 0, invalid_events: 0 });
  assert.equal(result.redacted, true);
  assert.equal(result.transmitted, false);
  assert.equal(JSON.stringify(result).includes(localId), false);
  assert.equal(JSON.stringify(result).includes('timestamp'), false);
});

test('funnel counts installations once and excludes failed milestones', () => {
  const root = tempRoot();
  const record = (stage, status = 'succeeded') => activation.record({
    stage, status, runtime: 'codex',
    failure_code: status === 'failed' ? 'verification_failed' : null,
  }, { root });
  record('install_completed');
  record('install_completed');
  record('route_completed');
  record('verified_handoff', 'failed');
  const result = activation.report(root);
  assert.equal(result.activation_funnel.successful_installs, 1);
  assert.equal(result.activation_funnel.route_completed.rate_from_install, 1);
  assert.equal(result.decision_metrics.verified_activation_rate.rate, 0);
  assert.equal(result.guardrails.failed_events, 1);
  assert.equal(result.guardrails.failure_event_rate, 0.25);
});

test('rates are null when no successful installation denominator exists', () => {
  const result = activation.report(tempRoot());
  assert.equal(result.decision_metrics.verified_activation_rate.rate, null);
  assert.equal(result.decision_metrics.durable_resume_rate.rate, null);
  assert.equal(result.decision_metrics.return_use_rate.rate, null);
  assert.equal(result.guardrails.failure_event_rate, null);
});

test('reader migrates legacy lines and counts invalid lines without exposing them', () => {
  const root = tempRoot();
  const files = activation.pathsFor(root);
  fs.mkdirSync(files.dir, { recursive: true });
  const legacy = {
    schema: 0, timestamp: '2026-01-01T00:00:00.000Z', installationId: identity.installation_id,
    citadelVersion: '1.0.0', runtime: 'unknown', osFamily: 'other', stage: 'route_completed',
    status: 'failed', durationMs: null, failureCode: 'route_failed', daySinceInstall: 0,
    acquisitionSource: 'unknown',
  };
  fs.writeFileSync(files.events, JSON.stringify(legacy) + '\nnot json\n');
  const read = activation.readEvents(root);
  assert.equal(read.events.length, 1);
  assert.equal(read.migrated_count, 1);
  assert.equal(read.invalid_count, 1);
});

test('report writes only with explicit output request', () => {
  const root = tempRoot();
  activation.record({ stage: 'setup_completed', status: 'succeeded' }, { root });
  const before = fs.readdirSync(activation.pathsFor(root).dir).sort();
  const printed = cli.run(['report', '--root', root]);
  assert.equal(printed.output, null);
  assert.deepEqual(fs.readdirSync(activation.pathsFor(root).dir).sort(), before);
  const output = path.join(root, 'exports', 'activation.json');
  const written = cli.run(['report', '--root', root, '--output', output]);
  assert.equal(written.outcome, 'redacted_report_written');
  assert.equal(JSON.parse(fs.readFileSync(output)).redacted, true);
});

test('CLI supports plan-like record, status, opt-out and opt-in', () => {
  const root = tempRoot();
  const recorded = cli.run(['record', '--root', root, '--stage', 'route_completed', '--status', 'succeeded', '--runtime', 'codex']);
  assert.equal(recorded.local_only, true);
  assert.equal(recorded.network, 'disabled');
  assert.equal(recorded.outcome, 'recorded');
  assert.equal(cli.run(['status', '--root', root]).outcome, 'enabled');
  assert.equal(cli.run(['opt-out', '--root', root]).outcome, 'disabled');
  assert.equal(cli.run(['opt-in', '--root', root]).outcome, 'enabled');
  assert.throws(() => cli.run(['status', '--invented', 'yes']), /unknown flag/);
});

test('production implementation imports and calls no network modules', () => {
  for (const file of ['../core/telemetry/activation.js', './activation-telemetry.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /require\s*\(\s*['"](?:node:)?(?:http|https|net|tls|dgram|dns)['"]\s*\)/);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  }
});

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`\n${passed} activation telemetry tests passed.\n`);

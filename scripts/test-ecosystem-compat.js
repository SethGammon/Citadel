#!/usr/bin/env node

'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');
const { runExternalSkillProof, sha256 } = require('../core/distribution/external-skill');
const { resolveExistingFile, resolveTarget } = require('../core/distribution/fs-safety');
const { buildMetadata, stableJson, validateMetadata } = require('../core/distribution/metadata');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'ecosystem', 'anthropics-template-skill');
const EXPECTED_DIGEST = 'eb685d91de039ed864fbd790cddf31684b017fd4a34ee1a55760d8d7cdbadefa';
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

function withNoNetwork(fn) {
  const original = { http: http.request, https: https.request, connect: net.connect, fetch: global.fetch };
  const blocked = () => { throw new Error('network access is forbidden in ecosystem tests'); };
  http.request = blocked;
  https.request = blocked;
  net.connect = blocked;
  global.fetch = blocked;
  try { return fn(); } finally {
    http.request = original.http;
    https.request = original.https;
    net.connect = original.connect;
    global.fetch = original.fetch;
  }
}

function proofIn(runRoot) {
  return withNoNetwork(() => runExternalSkillProof({
    fixtureRoot: FIXTURE,
    runRoot,
    request: 'Use template-skill for this compatibility proof. SECRET_SENTINEL must remain private.',
    timestamp: '2026-07-10T00:00:00.000Z',
  }));
}

test('metadata matches package, manifests, skills, commands, and proof links', () => {
  const metadata = buildMetadata(ROOT);
  assert.deepEqual(validateMetadata(ROOT, metadata), []);
  const current = fs.readFileSync(path.join(ROOT, 'citadel-metadata.json'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(current, stableJson(metadata));
});

test('external fixture preserves its recorded public-source digest', () => {
  const source = fs.readFileSync(path.join(FIXTURE, 'SKILL.md'));
  const provenance = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'provenance.json'), 'utf8'));
  assert.equal(sha256(source), EXPECTED_DIGEST);
  assert.equal(provenance.sha256, EXPECTED_DIGEST);
  assert.equal(provenance.source_repository, 'https://github.com/anthropics/skills');
  assert.equal(provenance.license, 'Apache-2.0');
  assert.equal(provenance.source_ref_immutable, true);
  assert.match(provenance.source_ref, /^[0-9a-f]{40}$/);
  assert.equal(provenance.immutable_source_verified, true);
  assert.match(provenance.immutable_source_verification, /bytes match the recorded SHA-256/);
  assert.match(provenance.license_verification, /inferred.*README/i);
  assert.match(provenance.license_url, /README\.md/);
});

test('Claude and Codex local contracts install, scan, route, execute, verify, and clean up', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-ecosystem-'));
  try {
    const before = fs.readFileSync(path.join(FIXTURE, 'SKILL.md'));
    const report = proofIn(temp);
    assert.deepEqual(report.scans.map((scan) => [scan.runtime, scan.discovered]),
      [['claude', true], ['codex', true]]);
    assert.equal(report.route.selected_skill, 'template-skill');
    assert(report.executions.every((execution) => execution.status === 'completed'));
    assert(report.handoff.includes('---HANDOFF---'));
    assert.equal(report.cleanup.runtime_removed, true);
    assert.equal(report.cleanup.source_digest_preserved, true);
    assert.deepEqual(fs.readdirSync(temp).sort(), ['evidence']);
    assert.deepEqual(fs.readFileSync(path.join(FIXTURE, 'SKILL.md')), before);
    const evidence = fs.readFileSync(path.join(temp, 'evidence', 'telemetry.jsonl'), 'utf8')
      + fs.readFileSync(path.join(temp, 'evidence', 'HANDOFF.md'), 'utf8');
    assert(!evidence.includes('SECRET_SENTINEL'));
    assert(!JSON.stringify(report).includes('SECRET_SENTINEL'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('proof report is deterministic across isolated runs', () => {
  const one = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-ecosystem-a-'));
  const two = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-ecosystem-b-'));
  try { assert.deepEqual(proofIn(one), proofIn(two)); } finally {
    fs.rmSync(one, { recursive: true, force: true });
    fs.rmSync(two, { recursive: true, force: true });
  }
});

test('containment rejects traversal and symlinked fixture roots', () => {
  assert.throws(() => resolveExistingFile(FIXTURE, '../SKILL.md', 'fixture'), /escapes/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-ecosystem-link-'));
  const link = path.join(temp, 'fixture-link');
  try {
    fs.symlinkSync(FIXTURE, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => resolveExistingFile(link, 'SKILL.md', 'fixture'), /symlink/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('target containment rejects existing symlinks with portable and live coverage', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-ecosystem-target-'));
  const candidate = path.join(fs.realpathSync(temp), 'telemetry.jsonl');
  const fakeFs = {
    existsSync: (value) => path.basename(value) === 'telemetry.jsonl' || fs.existsSync(value),
    lstatSync: (value) => path.basename(value) === 'telemetry.jsonl'
      ? { isSymbolicLink: () => true }
      : fs.lstatSync(value),
    realpathSync: fs.realpathSync,
  };
  assert.throws(() => resolveTarget(temp, 'telemetry.jsonl', 'telemetry', fakeFs), /symlink/);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-ecosystem-outside-'));
  const linkedDirectory = path.join(temp, 'evidence');
  try {
    fs.symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => resolveTarget(temp, 'evidence/telemetry.jsonl', 'telemetry'), /symlink/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('provenance mismatch fails before installation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-ecosystem-tamper-'));
  const fixture = path.join(temp, 'fixture');
  const runRoot = path.join(temp, 'run');
  fs.cpSync(FIXTURE, fixture, { recursive: true });
  fs.mkdirSync(runRoot);
  fs.appendFileSync(path.join(fixture, 'SKILL.md'), '\nmutated\n');
  try {
    assert.throws(() => runExternalSkillProof({ fixtureRoot: fixture, runRoot,
      request: 'Use template-skill', timestamp: '2026-07-10T00:00:00.000Z' }), /digest mismatch/);
    assert.deepEqual(fs.readdirSync(runRoot), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`ecosystem compatibility: ${passed}/7 checks passed\n`);

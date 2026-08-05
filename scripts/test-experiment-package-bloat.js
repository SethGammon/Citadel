#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  EXCLUSIONS,
  MAX_ITERATIONS,
  REQUIRED_RUNTIME_PATHS,
  adjudicateFinalHistory,
  buildResult,
  digest,
  guardrailsPass,
  inventoryForExclusions,
  matchesExclusion,
  normalizeHistory,
  validatePackageManifest,
  validatePackagingProfile,
  validateResult,
  verifyPackedFilePolicy,
} = require('./experiment-package-bloat');

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

function manifest(exclusions = EXCLUSIONS.map((entry) => entry.pattern)) {
  return {
    files: [
      'docs/', 'assets/', 'benchmarks/', 'packages/', 'scripts/', 'skills/',
      ...exclusions,
    ],
  };
}

function measurement(packedBytes, exclusions = EXCLUSIONS.map((entry) => entry.pattern)) {
  return {
    measured_at: '2026-08-04T00:00:00.000Z',
    source_head: 'test-head',
    package_json_sha256: 'package-hash',
    exclusions,
    packaging_profile: { mechanism: 'scoped-npmignore', signed_package_source_preserved: true },
    runtime: {
      filename: 'citadel-1.3.0.tgz', packed_bytes: packedBytes, unpacked_bytes: packedBytes * 2,
      file_count: 100, sha256: 'archive', sha512_integrity: 'sha512-integrity',
      npm_shasum: 'shasum', file_manifest_sha256: 'file-manifest',
    },
    source_only: { file_count: 5, bytes: 500, manifest_sha256: 'source-manifest', groups: [] },
    accounting: {
      observed_published_artifacts: ['npm-runtime-tarball'],
      observed_total_published_bytes: packedBytes,
      total_accounted_unpacked_bytes: packedBytes * 2 + 500,
      cross_profile_packed_total: null,
      boundary: 'test boundary',
    },
    guardrails: {
      npm_files_negations_effective: true,
      protected_runtime_files_present: true,
      installed_runtime_smoke: true,
      installed_runtime_surfaces: ['pack-list'],
      installed_control_plane_checks: 21,
      offline_evidence_replay: true,
      source_repository_preserved: true,
    },
    timings_ms: { npm_pack: 1, npm_install: 1, installed_smoke: 1, evidence_replay: 1 },
    evidence_replay: { command: 'npm run grant:verify', mode: 'source-offline', status: 'passed' },
  };
}

const baseline = {
  source_commit: 'frozen',
  npm_pack: { packed_bytes: 1000, unpacked_bytes: 2000, file_count: 200 },
};

test('approved negations match only their narrow source paths', () => {
  assert(matchesExclusion('docs/images/pr-pipeline.png', '!docs/images/**'));
  assert(!matchesExclusion('docs/assets/application/01-product-entry.png', '!docs/images/**'));
  assert(matchesExclusion('skills/do/__benchmarks__/status.md', '!skills/*/__benchmarks__/**'));
  assert(!matchesExclusion('skills/do/SKILL.md', '!skills/*/__benchmarks__/**'));
  assert(!matchesExclusion('scripts/test-experiment-package-bloat.js', '!docs/images/**'));
});

test('manifest validation rejects unapproved or reordered package negations', () => {
  assert.equal(validatePackageManifest(manifest(), { requireAll: true }).length, EXCLUSIONS.length);
  assert.throws(() => validatePackageManifest(manifest(['!docs/private/**'])), /only approved ordered/);
  assert.throws(() => validatePackageManifest(manifest([...EXCLUSIONS.map((entry) => entry.pattern)].reverse())), /only approved ordered/);
});

test('final scoped ignore profile preserves the frozen package source binding', () => {
  const root = path.resolve(__dirname, '..');
  const profile = validatePackagingProfile(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), { requireAll: true });
  assert.equal(profile.mechanism, 'scoped-npmignore');
  assert.equal(profile.signed_package_source_preserved, true);
  assert.equal(profile.ignore_files.length, 3);
});

test('source-only inventory is content-hashed and leaves application assets out', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-package-inventory-'));
  try {
    fs.mkdirSync(path.join(root, 'docs', 'images'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'assets', 'application'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'images', 'site.png'), 'site');
    fs.writeFileSync(path.join(root, 'docs', 'assets', 'application', 'keep.png'), 'application');
    const inventory = inventoryForExclusions(root, [EXCLUSIONS[0]]);
    assert.equal(inventory.file_count, 1);
    assert.equal(inventory.bytes, 4);
    assert.equal(inventory.groups[0].manifest_sha256.length, 64);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packed policy proves npm negations worked and protected files remained', () => {
  const files = REQUIRED_RUNTIME_PATHS.map((runtimePath) => ({ path: runtimePath, size: 1, mode: 420 }));
  assert(verifyPackedFilePolicy({ files }, EXCLUSIONS));
  assert.throws(() => verifyPackedFilePolicy({ files: [...files, { path: 'docs/images/site.png' }] }, [EXCLUSIONS[0]]), /did not exclude/);
  assert.throws(() => verifyPackedFilePolicy({ files: files.slice(1) }, EXCLUSIONS), /lost required file/);
});

test('result keeps only real measured iterations and reports exact improvement', () => {
  const first = measurement(900, [EXCLUSIONS[0].pattern]);
  const second = measurement(700);
  const journal = {
    iterations: [
      { iteration: 1, label: 'site', previous_packed_bytes: 1000, packed_bytes: 900, delta_bytes: -100, verdict: 'KEEP', reason: 'metric-improved', measurement: first },
      { iteration: 2, label: 'all', previous_packed_bytes: 900, packed_bytes: 700, delta_bytes: -200, verdict: 'KEEP', reason: 'metric-improved', measurement: second },
    ],
  };
  const result = buildResult(journal, { baseline });
  assert.equal(result.budget.measured_iterations, 2);
  assert.equal(result.final.runtime.packed_bytes, 700);
  assert.equal(result.improvement.packed_bytes, 300);
  assert.equal(result.stop_reason, 'candidate-set-exhausted');
  assert.equal(validateResult(result, { checkCurrent: false }).result_sha256, result.result_sha256);
});

test('final adjudication discards signed-source drift and keeps the scoped profile', () => {
  const negation = measurement(800, [EXCLUSIONS[0].pattern]);
  negation.packaging_profile = { mechanism: 'package-files-negation', signed_package_source_preserved: false };
  negation.guardrails.offline_evidence_replay = 'deferred-to-final-profile';
  const scoped = measurement(750);
  const history = {
    iterations: [
      { iteration: 1, label: 'negation', previous_packed_bytes: 1000, packed_bytes: 800, delta_bytes: -200, verdict: 'KEEP', reason: 'metric-improved', measurement: negation },
      { iteration: 2, label: 'scoped', previous_packed_bytes: 800, packed_bytes: 760, delta_bytes: -40, verdict: 'DISCARD', reason: 'metric-not-improved', measurement: measurement(760) },
    ],
  };
  history.iterations[1].measurement.packaging_profile = { mechanism: 'scoped-npmignore', signed_package_source_preserved: true };
  const resolved = adjudicateFinalHistory(history, scoped, baseline);
  assert.equal(resolved.iterations[0].verdict, 'DISCARD');
  assert.match(resolved.iterations[0].reason, /signed-package-source-drift/);
  assert.equal(resolved.iterations[1].verdict, 'KEEP');
  assert.equal(resolved.iterations[1].previous_packed_bytes, 1000);
  assert.equal(resolved.iterations[1].packed_bytes, 750);
});

test('a compact recorded result can seed a later honest remeasurement', () => {
  const current = measurement(700);
  const iteration = { iteration: 1, label: 'one', previous_packed_bytes: 1000, packed_bytes: 700, delta_bytes: -300, verdict: 'KEEP', reason: 'metric-improved', measurement: current };
  const result = buildResult({ iterations: [iteration] }, { baseline });
  const normalized = normalizeHistory(result);
  assert.equal(normalized.iterations.length, 1);
  assert.equal(normalized.iterations[0].measurement.runtime.packed_bytes, 700);
  assert.equal(normalized.iterations[0].measurement.packaging_profile.mechanism, 'scoped-npmignore');
});

test('tampered result and over-budget history fail closed', () => {
  const current = measurement(700);
  const iteration = { iteration: 1, label: 'one', previous_packed_bytes: 1000, packed_bytes: 700, delta_bytes: -300, verdict: 'KEEP', reason: 'metric-improved', measurement: current };
  const result = buildResult({ iterations: [iteration] }, { baseline });
  const tampered = structuredClone(result);
  tampered.final.runtime.packed_bytes -= 1;
  assert.throws(() => validateResult(tampered, { checkCurrent: false }), /result hash mismatch/);
  assert.throws(() => buildResult({ iterations: Array.from({ length: MAX_ITERATIONS + 1 }, (_, index) => ({ ...iteration, iteration: index + 1 })) }, { baseline }), /exceeds budget/);
});

test('guardrail aggregation ignores descriptive fields but rejects a failed gate', () => {
  const candidate = measurement(700);
  assert(guardrailsPass(candidate));
  candidate.guardrails.offline_evidence_replay = false;
  assert(!guardrailsPass(candidate));
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
});

if (!process.exitCode) process.stdout.write(`\n${passed}/10 package bloat experiment tests passed.\n`);

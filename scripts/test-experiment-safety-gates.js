#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BOUNDARY,
  CASES,
  runExperiment,
  verifyEvidence,
} = require('./experiment-safety-gates');

let passed = 0;
function test(name, action) {
  try {
    action();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function tempOutput() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-safety-gates-test-'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function rawRecords(outputDirectory) {
  const raw = readJson(path.join(outputDirectory, 'safety-gates-raw.json'));
  return new Map(raw.cases.map((record) => [record.case.id, record]));
}

function rejects(action, pattern) {
  assert.throws(action, pattern);
}

test('matrix is deterministic, matched, and covers every required seam', () => {
  assert.equal(CASES.length, 12);
  const pairs = new Map();
  for (const entry of CASES) {
    const classifications = pairs.get(entry.pair_id) || [];
    classifications.push(entry.classification);
    pairs.set(entry.pair_id, classifications);
  }
  assert.equal(pairs.size, 6);
  for (const classifications of pairs.values()) {
    assert.deepEqual(classifications.sort(), ['benign', 'malicious']);
  }
  for (const category of [
    'path-traversal', 'outside-root', 'env-write', 'protected-branch',
    'malformed-evidence', 'missing-evidence',
  ]) assert(pairs.has(category), `missing ${category}`);
});

const output = tempOutput();
try {
  const report = runExperiment({ output });

  test('real-hook treatment passes strict safety gates', () => {
    assert.equal(report.outcome, 'passed');
    assert.equal(report.metrics.treatment.malicious_true_positive_rate, 1);
    assert.equal(report.metrics.treatment.benign_false_positive_rate, 0);
    assert.equal(report.metrics.treatment.canary_effects, 0);
    assert.equal(report.metrics.treatment.unknown_to_pass, 0);
    assert(Object.values(report.gates).every(Boolean));
  });

  test('boundary labels deny exploit, command-execution, and cross-OS claims', () => {
    assert.deepEqual(report.boundary, BOUNDARY);
    assert.equal(report.boundary.real_exploit_claim, false);
    assert.equal(report.boundary.dangerous_commands_executed, false);
    assert.equal(report.boundary.cross_os_claim, false);
  });

  test('raw evidence proves control disabled decisions and treatment invoked hooks', () => {
    const records = rawRecords(output);
    for (const testCase of CASES) {
      const record = records.get(testCase.id);
      assert.equal(record.control.mechanism, 'decision-disabled-no-execution');
      assert.equal(record.control.action_executed, false);
      assert.equal(record.treatment.action_executed, false);
      assert.equal(record.control.canary_side_effect, false);
      assert.equal(record.treatment.canary_side_effect, false);
      if (testCase.kind === 'hook') {
        assert.equal(record.treatment.mechanism, 'real-hook-subprocess');
        assert.equal(record.treatment.process_invoked, true);
      }
    }
  });

  test('malformed and missing evidence never advance', () => {
    const records = rawRecords(output);
    for (const id of ['malformed-evidence-malicious', 'missing-evidence-malicious']) {
      const record = records.get(id);
      assert.equal(record.treatment.decision, 'unknown');
      assert(!['advance', 'merge'].includes(record.treatment.governance.disposition));
    }
  });

  test('persisted evidence verifies and repeated run is a content-equal no-op', () => {
    verifyEvidence({ output });
    const files = [
      'safety-gates-raw.json',
      'safety-gates-results.json',
      'safety-gates-report.md',
    ];
    const before = Object.fromEntries(files.map((file) => [
      file,
      fs.readFileSync(path.join(output, file), 'utf8'),
    ]));
    runExperiment({ output });
    for (const file of files) {
      assert.equal(fs.readFileSync(path.join(output, file), 'utf8'), before[file]);
    }
  });

  test('raw case tampering is rejected', () => {
    const file = path.join(output, 'safety-gates-raw.json');
    const original = fs.readFileSync(file, 'utf8');
    const changed = JSON.parse(original);
    changed.cases[0].treatment.decision = 'allowed';
    writeJson(file, changed);
    rejects(() => verifyEvidence({ output }), /raw evidence digest mismatch|record digest mismatch|treatment decision changed/);
    fs.writeFileSync(file, original, 'utf8');
  });

  test('aggregate report tampering is rejected', () => {
    const file = path.join(output, 'safety-gates-results.json');
    const original = fs.readFileSync(file, 'utf8');
    const changed = JSON.parse(original);
    changed.metrics.treatment.benign_false_positive_rate = 0.25;
    writeJson(file, changed);
    rejects(() => verifyEvidence({ output }), /results report digest mismatch|reported metrics/);
    fs.writeFileSync(file, original, 'utf8');
  });
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

if (!process.exitCode) process.stdout.write(`\n${passed}/8 safety-gate experiment tests passed.\n`);

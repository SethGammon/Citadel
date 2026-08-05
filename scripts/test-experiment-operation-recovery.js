#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FAULT_BOUNDARIES } = require('./operation-runner');
const {
  METHOD,
  buildEvidence,
  verify,
  verifyEvidence,
  writeEvidence,
} = require('./experiment-operation-recovery');

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

const evidence = buildEvidence();

test('matched A/B trials cover every fault boundary and both effect classes', () => {
  assert.deepStrictEqual(evidence.raw.fault_boundaries, [...FAULT_BOUNDARIES]);
  assert.equal(evidence.raw.trials.length, FAULT_BOUNDARIES.length * 2 * 2);
  for (const boundary of FAULT_BOUNDARIES) {
    for (const workload of ['nonrepeatable', 'safe-repeatable']) {
      const matched = evidence.raw.trials.filter((trial) => trial.boundary === boundary && trial.workload === workload);
      assert.deepStrictEqual(matched.map((trial) => trial.arm), ['control', 'treatment']);
      assert(matched.every((trial) => trial.injected_fault_observed));
    }
  }
});

test('control duplicates after-effect work while treatment duplicates remain zero', () => {
  const metric = evidence.result.metrics.duplicate_nonrepeatable_effects;
  assert.equal(metric.control, 3);
  assert.equal(metric.treatment, 0);
  const control = evidence.raw.trials.find((trial) => trial.boundary === 'after_effect'
    && trial.workload === 'nonrepeatable' && trial.arm === 'control');
  const treatment = evidence.raw.trials.find((trial) => trial.boundary === 'after_effect'
    && trial.workload === 'nonrepeatable' && trial.arm === 'treatment');
  assert.equal(control.effect_attempts, 2);
  assert.equal(control.duplicate_nonrepeatable_effects, 1);
  assert.equal(treatment.effect_attempts, 1);
  assert.equal(treatment.duplicate_nonrepeatable_effects, 0);
  assert.equal(treatment.recovery_execution, 'blocked');
});

test('safe recovery, ambiguity, tamper, and privacy gates pass', () => {
  assert.deepStrictEqual(evidence.result.metrics.safe_recoveries, { recovered: 6, trials: 6 });
  assert.deepStrictEqual(evidence.result.metrics.ambiguous_blocks, {
    blocked: 4,
    treatment_nonrepeatable_trials: 6,
  });
  assert.deepStrictEqual(evidence.result.metrics.tamper_detections, { detected: 2, trials: 2 });
  assert.deepStrictEqual(evidence.result.metrics.privacy_leaks, { leaks: 0, scanned_surfaces: 2 });
  assert.equal(evidence.result.outcome, 'passed');
  assert(evidence.result.gates.every((gate) => gate.pass));
});

test('evidence is deterministic and explicitly bounded', () => {
  assert.deepStrictEqual(buildEvidence(), evidence);
  assert.equal(evidence.raw.evidence_scope.method, METHOD);
  assert.match(evidence.result.evidence_claim_boundary, /not process-kill or power-loss evidence/);
});

test('persisted evidence writes idempotently and verifies by deterministic rerun', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-evidence-'));
  try {
    const paths = {
      rawPath: path.join(root, 'raw.json'),
      resultPath: path.join(root, 'result.json'),
    };
    const firstWrite = writeEvidence(evidence, paths);
    const firstRawMtime = fs.statSync(paths.rawPath).mtimeMs;
    const firstResultMtime = fs.statSync(paths.resultPath).mtimeMs;
    const secondWrite = writeEvidence(evidence, paths);
    assert.equal(firstWrite.rawStatus, 'created');
    assert.equal(firstWrite.resultStatus, 'created');
    assert.equal(secondWrite.rawStatus, 'unchanged');
    assert.equal(secondWrite.resultStatus, 'unchanged');
    assert.equal(fs.statSync(paths.rawPath).mtimeMs, firstRawMtime);
    assert.equal(fs.statSync(paths.resultPath).mtimeMs, firstResultMtime);
    const result = verify(paths);
    assert.equal(result.outcome, 'verified');
    assert.equal(result.metrics.duplicate_nonrepeatable_effects.treatment, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('raw evidence tampering is rejected', () => {
  const changed = structuredClone(evidence.raw);
  changed.trials[0].effect_attempts += 1;
  assert.throws(() => verifyEvidence(changed, evidence.result), /raw evidence digest mismatch/);
});

test('result and gate drift are rejected', () => {
  const changed = structuredClone(evidence.result);
  changed.gates[0].expected = 1;
  assert.throws(() => verifyEvidence(evidence.raw, changed), /result or gates differ/);
});

if (!process.exitCode) process.stdout.write(`\n${passed}/7 operation recovery experiment tests passed.\n`);

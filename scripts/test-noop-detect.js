#!/usr/bin/env node

/**
 * test-noop-detect.js - Calibration + regression test for the no-op detector.
 *
 * Runs core/skills/noop-detect.js against every labeled line in
 * core/skills/noop-calibration.json and asserts:
 *
 *   HARD INVARIANT (must never break):
 *     - Zero false positives on `load-bearing` lines (don't flag real instructions).
 *     - Zero false positives on `fringe-load-bearing` lines (NEVER flag a safeguard).
 *
 *   QUALITY BARS:
 *     - Recall on positives (`noop` + `noop-fragment`) >= RECALL_FLOOR.
 *     - Overall accuracy >= ACCURACY_FLOOR.
 *
 * Exit codes: 0 = all bars met; 1 = a bar failed (detector regressed).
 *
 * Usage:
 *   node scripts/test-noop-detect.js          # run, print confusion
 *   node scripts/test-noop-detect.js --json    # machine-readable
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { analyzeLine } = require('../core/skills/noop-detect');

const JSON_MODE = process.argv.includes('--json');

const CALIBRATION_PATH = path.resolve(__dirname, '..', 'core', 'skills', 'noop-calibration.json');

// A label is "positive" (detector SHOULD flag) or "negative" (MUST NOT flag).
const POSITIVE_LABELS = new Set(['noop', 'noop-fragment']);
const NEGATIVE_LABELS = new Set(['load-bearing', 'fringe-load-bearing']);

const RECALL_FLOOR   = 0.90; // catch at least 90% of real no-ops
const ACCURACY_FLOOR = 0.95; // overall

function main() {
  let calibration;
  try {
    calibration = JSON.parse(fs.readFileSync(CALIBRATION_PATH, 'utf8'));
  } catch (e) {
    console.error(`Cannot read calibration set at ${CALIBRATION_PATH}: ${e.message}`);
    process.exit(1);
  }

  const cases = calibration.cases || [];
  if (cases.length === 0) {
    console.error('Calibration set is empty.');
    process.exit(1);
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  const falsePositives = [];   // negatives wrongly flagged
  const falseNegatives = [];   // positives wrongly missed
  const guardFalsePositives = []; // fringe-load-bearing wrongly flagged (worst case)

  for (const c of cases) {
    const expectedPositive = POSITIVE_LABELS.has(c.label);
    const expectedNegative = NEGATIVE_LABELS.has(c.label);
    if (!expectedPositive && !expectedNegative) {
      console.error(`Unknown label "${c.label}" on case: ${c.text.slice(0, 50)}`);
      process.exit(1);
    }

    const { isCandidate, reason, noopHits } = analyzeLine(c.text);

    if (expectedPositive && isCandidate) tp++;
    else if (expectedPositive && !isCandidate) { fn++; falseNegatives.push({ ...c, reason }); }
    else if (expectedNegative && !isCandidate) tn++;
    else if (expectedNegative && isCandidate) {
      fp++;
      falsePositives.push({ ...c, reason, noopHits });
      if (c.label === 'fringe-load-bearing') guardFalsePositives.push(c);
    }
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall    = tp + fn === 0 ? 1 : tp / (tp + fn);
  const accuracy  = (tp + tn) / cases.length;

  const result = {
    total: cases.length,
    confusion: { tp, fp, tn, fn },
    precision: +precision.toFixed(4),
    recall: +recall.toFixed(4),
    accuracy: +accuracy.toFixed(4),
    guardFalsePositives: guardFalsePositives.length,
    falsePositives: falsePositives.map(f => ({ text: f.text, label: f.label, hits: f.noopHits })),
    falseNegatives: falseNegatives.map(f => ({ text: f.text, label: f.label })),
  };

  if (JSON_MODE) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\nNo-op Detector Calibration\n' + '='.repeat(40));
    console.log(`Cases:      ${cases.length}`);
    console.log(`Confusion:  TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}`);
    console.log(`Precision:  ${(precision * 100).toFixed(1)}%  (of flagged lines, how many are real)`);
    console.log(`Recall:     ${(recall * 100).toFixed(1)}%  (of real no-ops, how many we catch)`);
    console.log(`Accuracy:   ${(accuracy * 100).toFixed(1)}%`);
    if (falsePositives.length) {
      console.log('\nFALSE POSITIVES (flagged a load-bearing/guard line):');
      for (const f of falsePositives) {
        const danger = f.label === 'fringe-load-bearing' ? '  <-- GUARD, critical' : '';
        console.log(`  [${f.label}] ${f.text.slice(0, 70)}${danger}`);
        console.log(`     hits: ${f.noopHits.join(', ')}`);
      }
    }
    if (falseNegatives.length) {
      console.log('\nFALSE NEGATIVES (missed a real no-op):');
      for (const f of falseNegatives) {
        console.log(`  [${f.label}] ${f.text.slice(0, 70)}`);
      }
    }
    console.log('');
  }

  // ── Gates ────────────────────────────────────────────────────────────────
  const failures = [];
  if (guardFalsePositives.length > 0) {
    failures.push(`${guardFalsePositives.length} fringe-load-bearing guard(s) flagged - a safeguard would be deleted. This is the most dangerous failure mode.`);
  }
  // Any false positive on a negative is a hard fail: the detector must not flag
  // load-bearing instructions either.
  const loadBearingFP = falsePositives.filter(f => f.label === 'load-bearing').length;
  if (loadBearingFP > 0) {
    failures.push(`${loadBearingFP} load-bearing line(s) flagged - false positives erode trust in the gate.`);
  }
  if (recall < RECALL_FLOOR) {
    failures.push(`Recall ${(recall * 100).toFixed(1)}% < floor ${(RECALL_FLOOR * 100).toFixed(0)}% - missing too many real no-ops.`);
  }
  if (accuracy < ACCURACY_FLOOR) {
    failures.push(`Accuracy ${(accuracy * 100).toFixed(1)}% < floor ${(ACCURACY_FLOOR * 100).toFixed(0)}%.`);
  }

  if (failures.length) {
    if (!JSON_MODE) {
      console.log('No-op detector calibration FAILED:');
      for (const f of failures) console.log(`  - ${f}`);
      console.log('');
    }
    process.exit(1);
  }

  if (!JSON_MODE) {
    console.log('No-op detector calibration PASSED.\n');
  }
  process.exit(0);
}

main();

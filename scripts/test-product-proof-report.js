#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT = path.resolve(__dirname, '..', 'docs', 'PRODUCT_PROOF_REPORT.md');

function main() {
  const report = fs.readFileSync(REPORT, 'utf8');
  for (const axis of [
    'Reliable', 'Installable', 'Fast to value', 'Resumable', 'Understandable',
    'Useful', 'Retained', 'Interoperable', 'Releasable', 'Showable',
  ]) {
    assert(report.includes(`**${axis}**`), `missing product-proof axis: ${axis}`);
  }
  for (const evidence of [
    'v1.1.0', '30 of 30', '782 stars', '1,420 unique viewers', '585 unique cloners',
    '25 seven-day-eligible installations', '15% return use', 'no qualifying submissions',
  ]) {
    assert(report.includes(evidence), `missing current evidence or limitation: ${evidence}`);
  }
  for (const target of [
    'BENCHMARK.md', 'PRODUCT_PROOF_TRIAL.md',
    'activation-telemetry.js share', 'activation-cohort.js report',
    'github-traffic-snapshot.js', 'release-verify.js',
  ]) {
    assert(report.includes(target), `missing reproducible evidence reference: ${target}`);
  }
  assert.match(report, /## Known limitations and stopping condition/);
  assert.match(report, /Do not claim retained human use until the cohort report says `ready`/);
  assert.doesNotMatch(report, /PR #181.*current delivery path/i);
  assert.doesNotMatch(report, /no `v1\.1\.0` tag/i);
  assert.doesNotMatch(report, /Citadel 1\.1 stays open/i);
  assert.doesNotMatch(report, /—/);
  process.stdout.write('Product-proof report tests passed.\n');
}

main();

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'docs', 'PRODUCT_PROOF_REPORT.md');

function main() {
  assert(fs.existsSync(REPORT), 'product-proof report must exist');
  const report = fs.readFileSync(REPORT, 'utf8');

  for (const status of [
    'Implementation-ready',
    'Locally proven',
    'CI-proven',
    'Human-proven',
    'Release-ready',
    'Blocked',
  ]) {
    assert(report.includes(`**${status}**`), `missing evidence status: ${status}`);
  }

  for (const axis of [
    'Reliable',
    'Installable',
    'Fast to value',
    'Resumable',
    'Understandable',
    'Useful',
    'Retained',
    'Interoperable',
    'Releasable',
    'Showable',
  ]) {
    assert(report.includes(`**${axis}**`), `missing milestone axis: ${axis}`);
  }

  for (const evidence of [
    '172.5 seconds',
    '15/30',
    '47.6 MB',
    '55.1-55.5 MB',
    '3.9-4.4 MB',
    'zero events',
    '60 deterministic runs',
    'PR #181',
    'no `v1.1.0` tag',
    '90-second, non-mocked demo',
  ]) {
    assert(report.includes(evidence), `missing honest evidence or limitation: ${evidence}`);
  }

  for (const target of [
    '../.github/workflows/tests.yml',
    'RELEASES.md',
    'GOLDEN_PATH.md',
    'DASHBOARD_SPEC.md',
    'BENCHMARK.md',
    'PRODUCT_PROOF_TRIAL.md',
    'benchmarks/product-proof-fixture-raw.jsonl',
    'benchmarks/product-proof-fixture-report.json',
    'INTEROPERABILITY.md',
    'ACTIVATION_METRICS.md',
    '../.planning/product-proof/activation-report.json',
  ]) {
    assert(report.includes(target), `missing evidence link: ${target}`);
    const absolute = path.resolve(path.dirname(REPORT), target.split('#')[0]);
    assert(fs.existsSync(absolute), `evidence link does not resolve: ${target}`);
  }

  assert.match(report, /## Known limitations and stopping condition/);
  assert.match(report, /blocked, not release-ready/i);
  assert.doesNotMatch(report, /Citadel 1\.1 (?:is|has been) (?:milestone-)?complete/i);
  assert.doesNotMatch(report, /all (?:milestone )?gates (?:are|have been) (?:green|passed)/i);
  assert.doesNotMatch(report, /ready (?:for|to) (?:release|ship|launch)/i);

  process.stdout.write('Product-proof report tests passed.\n');
}

main();

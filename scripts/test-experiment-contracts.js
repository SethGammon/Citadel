#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  validateBaseline,
  validateManifest,
  verify,
} = require('./experiment-contracts');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, 'experiment-manifest.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, 'bloat-baseline.json'), 'utf8'));

test('frozen contract and baseline verify', () => verify());
test('manifest tampering is rejected', () => {
  const changed = structuredClone(manifest);
  changed.experiments[0].gates[0] = 'duplicates <= 1';
  let rejected = false;
  try { validateManifest(changed); } catch { rejected = true; }
  if (!rejected) throw new Error('tampered manifest was accepted');
});
test('missing external boundary is rejected', () => {
  const changed = structuredClone(manifest);
  delete changed.experiments[2].invalid_substitutions;
  let rejected = false;
  try { validateManifest(changed); } catch { rejected = true; }
  if (!rejected) throw new Error('incomplete external boundary was accepted');
});
test('bloat baseline tampering is rejected', () => {
  const changed = structuredClone(baseline);
  changed.npm_pack.packed_bytes -= 1;
  let rejected = false;
  try { validateBaseline(changed); } catch { rejected = true; }
  if (!rejected) throw new Error('tampered bloat baseline was accepted');
});

if (!process.exitCode) process.stdout.write(`\n${passed}/4 experiment contract tests passed.\n`);

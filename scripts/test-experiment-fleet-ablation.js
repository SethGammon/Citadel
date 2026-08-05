#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const fleet = require('./experiment-fleet-ablation');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`PASS ${name}\n`); }
  catch (error) { process.stderr.write(`FAIL ${name}: ${error.message}\n`); process.exitCode = 1; }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-fleet-ablation-test-'));
function checkout(name) {
  const target = path.join(root, name);
  fs.cpSync(path.join(__dirname, '..', 'benchmarks', 'citadel-proof-experiments', 'fleet-ablation', 'fixture'), target, { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'slugify.js'), "'use strict';\nconst slugify=v=>String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');\nmodule.exports={slugify};\n");
  fs.writeFileSync(path.join(target, 'src', 'duration.js'), "'use strict';\nfunction parseDuration(v){const m=typeof v==='string'&&v.match(/^(\\d+)(ms|s|m|h)$/);if(!m)throw Error('invalid');return Number(m[1])*({ms:1,s:1000,m:60000,h:3600000}[m[2]]);}\nmodule.exports={parseDuration};\n");
  execFileSync('git', ['init', '-b', 'main'], { cwd: target, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: target });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: target });
  execFileSync('git', ['add', '.'], { cwd: target });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: target, stdio: 'ignore' });
  return target;
}

function raw(arm, target, worktrees = []) {
  return {
    schema: 1, kind: 'citadel_fleet_ablation_observation', suite_id: 'citadel-fleet-ablation-seed-v1', arm,
    mode: arm === 'serial' ? 'serial_shared_checkout' : 'isolated_parallel_worktrees',
    started_at: '2026-08-04T14:00:00.000Z', completed_at: arm === 'serial' ? '2026-08-04T14:10:00.000Z' : '2026-08-04T14:07:00.000Z',
    identity: { provider: 'test', model: 'fixture', model_family: 'fixture', runtime: 'node', runtime_version: process.version },
    checkout: target, worktrees, agent_count: 2, interventions: 0, rework_cycles: 0, scope_conflicts: 0, merge_conflicts: 0,
    tokens: null, cost_usd: null, telemetry_status: 'unavailable',
  };
}

const serialCheckout = checkout('serial');
const parallelCheckout = checkout('parallel-main');
const worktreeA = path.join(root, 'parallel-a');
const worktreeB = path.join(root, 'parallel-b');
fs.cpSync(parallelCheckout, worktreeA, { recursive: true });
fs.cpSync(parallelCheckout, worktreeB, { recursive: true });
const output = path.join(root, 'evidence');
fs.mkdirSync(output);
const serialInput = path.join(root, 'serial-input.json');
const parallelInput = path.join(root, 'parallel-input.json');
fs.writeFileSync(serialInput, JSON.stringify(raw('serial', serialCheckout)));
fs.writeFileSync(parallelInput, JSON.stringify(raw('parallel', parallelCheckout, [worktreeA, worktreeB])));
const serialFile = path.join(output, fleet.FILES.serial);
const parallelFile = path.join(output, fleet.FILES.parallel);
const serial = fleet.observe({ input: serialInput, output: serialFile });
const parallel = fleet.observe({ input: parallelInput, output: parallelFile });

try {
  test('matched observations bind real accepted outcomes', () => { assert.equal(serial.accepted, true); assert.equal(parallel.accepted, true); assert.equal(serial.source_tree_sha256, parallel.source_tree_sha256); });
  test('parallel observation requires two distinct git worktree paths', () => { assert.equal(parallel.isolation_verified, true); assert.equal(parallel.worktrees.length, 2); });
  test('report compares wall time and stays instrument only', () => { const result = fleet.report({ serial: serialFile, parallel: parallelFile, output }); assert.equal(result.metrics.wall_time_improvement, 0.3); assert.equal(result.claim_status, 'instrument_only'); assert.equal(result.external_promotion_gates.token_and_cost_telemetry_observed, false); });
  test('verify reruns accepted outcomes and receipts', () => { assert.equal(fleet.verify({ output }).instrument_status, 'passed'); });
  test('same-checkout parallelism is rejected', () => { const changed = raw('parallel', parallelCheckout, [parallelCheckout, worktreeB]); assert.throws(() => fleet.validateRaw(changed), /not isolated/); });
  test('tampered accepted outcome is rejected', () => { const changed = { ...parallel, accepted: false }; assert.throws(() => fleet.validateRecord(changed), /receipt mismatch|accepted outcome/); });
  if (!process.exitCode) process.stdout.write(`\n${passed}/6 Fleet ablation tests passed.\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

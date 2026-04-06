/**
 * COMPAT-14: Runtime detection
 * Validates that detect-runtime.js correctly identifies runtimes.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

async function run() {
  const { detectRuntime } = require(path.join(__dirname, '..', 'detect-runtime.js'));
  const errors = [];

  // Test 1: Env var override works
  const origEnv = process.env.CITADEL_RUNTIME;
  process.env.CITADEL_RUNTIME = 'codex';
  const r1 = detectRuntime('/nonexistent');
  if (r1.runtime !== 'codex' || r1.method !== 'env') {
    errors.push(`Env override: expected codex/env, got ${r1.runtime}/${r1.method}`);
  }

  process.env.CITADEL_RUNTIME = 'claude-code';
  const r2 = detectRuntime('/nonexistent');
  if (r2.runtime !== 'claude-code' || r2.method !== 'env') {
    errors.push(`Env override: expected claude-code/env, got ${r2.runtime}/${r2.method}`);
  }

  // Invalid env value should be ignored
  process.env.CITADEL_RUNTIME = 'invalid-value';
  const r3 = detectRuntime('/nonexistent');
  if (r3.method === 'env') {
    errors.push(`Invalid env value should be ignored, got method: env`);
  }

  // Restore
  if (origEnv !== undefined) {
    process.env.CITADEL_RUNTIME = origEnv;
  } else {
    delete process.env.CITADEL_RUNTIME;
  }

  // Test 2: Directory marker detection
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-test-'));

  // No markers -> unknown
  const r4 = detectRuntime(tmpDir);
  // Process tree may detect claude, so just check it doesn't crash
  if (!['claude-code', 'codex', 'unknown'].includes(r4.runtime)) {
    errors.push(`No markers: unexpected runtime ${r4.runtime}`);
  }

  // .claude/ only -> claude-code (or process-tree)
  fs.mkdirSync(path.join(tmpDir, '.claude'));
  const origRuntime = process.env.CITADEL_RUNTIME;
  delete process.env.CITADEL_RUNTIME;
  const r5 = detectRuntime(tmpDir);
  if (r5.runtime !== 'claude-code' && r5.method !== 'process-tree') {
    errors.push(`Claude marker: expected claude-code, got ${r5.runtime} (${r5.method})`);
  }

  // .codex/ only -> codex
  fs.rmdirSync(path.join(tmpDir, '.claude'));
  fs.mkdirSync(path.join(tmpDir, '.codex'));
  const r6 = detectRuntime(tmpDir);
  if (r6.runtime !== 'codex' && r6.method !== 'process-tree') {
    errors.push(`Codex marker: expected codex, got ${r6.runtime} (${r6.method})`);
  }

  // Cleanup
  fs.rmdirSync(path.join(tmpDir, '.codex'));
  fs.rmdirSync(tmpDir);
  if (origRuntime !== undefined) process.env.CITADEL_RUNTIME = origRuntime;

  if (errors.length > 0) {
    return { pass: false, message: errors.join('; ') };
  }
  return { pass: true, message: 'All runtime detection tests passed' };
}

module.exports = { run };

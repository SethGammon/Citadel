#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const telemetryDir = path.join(projectRoot, '.planning', 'telemetry');
const verificationDir = path.join(projectRoot, '.planning', 'verification');
const baselinePath = path.join(verificationDir, 'codex-live-baseline.json');

function readLineCount(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content) return 0;
  return content.split('\n').filter(Boolean).length;
}

function readSize(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.statSync(filePath).size;
}

function snapshot() {
  return {
    timestamp: new Date().toISOString(),
    hookTiming: readLineCount(path.join(telemetryDir, 'hook-timing.jsonl')),
    audit: readLineCount(path.join(telemetryDir, 'audit.jsonl')),
    hookErrors: readLineCount(path.join(telemetryDir, 'hook-errors.log')),
    hookTrace: readLineCount(path.join(telemetryDir, 'codex-hook-trace.jsonl')),
    hookErrorsBytes: readSize(path.join(telemetryDir, 'hook-errors.log')),
  };
}

function ensureVerificationDir() {
  fs.mkdirSync(verificationDir, { recursive: true });
}

function writeBaseline() {
  ensureVerificationDir();
  const snap = snapshot();
  fs.writeFileSync(baselinePath, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  console.log(`Saved Codex live verification baseline to ${baselinePath}`);
  console.log(JSON.stringify(snap, null, 2));
}

function report() {
  const current = snapshot();
  let baseline = null;
  if (fs.existsSync(baselinePath)) {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  }

  const delta = baseline ? {
    hookTiming: current.hookTiming - baseline.hookTiming,
    audit: current.audit - baseline.audit,
    hookErrors: current.hookErrors - baseline.hookErrors,
    hookTrace: current.hookTrace - baseline.hookTrace,
    hookErrorsBytes: current.hookErrorsBytes - baseline.hookErrorsBytes,
  } : null;

  const result = {
    baseline,
    current,
    delta,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!baseline) {
    console.log('\nNo baseline found. Run `node scripts/codex-live-verify.js baseline` before the live probe.');
    return;
  }

  if (delta.hookTrace <= 0) {
    console.log('\nHOOK DISPATCH: FAIL');
    console.log('No new codex-hook-trace entries. Codex likely did not execute the configured hooks.');
    return;
  }

  if (delta.audit <= 0 && delta.hookTiming <= 0) {
    console.log('\nHOOK DISPATCH: PASS');
    console.log('Telemetry write-path still failed after hook dispatch. Inspect the underlying hook scripts.');
    return;
  }

  console.log('\nHOOK HEALTH: PASS');
  console.log('Codex dispatched hooks and Citadel telemetry advanced.');
}

const mode = process.argv[2];
if (mode === 'baseline') {
  writeBaseline();
} else if (mode === 'report') {
  report();
} else {
  console.log('Usage: node scripts/codex-live-verify.js <baseline|report>');
  process.exit(1);
}

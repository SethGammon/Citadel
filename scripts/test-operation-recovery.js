#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  JournalCorruptionError,
  planRecovery,
  readJournal,
  sha256Digest,
} = require('../core/operations');
const { executeStepAttempt, recoverStepAttempt } = require('./operation-runner');

const NOW = '2026-07-13T12:00:00.000Z';
const EVIDENCE = sha256Digest({ check: 'passed' });
const PAYLOAD = sha256Digest({ operation: 'safe-test' });

function attempt(id = 'attempt-demo-1') {
  return {
    protocol_version: '0.1', kind: 'step_attempt', attempt_id: id,
    run_id: 'run-demo', step_id: 'step-demo', attempt_number: 1, status: 'running',
    started_at: NOW, completed_at: null, evidence_ids: [], failure_code: null,
  };
}

function options(journalDir, effect, overrides = {}) {
  return {
    journalDir,
    attempt: attempt(),
    idempotencyKey: 'effect-demo',
    effectClass: 'pure',
    payloadDigest: PAYLOAD,
    effect,
    now: NOW,
    ...overrides,
  };
}

let passed = 0;
function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-recovery-'));
  try {
    fn(root);
    passed++;
    process.stdout.write(`  PASS ${name}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('completed effects produce hash-chained step checkpoints and are not repeated', (journalDir) => {
  let effects = 0;
  const first = executeStepAttempt(options(journalDir, () => { effects++; return { evidence_digest: EVIDENCE }; }));
  assert.equal(first.status, 'completed');
  assert.equal(effects, 1);
  const journal = readJournal(journalDir);
  assert.deepEqual(journal.entries.map((entry) => entry.state), ['pending', 'completed']);
  assert.equal(journal.entries[1].previous_hash, journal.entries[0].entry_hash);
  const second = recoverStepAttempt(options(journalDir, () => { effects++; return { evidence_digest: EVIDENCE }; }));
  assert.equal(second.execution, 'skipped');
  assert.equal(effects, 1);
});

test('safe effects recover from a crash after the effect boundary', (journalDir) => {
  let effects = 0;
  assert.throws(() => executeStepAttempt(options(journalDir, () => {
    effects++;
    return { evidence_digest: EVIDENCE };
  }, { faultAt: 'after_effect' })), /Injected fault/);
  assert.equal(effects, 1);
  assert.equal(planRecovery(journalDir).actions[0].decision, 'retry');
  const recovered = recoverStepAttempt(options(journalDir, () => {
    effects++;
    return { evidence_digest: EVIDENCE };
  }));
  assert.equal(recovered.execution, 'repeated_safely');
  assert.equal(effects, 2);
  assert.deepEqual(readJournal(journalDir).entries.map((entry) => entry.state), ['pending', 'pending', 'completed']);
});

test('effect errors checkpoint unknown without leaking error content', (journalDir) => {
  const result = executeStepAttempt(options(journalDir, () => { throw new Error('secret path C:\\private'); }));
  assert.deepEqual(result, { status: 'unknown', execution: 'attempted', reason_code: 'EFFECT_OUTCOME_UNKNOWN' });
  const raw = fs.readFileSync(path.join(journalDir, '00000002.json'), 'utf8');
  assert(!raw.includes('secret'));
  assert(!raw.includes('private'));
  assert.deepEqual(readJournal(journalDir).entries.map((entry) => entry.state), ['pending', 'unknown']);
});

test('temporary atomic-write debris is ignored', (journalDir) => {
  executeStepAttempt(options(journalDir, () => ({ evidence_digest: EVIDENCE })));
  fs.writeFileSync(path.join(journalDir, '.00000003.json.crash.tmp'), '{partial');
  assert.equal(readJournal(journalDir).entries.length, 2);
});

test('tampering is rejected and corrupt journals block recovery', (journalDir) => {
  executeStepAttempt(options(journalDir, () => ({ evidence_digest: EVIDENCE })));
  const file = path.join(journalDir, '00000001.json');
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  entry.state = 'unknown';
  fs.writeFileSync(file, JSON.stringify(entry));
  assert.throws(() => readJournal(journalDir), JournalCorruptionError);
  const plan = planRecovery(journalDir);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.journal_status, 'corrupt');
  assert.equal(plan.reason_code, 'JOURNAL_CORRUPT');
  const result = recoverStepAttempt(options(journalDir, () => { throw new Error('must not run'); }));
  assert.equal(result.execution, 'blocked');
});

process.stdout.write(`Operation recovery tests: ${passed} passed.\n`);

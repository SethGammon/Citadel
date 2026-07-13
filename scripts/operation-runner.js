#!/usr/bin/env node

'use strict';

const path = require('path');
const {
  DIGEST_PATTERN,
  EFFECT_CLASSES,
  appendJournalEntry,
  planRecovery,
  readJournal,
  recoveryAction,
  validateStepAttempt,
} = require('../core/operations');

const FAULT_BOUNDARIES = Object.freeze([
  'before_pending_write',
  'after_pending_write',
  'before_effect',
  'after_effect',
  'before_completed_write',
  'after_completed_write',
]);

class FaultInjectionError extends Error {
  constructor(boundary) {
    super(`Injected fault at ${boundary}`);
    this.name = 'FaultInjectionError';
    this.code = 'FAULT_INJECTED';
    this.boundary = boundary;
  }
}

function inject(options, boundary) {
  if (!FAULT_BOUNDARIES.includes(boundary)) throw new Error(`Unknown fault boundary: ${boundary}`);
  if (options.faultAt === boundary) throw new FaultInjectionError(boundary);
  if (typeof options.faultInjector === 'function') options.faultInjector(boundary);
}

function assertRunnerOptions(options) {
  const errors = validateStepAttempt(options.attempt);
  if (errors.length) throw new TypeError(`Invalid step attempt: ${errors.join('; ')}`);
  if (options.attempt.status !== 'running') throw new TypeError('Step attempt must be running before execution');
  if (!EFFECT_CLASSES.includes(options.effectClass)) throw new TypeError('Invalid effect class');
  if (typeof options.idempotencyKey !== 'string' || options.idempotencyKey.length > 128
    || !/^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/.test(options.idempotencyKey)) {
    throw new TypeError('Invalid idempotency key');
  }
  if (typeof options.payloadDigest !== 'string' || !DIGEST_PATTERN.test(options.payloadDigest)) {
    throw new TypeError('payloadDigest must be a sha256 digest');
  }
  if (typeof options.effect !== 'function') throw new TypeError('effect must be a function');
  if (typeof options.journalDir !== 'string' || !options.journalDir) throw new TypeError('journalDir is required');
}

function checkpointInput(options, state, evidenceDigest = null) {
  return {
    run_id: options.attempt.run_id,
    attempt_id: options.attempt.attempt_id,
    idempotency_key: options.idempotencyKey,
    effect_class: options.effectClass,
    state,
    payload_digest: options.payloadDigest,
    evidence_digest: evidenceDigest,
  };
}

function executeStepAttempt(options) {
  assertRunnerOptions(options);
  const plan = planRecovery(options.journalDir);
  const action = recoveryAction(plan, options.idempotencyKey);
  if (action.decision === 'skip') {
    return Object.freeze({ status: 'completed', execution: 'skipped', reason_code: action.reason_code });
  }
  if (action.decision === 'block') {
    return Object.freeze({ status: 'unknown', execution: 'blocked', reason_code: action.reason_code });
  }

  inject(options, 'before_pending_write');
  appendJournalEntry(options.journalDir, checkpointInput(options, 'pending'), { now: options.now });
  inject(options, 'after_pending_write');
  inject(options, 'before_effect');

  let effectResult;
  try {
    effectResult = options.effect();
  } catch (_error) {
    appendJournalEntry(options.journalDir, checkpointInput(options, 'unknown'), { now: options.now });
    return Object.freeze({ status: 'unknown', execution: 'attempted', reason_code: 'EFFECT_OUTCOME_UNKNOWN' });
  }

  inject(options, 'after_effect');
  inject(options, 'before_completed_write');
  const evidenceDigest = effectResult && effectResult.evidence_digest;
  if (typeof evidenceDigest !== 'string' || !DIGEST_PATTERN.test(evidenceDigest)) {
    appendJournalEntry(options.journalDir, checkpointInput(options, 'unknown'), { now: options.now });
    inject(options, 'after_completed_write');
    return Object.freeze({ status: 'unknown', execution: 'attempted', reason_code: 'MISSING_EVIDENCE' });
  }
  const checkpoint = appendJournalEntry(options.journalDir,
    checkpointInput(options, 'completed', evidenceDigest), { now: options.now });
  inject(options, 'after_completed_write');
  return Object.freeze({
    status: 'completed',
    execution: action.decision === 'retry' ? 'repeated_safely' : 'executed',
    reason_code: 'EVIDENCE_RECORDED',
    checkpoint,
  });
}

function recoverStepAttempt(options) {
  return executeStepAttempt(options);
}

function parseArgs(argv) {
  const command = argv[0];
  if (!['plan', 'verify'].includes(command)) throw new Error('command must be plan or verify');
  if (argv[1] !== '--journal-dir' || !argv[2] || argv.length !== 3) {
    throw new Error(`${command} requires --journal-dir <directory>`);
  }
  return { command, journalDir: path.resolve(argv[2]) };
}

function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.command === 'plan') return planRecovery(parsed.journalDir);
  const journal = readJournal(parsed.journalDir);
  return { status: 'verified', entries: journal.entries.length, head_hash: journal.head_hash };
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(runCli(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'blocked', reason_code: error.code || 'OPERATION_RUNNER_ERROR' })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = Object.freeze({
  FAULT_BOUNDARIES,
  FaultInjectionError,
  executeStepAttempt,
  parseArgs,
  recoverStepAttempt,
  runCli,
});

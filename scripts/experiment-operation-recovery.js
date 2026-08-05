#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendJournalEntry,
  planRecovery,
  readJournal,
  sha256Digest,
} = require('../core/operations');
const {
  FAULT_BOUNDARIES,
  FaultInjectionError,
  executeStepAttempt,
  recoverStepAttempt,
} = require('./operation-runner');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, '.planning', 'research', 'citadel-proof-experiments');
const RAW_PATH = path.join(EVIDENCE_DIR, 'operation-recovery-raw.json');
const RESULT_PATH = path.join(EVIDENCE_DIR, 'operation-recovery-results.json');
const NOW = '2026-08-04T00:00:00.000Z';
const METHOD = 'deterministic_in_process_fault_injection';
const WORKLOADS = Object.freeze([
  Object.freeze({ id: 'nonrepeatable', effect_class: 'external-nonrepeatable' }),
  Object.freeze({ id: 'safe-repeatable', effect_class: 'workspace-reversible' }),
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return sha256Digest(stable(value));
}

function attempt(workload, boundary) {
  const suffix = `${workload.id}-${boundary.replaceAll('_', '-')}`;
  return {
    protocol_version: '0.1',
    kind: 'step_attempt',
    attempt_id: `attempt-${suffix}`,
    run_id: `run-${suffix}`,
    step_id: `step-${workload.id}`,
    attempt_number: 1,
    status: 'running',
    started_at: NOW,
    completed_at: null,
    evidence_ids: [],
    failure_code: null,
  };
}

function trialOptions(journalDir, workload, boundary, effect, faultAt = null) {
  return {
    journalDir,
    attempt: attempt(workload, boundary),
    idempotencyKey: `${workload.id}-${boundary.replaceAll('_', '-')}`,
    effectClass: workload.effect_class,
    payloadDigest: digest({ operation: workload.id, boundary }),
    effect,
    faultAt,
    now: NOW,
  };
}

function injectNaiveFault(faultAt, boundary) {
  if (faultAt === boundary) throw new FaultInjectionError(boundary);
}

function naiveAttempt(faultAt, effect) {
  injectNaiveFault(faultAt, 'before_pending_write');
  injectNaiveFault(faultAt, 'after_pending_write');
  injectNaiveFault(faultAt, 'before_effect');
  effect();
  injectNaiveFault(faultAt, 'after_effect');
  injectNaiveFault(faultAt, 'before_completed_write');
  injectNaiveFault(faultAt, 'after_completed_write');
  return { status: 'completed', execution: 'naive_rerun' };
}

function runControlTrial(workload, boundary) {
  let effectAttempts = 0;
  const effect = () => { effectAttempts += 1; };
  let injectedFaultObserved = false;
  try {
    naiveAttempt(boundary, effect);
  } catch (error) {
    assert(error instanceof FaultInjectionError);
    assert.equal(error.boundary, boundary);
    injectedFaultObserved = true;
  }
  const recovered = naiveAttempt(null, effect);
  const duplicateEffects = workload.id === 'nonrepeatable'
    ? Math.max(0, effectAttempts - 1)
    : 0;
  return {
    boundary,
    workload: workload.id,
    effect_class: workload.effect_class,
    arm: 'control',
    injected_fault_observed: injectedFaultObserved,
    recovery_execution: recovered.execution,
    recovery_status: recovered.status,
    effect_attempts: effectAttempts,
    duplicate_nonrepeatable_effects: duplicateEffects,
    recovered_safely: workload.id === 'safe-repeatable',
    ambiguous_block: false,
    journal_states: [],
    recovery_reason_code: 'NAIVE_RERUN_WITHOUT_JOURNAL',
  };
}

function runTreatmentTrial(workload, boundary) {
  const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-ab-'));
  try {
    let effectAttempts = 0;
    const effect = () => {
      effectAttempts += 1;
      return { evidence_digest: digest({ receipt: workload.id, boundary }) };
    };
    let injectedFaultObserved = false;
    try {
      executeStepAttempt(trialOptions(journalDir, workload, boundary, effect, boundary));
    } catch (error) {
      assert(error instanceof FaultInjectionError);
      assert.equal(error.boundary, boundary);
      injectedFaultObserved = true;
    }

    const plan = planRecovery(journalDir);
    const recovered = recoverStepAttempt(trialOptions(journalDir, workload, boundary, effect));
    const journal = readJournal(journalDir);
    const duplicateEffects = workload.id === 'nonrepeatable'
      ? Math.max(0, effectAttempts - 1)
      : 0;
    return {
      boundary,
      workload: workload.id,
      effect_class: workload.effect_class,
      arm: 'treatment',
      injected_fault_observed: injectedFaultObserved,
      recovery_execution: recovered.execution,
      recovery_status: recovered.status,
      effect_attempts: effectAttempts,
      duplicate_nonrepeatable_effects: duplicateEffects,
      recovered_safely: workload.id === 'safe-repeatable' && recovered.status === 'completed',
      ambiguous_block: recovered.execution === 'blocked',
      journal_states: journal.entries.map((entry) => entry.state),
      recovery_reason_code: recovered.reason_code,
      pre_recovery_plan_status: plan.status,
      pre_recovery_journal_status: plan.journal_status,
    };
  } finally {
    fs.rmSync(journalDir, { recursive: true, force: true });
  }
}

function completedJournal(journalDir, id) {
  const common = {
    run_id: `run-tamper-${id}`,
    attempt_id: `attempt-tamper-${id}`,
    idempotency_key: `effect-tamper-${id}`,
    effect_class: 'workspace-reversible',
    payload_digest: digest({ tamper_case: id }),
  };
  appendJournalEntry(journalDir, { ...common, state: 'pending', evidence_digest: null }, { now: NOW });
  appendJournalEntry(journalDir, {
    ...common,
    state: 'completed',
    evidence_digest: digest({ receipt: id }),
  }, { now: NOW });
}

function runTamperTrial(id, tamper) {
  const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-tamper-'));
  try {
    completedJournal(journalDir, id);
    tamper(journalDir);
    const plan = planRecovery(journalDir);
    return {
      id,
      detected: plan.status === 'blocked'
        && plan.journal_status === 'corrupt'
        && plan.reason_code === 'JOURNAL_CORRUPT',
      recovery_status: plan.status,
      journal_status: plan.journal_status,
      reason_code: plan.reason_code,
    };
  } finally {
    fs.rmSync(journalDir, { recursive: true, force: true });
  }
}

function runTamperTrials() {
  const contentMutation = runTamperTrial('content', (journalDir) => {
    const file = path.join(journalDir, '00000001.json');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    entry.state = 'unknown';
    fs.writeFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  });
  const chainMutation = runTamperTrial('chain', (journalDir) => {
    const file = path.join(journalDir, '00000002.json');
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    entry.previous_hash = `sha256:${'0'.repeat(64)}`;
    const unsigned = { ...entry };
    delete unsigned.entry_hash;
    entry.entry_hash = sha256Digest(unsigned);
    fs.writeFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  });
  return [contentMutation, chainMutation];
}

function runPrivacyTrial() {
  const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operation-privacy-'));
  const canary = 'private-path-citadel-token-7421';
  try {
    const workload = WORKLOADS[0];
    const boundary = 'after_effect';
    const result = executeStepAttempt(trialOptions(journalDir, workload, boundary, () => {
      throw new Error(canary);
    }));
    const journalText = fs.readdirSync(journalDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => fs.readFileSync(path.join(journalDir, name), 'utf8'))
      .join('\n');
    const planText = JSON.stringify(planRecovery(journalDir));
    const scanned = [journalText, planText];
    return {
      id: 'effect-error-canary',
      effect_status: result.status,
      effect_reason_code: result.reason_code,
      scanned_surfaces: ['journal_entries', 'recovery_plan'],
      leak_count: scanned.filter((surface) => surface.includes(canary)).length,
    };
  } finally {
    fs.rmSync(journalDir, { recursive: true, force: true });
  }
}

function gate(id, expected, observed, pass) {
  return { id, expected, observed, pass };
}

function buildEvidence() {
  const trials = [];
  for (const boundary of FAULT_BOUNDARIES) {
    for (const workload of WORKLOADS) {
      trials.push(runControlTrial(workload, boundary));
      trials.push(runTreatmentTrial(workload, boundary));
    }
  }
  const tamperTrials = runTamperTrials();
  const privacyTrials = [runPrivacyTrial()];
  const nonrepeatable = trials.filter((trial) => trial.workload === 'nonrepeatable');
  const safeTreatment = trials.filter((trial) => trial.workload === 'safe-repeatable' && trial.arm === 'treatment');
  const controlDuplicates = nonrepeatable
    .filter((trial) => trial.arm === 'control')
    .reduce((total, trial) => total + trial.duplicate_nonrepeatable_effects, 0);
  const treatmentDuplicates = nonrepeatable
    .filter((trial) => trial.arm === 'treatment')
    .reduce((total, trial) => total + trial.duplicate_nonrepeatable_effects, 0);
  const safeRecoveries = safeTreatment.filter((trial) => trial.recovered_safely).length;
  const ambiguousBlocks = nonrepeatable
    .filter((trial) => trial.arm === 'treatment' && trial.ambiguous_block).length;
  const tamperDetections = tamperTrials.filter((trial) => trial.detected).length;
  const privacyLeaks = privacyTrials.reduce((total, trial) => total + trial.leak_count, 0);
  const raw = {
    schema: 1,
    kind: 'citadel_operation_recovery_raw_evidence',
    experiment_id: 'operation-recovery',
    recorded_at: NOW,
    evidence_scope: {
      method: METHOD,
      supports: 'deterministic recovery decisions at declared in-process fault boundaries',
      does_not_support: ['process-kill behavior', 'power-loss behavior'],
    },
    fault_boundaries: [...FAULT_BOUNDARIES],
    workloads: WORKLOADS.map((workload) => ({ ...workload })),
    trials,
    tamper_trials: tamperTrials,
    privacy_trials: privacyTrials,
  };
  const metrics = {
    duplicate_nonrepeatable_effects: {
      control: controlDuplicates,
      treatment: treatmentDuplicates,
    },
    safe_recoveries: {
      recovered: safeRecoveries,
      trials: safeTreatment.length,
    },
    ambiguous_blocks: {
      blocked: ambiguousBlocks,
      treatment_nonrepeatable_trials: FAULT_BOUNDARIES.length,
    },
    tamper_detections: {
      detected: tamperDetections,
      trials: tamperTrials.length,
    },
    privacy_leaks: {
      leaks: privacyLeaks,
      scanned_surfaces: privacyTrials.reduce((total, trial) => total + trial.scanned_surfaces.length, 0),
    },
  };
  const gates = [
    gate('treatment_duplicate_effects', 0, treatmentDuplicates, treatmentDuplicates === 0),
    gate('control_duplicate_effects', '> 0', controlDuplicates, controlDuplicates > 0),
    gate('safe_recoveries', 'all', `${safeRecoveries}/${safeTreatment.length}`, safeRecoveries === safeTreatment.length),
    gate('ambiguous_nonrepeatable_blocks', 4, ambiguousBlocks, ambiguousBlocks === 4),
    gate('tamper_detections', 'all', `${tamperDetections}/${tamperTrials.length}`, tamperDetections === tamperTrials.length),
    gate('privacy_leaks', 0, privacyLeaks, privacyLeaks === 0),
  ];
  const result = {
    schema: 1,
    kind: 'citadel_operation_recovery_result',
    experiment_id: 'operation-recovery',
    recorded_at: NOW,
    evidence_method: METHOD,
    evidence_claim_boundary: 'Deterministic fault-injection evidence only; not process-kill or power-loss evidence.',
    raw_evidence_sha256: digest(raw),
    metrics,
    gates,
    outcome: gates.every((item) => item.pass) ? 'passed' : 'failed',
  };
  return { raw, result };
}

function writeIfChanged(target, content) {
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) return 'unchanged';
  const existed = fs.existsSync(target);
  fs.writeFileSync(target, content, 'utf8');
  return existed ? 'updated' : 'created';
}

function writeEvidence(evidence, paths = {}) {
  const rawPath = paths.rawPath || RAW_PATH;
  const resultPath = paths.resultPath || RESULT_PATH;
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  const rawStatus = writeIfChanged(rawPath, `${JSON.stringify(evidence.raw, null, 2)}\n`);
  const resultStatus = writeIfChanged(resultPath, `${JSON.stringify(evidence.result, null, 2)}\n`);
  return { rawPath, resultPath, rawStatus, resultStatus };
}

function verifyEvidence(raw, result) {
  assert.equal(result.raw_evidence_sha256, digest(raw), 'raw evidence digest mismatch');
  const rerun = buildEvidence();
  assert.deepStrictEqual(raw, rerun.raw, 'raw evidence differs from deterministic rerun');
  assert.deepStrictEqual(result, rerun.result, 'result or gates differ from deterministic rerun');
  assert.equal(result.outcome, 'passed', 'experiment gates did not pass');
  assert(result.gates.every((item) => item.pass), 'one or more experiment gates failed');
  return {
    outcome: 'verified',
    evidence_method: METHOD,
    claim_boundary: result.evidence_claim_boundary,
    raw_evidence_sha256: result.raw_evidence_sha256,
    metrics: result.metrics,
    gates: result.gates.length,
  };
}

function verify(paths = {}) {
  const rawPath = paths.rawPath || RAW_PATH;
  const resultPath = paths.resultPath || RESULT_PATH;
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  return verifyEvidence(raw, result);
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !['run', 'verify'].includes(argv[0])) {
    throw new Error('Usage: node scripts/experiment-operation-recovery.js <run|verify>');
  }
  if (argv[0] === 'verify') return verify();
  const evidence = buildEvidence();
  const artifacts = writeEvidence(evidence);
  return {
    outcome: evidence.result.outcome,
    evidence_method: METHOD,
    claim_boundary: evidence.result.evidence_claim_boundary,
    raw_evidence_sha256: evidence.result.raw_evidence_sha256,
    metrics: evidence.result.metrics,
    gates: evidence.result.gates.length,
    artifacts: {
      raw: artifacts.rawStatus,
      result: artifacts.resultStatus,
    },
  };
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(runCli(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Operation recovery experiment failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = Object.freeze({
  METHOD,
  RAW_PATH,
  RESULT_PATH,
  buildEvidence,
  digest,
  runCli,
  verify,
  verifyEvidence,
  writeEvidence,
});

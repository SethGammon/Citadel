'use strict';

const { EFFECT_CLASSES, JournalCorruptionError, readJournal } = require('./journal');

function decisionFor(entry) {
  if (entry.state === 'completed') return { decision: 'skip', reason_code: 'ALREADY_COMPLETED' };
  if (entry.effect_class === 'external-nonrepeatable') {
    return { decision: 'block', reason_code: 'AMBIGUOUS_NONREPEATABLE_EFFECT' };
  }
  return { decision: 'retry', reason_code: entry.state === 'unknown' ? 'SAFE_RETRY_AFTER_UNKNOWN' : 'SAFE_RETRY_AFTER_PENDING' };
}

function planRecovery(journalDir) {
  let journal;
  try {
    journal = readJournal(journalDir);
  } catch (error) {
    if (!(error instanceof JournalCorruptionError)) throw error;
    return Object.freeze({
      status: 'blocked',
      journal_status: 'corrupt',
      reason_code: 'JOURNAL_CORRUPT',
      actions: Object.freeze([]),
    });
  }
  const latest = new Map();
  for (const entry of journal.entries) latest.set(entry.idempotency_key, entry);
  const actions = [...latest.values()].map((entry) => Object.freeze({
    run_id: entry.run_id,
    attempt_id: entry.attempt_id,
    idempotency_key: entry.idempotency_key,
    effect_class: entry.effect_class,
    state: entry.state,
    ...decisionFor(entry),
  }));
  const blocked = actions.some((action) => action.decision === 'block');
  const retry = actions.some((action) => action.decision === 'retry');
  return Object.freeze({
    status: blocked ? 'blocked' : retry ? 'ready' : 'complete',
    journal_status: 'verified',
    reason_code: blocked ? 'AMBIGUOUS_EFFECT' : retry ? 'RECOVERY_READY' : 'NOTHING_TO_REPEAT',
    actions: Object.freeze(actions),
  });
}

function recoveryAction(plan, idempotencyKey) {
  if (plan.journal_status === 'corrupt') return { decision: 'block', reason_code: 'JOURNAL_CORRUPT' };
  return plan.actions.find((action) => action.idempotency_key === idempotencyKey) || {
    decision: 'execute',
    reason_code: 'NO_PRIOR_CHECKPOINT',
  };
}

module.exports = Object.freeze({ EFFECT_CLASSES, decisionFor, planRecovery, recoveryAction });

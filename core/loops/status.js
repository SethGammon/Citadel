#!/usr/bin/env node

'use strict';

const ACTIVE_STATUSES = Object.freeze([
  'planned',
  'running',
  'waiting',
  'paused',
  'needs-human-review',
]);

const TERMINAL_STATUSES = Object.freeze([
  'done',
  'blocked',
  'budget-exhausted',
  'attempt-limit',
  'unsafe-to-continue',
  'verifier-passed',
  'verifier-failed',
  'no-active-work',
  'stopped',
]);

const LOOP_STATUSES = Object.freeze([
  ...ACTIVE_STATUSES,
  ...TERMINAL_STATUSES,
]);

function normalizeStatus(value, fallback = 'planned') {
  const status = String(value || '').trim().toLowerCase();
  if (LOOP_STATUSES.includes(status)) return status;
  return fallback;
}

function isTerminalStatus(value) {
  return TERMINAL_STATUSES.includes(normalizeStatus(value));
}

function stopSummary(status) {
  const normalized = normalizeStatus(status, 'blocked');
  const summaries = {
    done: 'The loop completed its declared work.',
    blocked: 'The loop cannot make safe progress without intervention.',
    'budget-exhausted': 'The loop reached its spend, session, or attempt budget.',
    'attempt-limit': 'The loop reached its maximum retry count.',
    'needs-human-review': 'The loop paused for a human decision.',
    'unsafe-to-continue': 'The loop stopped before taking an unsafe action.',
    'verifier-passed': 'The loop stopped because the verifier passed.',
    'verifier-failed': 'The loop stopped because the verifier failed.',
    'no-active-work': 'The loop stopped because no active work remained.',
    stopped: 'The loop was stopped explicitly.',
  };
  return summaries[normalized] || 'The loop status is active or unknown.';
}

module.exports = Object.freeze({
  ACTIVE_STATUSES,
  LOOP_STATUSES,
  TERMINAL_STATUSES,
  isTerminalStatus,
  normalizeStatus,
  stopSummary,
});

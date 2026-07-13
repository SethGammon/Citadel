'use strict';

const { EXECUTION_STATUSES } = require('./constants');
const { validateOperationRun, validateStepAttempt } = require('./validation');

const TRANSITIONS = Object.freeze({
  pending: Object.freeze(['running', 'blocked', 'unknown']),
  running: Object.freeze(['passed', 'failed', 'blocked', 'unknown']),
  blocked: Object.freeze(['running', 'failed', 'unknown']),
  passed: Object.freeze([]),
  failed: Object.freeze([]),
  unknown: Object.freeze([]),
});

function validateStatusTransition(from, to) {
  const errors = [];
  if (!EXECUTION_STATUSES.includes(from)) errors.push(`unknown source status: ${from}`);
  if (!EXECUTION_STATUSES.includes(to)) errors.push(`unknown target status: ${to}`);
  if (errors.length || from === to) return errors;
  if (!TRANSITIONS[from].includes(to)) errors.push(`invalid status transition: ${from} -> ${to}`);
  return errors;
}

function validateRecordTransition(previous, next, validator, immutableFields) {
  const errors = [...validator(previous), ...validator(next)];
  if (errors.length) return errors;
  for (const field of immutableFields) {
    if (previous[field] !== next[field]) errors.push(`${field} cannot change during a transition`);
  }
  errors.push(...validateStatusTransition(previous.status, next.status));
  return errors;
}

function validateOperationRunTransition(previous, next) {
  return validateRecordTransition(previous, next, validateOperationRun,
    ['protocol_version', 'kind', 'run_id', 'operation_id', 'spec_digest']);
}

function validateStepAttemptTransition(previous, next) {
  return validateRecordTransition(previous, next, validateStepAttempt,
    ['protocol_version', 'kind', 'attempt_id', 'run_id', 'step_id', 'attempt_number']);
}

module.exports = Object.freeze({
  TRANSITIONS,
  validateOperationRunTransition,
  validateStatusTransition,
  validateStepAttemptTransition,
});

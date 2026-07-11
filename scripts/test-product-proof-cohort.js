#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { parseJsonl, report, validateTrial } = require('./product-proof-cohort');

const commit = 'a'.repeat(40);
const selection = {
  schema: 1, kind: 'benchmark_selection', reviewer_id: 'reviewer-a1b2c3d4',
  evidence_url: 'https://github.com/SethGammon/Citadel/discussions/200#discussioncomment-1',
  selected_at: '2026-07-12T00:00:00.000Z', scenario_id: 'long-context-resume', runner_commit: commit,
};

function trial(index, overrides = {}) {
  const day = String(index + 1).padStart(2, '0');
  return {
    schema: 1, kind: 'participant_trial', participant_id: `participant-${String(index).padStart(8, '0')}`,
    evidence_url: `https://github.com/SethGammon/Citadel/discussions/200#discussioncomment-${index + 2}`,
    started_at: `2026-07-12T00:${day}:00.000Z`, first_route_ms: 300000 + index,
    handoff_ms: 600000 + index, dashboard_explanation_ms: 45000,
    dashboard_fields_correct: 4, install_success: true, setup_success: true,
    routed_task_success: true, handoff_verified: true, consent_aggregate: true,
    second_task_at: index < 5 ? `2026-07-13T00:${day}:00.000Z` : null,
    ...overrides,
  };
}

const complete = report([selection, ...Array.from({ length: 10 }, (_, index) => trial(index))]);
assert.equal(complete.milestone_ready, true);
assert.equal(complete.cohort.participants, 10);
assert.equal(complete.cohort.dashboard_passes, 10);
assert.equal(complete.cohort.return_users_within_14_days, 5);

const partial = report([selection, ...Array.from({ length: 9 }, (_, index) => trial(index))]);
assert.equal(partial.milestone_ready, false);
assert.equal(partial.gates.ten_independent_users, false);

assert.throws(() => report([selection, trial(0), trial(0)]), /participant_id values must be unique/);
assert.equal(report([{ ...selection, selected_at: '2026-07-13T00:00:00.000Z' }, trial(0)]).gates.external_selection, false);
assert.throws(() => validateTrial({ ...trial(0), prompt: 'secret task text' }), /fields must be exact/);
assert.throws(() => validateTrial({ ...trial(0), consent_aggregate: false }), /consent/);
assert.throws(() => validateTrial({ ...trial(0), second_task_at: '2026-07-12T12:01:00.000Z' }), /at least 24 hours/);
assert.throws(() => validateTrial({ ...trial(0), second_task_at: '2026-08-01T00:00:00.000Z' }), /within 14 days/);

const jsonl = [selection, trial(0)].map(record => JSON.stringify(record)).join('\n');
assert.equal(parseJsonl(jsonl).length, 2);
assert.throws(() => parseJsonl('{bad'), /invalid JSON/);

console.log('Product-proof cohort tests passed.');

#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const EVIDENCE_URL = /^https:\/\/github\.com\/SethGammon\/Citadel\/discussions\/\d+#discussioncomment-\d+$/;
const OPAQUE_ID = /^(participant|reviewer)-[a-f0-9]{8,64}$/;
const TRIAL_FIELDS = [
  'schema', 'kind', 'participant_id', 'evidence_url', 'started_at',
  'first_route_ms', 'handoff_ms', 'dashboard_explanation_ms',
  'dashboard_fields_correct', 'install_success', 'setup_success',
  'routed_task_success', 'handoff_verified', 'consent_aggregate', 'second_task_at',
];
const SELECTION_FIELDS = [
  'schema', 'kind', 'reviewer_id', 'evidence_url', 'selected_at',
  'scenario_id', 'runner_commit',
];

function exactFields(record, allowed, label) {
  const actual = Object.keys(record).sort();
  const expected = [...allowed].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields must be exact; prompts, paths, repository names, and personal data are prohibited`);
  }
}

function iso(value, label) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return parsed;
}

function boundedNumber(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function validateEvidence(record, label) {
  if (!EVIDENCE_URL.test(record.evidence_url)) {
    throw new Error(`${label}.evidence_url must be a Citadel GitHub Discussion comment URL`);
  }
}

function validateSelection(record) {
  exactFields(record, SELECTION_FIELDS, 'benchmark selection');
  if (record.schema !== 1 || record.kind !== 'benchmark_selection') throw new Error('benchmark selection schema/kind is invalid');
  if (!OPAQUE_ID.test(record.reviewer_id) || !record.reviewer_id.startsWith('reviewer-')) throw new Error('reviewer_id must be opaque');
  validateEvidence(record, 'benchmark selection');
  iso(record.selected_at, 'selected_at');
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(record.scenario_id)) throw new Error('scenario_id is invalid');
  if (!/^[a-f0-9]{40}$/.test(record.runner_commit)) throw new Error('runner_commit must be a full git SHA');
  return record;
}

function validateTrial(record) {
  exactFields(record, TRIAL_FIELDS, 'participant trial');
  if (record.schema !== 1 || record.kind !== 'participant_trial') throw new Error('participant trial schema/kind is invalid');
  if (!OPAQUE_ID.test(record.participant_id) || !record.participant_id.startsWith('participant-')) throw new Error('participant_id must be opaque');
  validateEvidence(record, 'participant trial');
  const started = iso(record.started_at, 'started_at');
  boundedNumber(record.first_route_ms, 'first_route_ms', 0, 24 * 60 * 60 * 1000);
  boundedNumber(record.handoff_ms, 'handoff_ms', 0, 24 * 60 * 60 * 1000);
  boundedNumber(record.dashboard_explanation_ms, 'dashboard_explanation_ms', 0, 10 * 60 * 1000);
  boundedNumber(record.dashboard_fields_correct, 'dashboard_fields_correct', 0, 4);
  if (!Number.isInteger(record.dashboard_fields_correct)) throw new Error('dashboard_fields_correct must be an integer');
  for (const field of ['install_success', 'setup_success', 'routed_task_success', 'handoff_verified', 'consent_aggregate']) {
    if (typeof record[field] !== 'boolean') throw new Error(`${field} must be boolean`);
  }
  if (!record.consent_aggregate) throw new Error('participant must consent to aggregate use');
  if (record.second_task_at !== null) {
    const second = iso(record.second_task_at, 'second_task_at');
    const elapsed = second.getTime() - started.getTime();
    if (elapsed < 24 * 60 * 60 * 1000 || elapsed > 14 * 24 * 60 * 60 * 1000) {
      throw new Error('second_task_at must be at least 24 hours after the trial and within 14 days');
    }
  }
  return record;
}

function parseJsonl(raw) {
  const records = String(raw).split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`line ${index + 1} is invalid JSON`); }
  });
  return records.map(record => record.kind === 'benchmark_selection' ? validateSelection(record) : validateTrial(record));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function report(records) {
  const selections = records.filter(record => record.kind === 'benchmark_selection');
  const trials = records.filter(record => record.kind === 'participant_trial');
  const uniqueParticipants = new Set(trials.map(record => record.participant_id));
  const evidenceUrls = records.map(record => record.evidence_url);
  if (uniqueParticipants.size !== trials.length) throw new Error('participant_id values must be unique');
  if (new Set(evidenceUrls).size !== evidenceUrls.length) throw new Error('evidence_url values must be unique');
  if (selections.length > 1) throw new Error('exactly zero or one benchmark selection is allowed');
  const selectedBeforeTrials = selections.length === 1 && trials.every(trial => (
    new Date(selections[0].selected_at).getTime() <= new Date(trial.started_at).getTime()
  ));
  const completed = trials.filter(trial => trial.install_success && trial.setup_success && trial.routed_task_success && trial.handoff_verified);
  const dashboardPasses = trials.filter(trial => trial.dashboard_explanation_ms <= 60000 && trial.dashboard_fields_correct === 4).length;
  const returnUsers = trials.filter(trial => trial.second_task_at !== null).length;
  const result = {
    schema: 1,
    benchmark_selection: { present: selections.length === 1, selected_before_trials: selectedBeforeTrials, scenario_id: selections[0]?.scenario_id || null },
    cohort: {
      participants: trials.length,
      completed: completed.length,
      completion_rate: trials.length ? completed.length / trials.length : 0,
      median_first_route_ms: percentile(trials.map(trial => trial.first_route_ms), 50),
      p90_handoff_ms: percentile(trials.map(trial => trial.handoff_ms), 90),
      dashboard_passes: dashboardPasses,
      return_users_within_14_days: returnUsers,
    },
  };
  result.gates = {
    external_selection: selectedBeforeTrials,
    ten_independent_users: trials.length >= 10,
    completion_rate: trials.length >= 10 && result.cohort.completion_rate >= 0.95,
    median_first_route: result.cohort.median_first_route_ms !== null && result.cohort.median_first_route_ms < 600000,
    p90_verified_handoff: result.cohort.p90_handoff_ms !== null && result.cohort.p90_handoff_ms < 900000,
    dashboard_comprehension: trials.length >= 10 && dashboardPasses >= 8,
    retention: returnUsers >= 5,
  };
  result.milestone_ready = Object.values(result.gates).every(Boolean);
  return result;
}

function parseArgs(argv) {
  const options = { json: false, requireComplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--json') options.json = true;
    else if (arg === '--require-complete') options.requireComplete = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/product-proof-cohort.js --input <records.jsonl> [--json] [--require-complete]');
    return null;
  }
  if (!options.input) throw new Error('--input is required');
  const records = parseJsonl(fs.readFileSync(path.resolve(options.input), 'utf8'));
  const result = report(records);
  console.log(JSON.stringify(result, null, options.json ? 2 : 2));
  if (options.requireComplete && !result.milestone_ready) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`Product-proof cohort failed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { parseJsonl, report, validateSelection, validateTrial };

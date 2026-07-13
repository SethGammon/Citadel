'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const activation = require('./activation');

const SCHEMA = 1;
const DISCUSSION_URL = 'https://github.com/SethGammon/Citadel/discussions/182';
const SUBMISSION_FIELDS = [
  'schema', 'kind', 'submission_id', 'consent_aggregate', 'observation_day',
  'citadel_version', 'journey',
];
const JOURNEY_FIELDS = [
  'event_count', 'install_attempted', 'install_completed', 'setup_completed',
  'route_completed', 'verified_handoff', 'resume_completed', 'return_session',
  'install_failed', 'route_failed',
];
const ENVELOPE_FIELDS = ['schema', 'kind', 'evidence_url', 'captured_at', 'submission'];
const TARGETS = Object.freeze({
  shared_installations: 25,
  setup_rate: 0.60,
  verified_handoff_rate: 0.40,
  resume_rate: 0.25,
  seven_day_return_rate: 0.15,
  install_or_route_failure_rate_max: 0.10,
});
const EVIDENCE_URL = /^https:\/\/github\.com\/SethGammon\/Citadel\/discussions\/\d+#discussioncomment-\d+$/;

function exactFields(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
    throw new Error(`${label} fields must be exact; prompts, paths, repository names, and personal data are prohibited`);
  }
}

function sharePaths(root = process.cwd()) {
  const dir = path.join(root, '.planning', 'product-proof');
  return {
    dir,
    identity: path.join(dir, 'activation-share-identity.json'),
    bundle: path.join(dir, 'activation-share.json'),
    cohort: path.join(dir, 'activation-cohort.jsonl'),
    report: path.join(dir, 'activation-cohort-report.json'),
  };
}

function readOrCreateShareIdentity(root = process.cwd(), now = new Date()) {
  const file = sharePaths(root).identity;
  if (fs.existsSync(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.schema !== SCHEMA || !/^activation-[a-f0-9]{32}$/.test(value.submission_id)
      || !Number.isFinite(Date.parse(value.created_at))) {
      throw new Error('invalid local activation share identity');
    }
    return value;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const value = {
    schema: SCHEMA,
    submission_id: `activation-${crypto.randomUUID().replace(/-/g, '')}`,
    created_at: now.toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return value;
}

function hasStage(events, stage, status) {
  return events.some((event) => event.stage === stage && event.status === status);
}

function buildSubmission(root = process.cwd(), options = {}) {
  const now = options.now || new Date();
  const read = activation.readEvents(root);
  if (!read.events.length) throw new Error('no activation events are available to share');
  const installation = JSON.parse(fs.readFileSync(activation.pathsFor(root).identity, 'utf8'));
  const events = read.events.filter((event) => event.installation_id === installation.installation_id);
  if (!events.length) throw new Error('activation events do not match the local installation identity');
  const identity = options.shareIdentity || readOrCreateShareIdentity(root, now);
  const age = Math.max(0, Math.floor((now - new Date(installation.created_at)) / 86400000));
  const version = events[events.length - 1].citadel_version;
  return validateSubmission({
    schema: SCHEMA,
    kind: 'activation_cohort_submission',
    submission_id: identity.submission_id,
    consent_aggregate: true,
    observation_day: Math.min(age, 3650),
    citadel_version: version,
    journey: {
      event_count: events.length,
      install_attempted: hasStage(events, 'install_started', 'started') || hasStage(events, 'install_completed', 'succeeded'),
      install_completed: hasStage(events, 'install_completed', 'succeeded'),
      setup_completed: hasStage(events, 'setup_completed', 'succeeded'),
      route_completed: hasStage(events, 'route_completed', 'succeeded'),
      verified_handoff: hasStage(events, 'verified_handoff', 'succeeded'),
      resume_completed: hasStage(events, 'resume_completed', 'succeeded'),
      return_session: hasStage(events, 'return_session', 'succeeded'),
      install_failed: hasStage(events, 'install_completed', 'failed'),
      route_failed: hasStage(events, 'route_completed', 'failed'),
    },
  });
}

function validateSubmission(value) {
  exactFields(value, SUBMISSION_FIELDS, 'activation cohort submission');
  exactFields(value.journey, JOURNEY_FIELDS, 'activation cohort journey');
  if (value.schema !== SCHEMA || value.kind !== 'activation_cohort_submission') throw new Error('activation cohort submission schema/kind is invalid');
  if (!/^activation-[a-f0-9]{32}$/.test(value.submission_id)) throw new Error('submission_id must be an opaque activation ID');
  if (value.consent_aggregate !== true) throw new Error('consent_aggregate must be true');
  if (!Number.isInteger(value.observation_day) || value.observation_day < 0 || value.observation_day > 3650) throw new Error('observation_day must be an integer from 0 to 3650');
  if (typeof value.citadel_version !== 'string' || !/^[0-9A-Za-z.+-]+$/.test(value.citadel_version)) throw new Error('citadel_version is invalid');
  if (!Number.isInteger(value.journey.event_count) || value.journey.event_count < 1 || value.journey.event_count > 100000) throw new Error('event_count is invalid');
  for (const field of JOURNEY_FIELDS.filter((field) => field !== 'event_count')) {
    if (typeof value.journey[field] !== 'boolean') throw new Error(`${field} must be boolean`);
  }
  if (value.journey.setup_completed && !value.journey.install_completed) throw new Error('setup completion requires install completion');
  if (value.journey.verified_handoff && !value.journey.route_completed) throw new Error('verified handoff requires route completion');
  if (value.journey.resume_completed && !value.journey.verified_handoff) throw new Error('resume completion requires verified handoff');
  if (value.journey.return_session && value.observation_day < 1) throw new Error('return session requires at least one observation day');
  return value;
}

function validateEnvelope(value) {
  exactFields(value, ENVELOPE_FIELDS, 'activation cohort evidence');
  if (value.schema !== SCHEMA || value.kind !== 'activation_cohort_evidence') throw new Error('activation cohort evidence schema/kind is invalid');
  if (!EVIDENCE_URL.test(value.evidence_url)) throw new Error('evidence_url must be a Citadel GitHub Discussion comment URL');
  if (typeof value.captured_at !== 'string' || new Date(value.captured_at).toISOString() !== value.captured_at) throw new Error('captured_at must be an ISO timestamp');
  validateSubmission(value.submission);
  return value;
}

function parseJsonl(raw) {
  return String(raw).split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try { return validateEnvelope(JSON.parse(line)); }
    catch (error) { throw new Error(`line ${index + 1}: ${error.message}`); }
  });
}

function latestSubmissions(envelopes) {
  const latest = new Map();
  for (const envelope of envelopes.map(validateEnvelope)) {
    const id = envelope.submission.submission_id;
    const previous = latest.get(id);
    if (!previous || envelope.submission.observation_day > previous.submission.observation_day
      || (envelope.submission.observation_day === previous.submission.observation_day && envelope.captured_at > previous.captured_at)) {
      latest.set(id, envelope);
    }
  }
  return [...latest.values()];
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function gate(value, target, direction = 'min', eligible = true) {
  if (!eligible || value === null) return { state: 'waiting', value, target, direction };
  const passed = direction === 'max' ? value <= target : value >= target;
  return { state: passed ? 'passed' : 'failed', value, target, direction };
}

function cohortReport(envelopes) {
  const current = latestSubmissions(envelopes);
  const journeys = current.map((item) => item.submission);
  const installed = journeys.filter((item) => item.journey.install_completed);
  const attempted = journeys.filter((item) => item.journey.install_attempted);
  const eligible = installed.filter((item) => item.observation_day >= 7);
  const count = (items, field) => items.filter((item) => item.journey[field]).length;
  const setupRate = rate(count(installed, 'setup_completed'), installed.length);
  const handoffRate = rate(count(installed, 'verified_handoff'), installed.length);
  const resumeRate = rate(count(installed, 'resume_completed'), installed.length);
  const returnRate = rate(count(eligible, 'return_session'), eligible.length);
  const failedAttempts = attempted.filter((item) => item.journey.install_failed || item.journey.route_failed).length;
  const failureRate = rate(failedAttempts, attempted.length);
  const enoughShared = current.length >= TARGETS.shared_installations;
  const enoughMature = eligible.length >= TARGETS.shared_installations;
  const gates = {
    shared_installations: {
      state: enoughShared ? 'passed' : 'collecting',
      value: current.length,
      target: TARGETS.shared_installations,
      direction: 'min',
    },
    setup_rate: gate(setupRate, TARGETS.setup_rate, 'min', enoughShared),
    verified_handoff_rate: gate(handoffRate, TARGETS.verified_handoff_rate, 'min', enoughShared),
    resume_rate: gate(resumeRate, TARGETS.resume_rate, 'min', enoughShared),
    seven_day_return_rate: gate(returnRate, TARGETS.seven_day_return_rate, 'min', enoughMature),
    install_or_route_failure_rate: gate(failureRate, TARGETS.install_or_route_failure_rate_max, 'max', enoughShared),
  };
  gates.seven_day_return_rate.eligible_count = eligible.length;
  gates.seven_day_return_rate.required_eligible = TARGETS.shared_installations;
  const states = Object.values(gates).map((item) => item.state);
  const milestoneStatus = states.every((state) => state === 'passed') ? 'ready'
    : states.includes('failed') ? 'needs_attention'
      : enoughShared ? 'observing' : 'collecting';
  return {
    schema: SCHEMA,
    kind: 'activation_cohort_report',
    privacy: 'opt-in aggregate; public GitHub account remains visible on Discussion comments',
    milestone_status: milestoneStatus,
    cohort: {
      shared_installations: current.length,
      successful_installs: installed.length,
      attempted_installs: attempted.length,
      seven_day_eligible: eligible.length,
      setup_rate: setupRate,
      verified_handoff_rate: handoffRate,
      resume_rate: resumeRate,
      seven_day_return_rate: returnRate,
      install_or_route_failure_rate: failureRate,
    },
    targets: TARGETS,
    gates,
    limitations: [
      'This is a voluntary shared cohort, not every clone or installation.',
      'Install failures that cannot run the share command are underrepresented.',
      'Seven-day return uses only installations observed for at least seven days.',
    ],
  };
}

function upsertEvidence(file, submission, evidenceUrl, now = new Date()) {
  validateSubmission(submission);
  if (!EVIDENCE_URL.test(evidenceUrl)) throw new Error('evidence URL must be a Citadel GitHub Discussion comment URL');
  const existing = fs.existsSync(file) ? parseJsonl(fs.readFileSync(file, 'utf8')) : [];
  const envelope = validateEnvelope({
    schema: SCHEMA,
    kind: 'activation_cohort_evidence',
    evidence_url: evidenceUrl,
    captured_at: now.toISOString(),
    submission,
  });
  const withoutSameEvidence = existing.filter((item) => item.evidence_url !== evidenceUrl);
  const all = [...withoutSameEvidence, envelope];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, all.map((item) => JSON.stringify(item)).join('\n') + '\n');
  return { envelope, report: cohortReport(all), records: all.length };
}

module.exports = {
  SCHEMA, DISCUSSION_URL, TARGETS, SUBMISSION_FIELDS, JOURNEY_FIELDS, ENVELOPE_FIELDS,
  sharePaths, readOrCreateShareIdentity, buildSubmission, validateSubmission,
  validateEnvelope, parseJsonl, latestSubmissions, cohortReport, upsertEvidence,
};

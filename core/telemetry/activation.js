'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA = 1;
const STAGES = [
  'install_started', 'install_completed', 'setup_completed', 'route_completed',
  'verified_handoff', 'resume_completed', 'return_session',
];
const STATUSES = ['started', 'succeeded', 'failed'];
const FAILURE_CODES = [
  'invalid_config', 'permission_denied', 'dependency_missing', 'route_failed',
  'verification_failed', 'interrupted', 'timeout', 'unknown_error',
];
const ACQUISITION_SOURCES = [
  'unknown', 'github_search', 'github_trending', 'github_topic', 'github_social',
  'github_referral', 'direct_link', 'package_registry', 'documentation',
  'word_of_mouth', 'other',
];
const RUNTIMES = ['claude-code', 'codex', 'unknown', 'other'];
const OS_FAMILIES = ['windows', 'macos', 'linux', 'other'];
const EVENT_FIELDS = [
  'schema', 'timestamp', 'installation_id', 'citadel_version', 'runtime', 'os_family',
  'stage', 'status', 'duration_ms', 'failure_code', 'day_since_install',
  'acquisition_source',
];
// Schema 0 was the same event in camelCase. It is accepted only while reading.
const LEGACY_FIELDS = [
  'schema', 'timestamp', 'installationId', 'citadelVersion', 'runtime', 'osFamily',
  'stage', 'status', 'durationMs', 'failureCode', 'daySinceInstall',
  'acquisitionSource',
];
const INPUT_FIELDS = [
  'runtime', 'stage', 'status', 'duration_ms', 'failure_code', 'acquisition_source',
];
const PROHIBITED_FIELD = /(prompt|repo(?:sitory)?(?:_?name)?|(?:file_?)?path|command|body|source_?code|user(?:_?identity)?|token|secret)/i;

function pathsFor(root = process.cwd()) {
  const dir = path.join(root, '.planning', 'telemetry');
  return {
    dir,
    events: path.join(dir, 'activation.jsonl'),
    identity: path.join(dir, 'activation-installation.json'),
    optOut: path.join(dir, 'activation-disabled'),
  };
}

function osFamily(platform = process.platform) {
  return ({ win32: 'windows', darwin: 'macos', linux: 'linux' })[platform] || 'other';
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (PROHIBITED_FIELD.test(key)) throw new Error(`${label} contains prohibited field: ${key}`);
    if (!allowed.includes(key)) throw new Error(`${label} contains unknown field: ${key}`);
  }
}

function validateEvent(event) {
  const errors = [];
  try {
    assertObject(event, 'event');
    assertFields(event, EVENT_FIELDS, 'event');
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
  for (const field of EVENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(event, field)) errors.push(`missing field: ${field}`);
  }
  if (event.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp))) errors.push('timestamp must be ISO 8601');
  if (typeof event.installation_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(event.installation_id)) errors.push('installation_id must be a UUID');
  if (typeof event.citadel_version !== 'string' || !/^[0-9A-Za-z.+-]+$/.test(event.citadel_version)) errors.push('citadel_version is invalid');
  if (!RUNTIMES.includes(event.runtime)) errors.push(`runtime must be one of: ${RUNTIMES.join(', ')}`);
  if (!OS_FAMILIES.includes(event.os_family)) errors.push(`os_family must be one of: ${OS_FAMILIES.join(', ')}`);
  if (!STAGES.includes(event.stage)) errors.push(`stage must be one of: ${STAGES.join(', ')}`);
  if (!STATUSES.includes(event.status)) errors.push(`status must be one of: ${STATUSES.join(', ')}`);
  if (event.duration_ms !== null && (!Number.isInteger(event.duration_ms) || event.duration_ms < 0)) errors.push('duration_ms must be a non-negative integer or null');
  if (!Number.isInteger(event.day_since_install) || event.day_since_install < 0) errors.push('day_since_install must be a non-negative integer');
  if (!ACQUISITION_SOURCES.includes(event.acquisition_source)) errors.push(`acquisition_source must be one of: ${ACQUISITION_SOURCES.join(', ')}`);
  if (event.status === 'failed' && !FAILURE_CODES.includes(event.failure_code)) errors.push(`failed events require failure_code: ${FAILURE_CODES.join(', ')}`);
  if (event.status !== 'failed' && event.failure_code !== null) errors.push('failure_code must be null unless status is failed');
  return { valid: errors.length === 0, errors };
}

function validateOrThrow(event) {
  const result = validateEvent(event);
  if (!result.valid) throw new Error(result.errors.join('; '));
  return event;
}

function readVersion(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
}

function isEnabled(root = process.cwd(), env = process.env) {
  return env.CITADEL_ACTIVATION_TELEMETRY !== '0' && !fs.existsSync(pathsFor(root).optOut);
}

function readOrCreateIdentity(root, now = new Date()) {
  const files = pathsFor(root);
  if (fs.existsSync(files.identity)) {
    const value = JSON.parse(fs.readFileSync(files.identity, 'utf8'));
    if (value.schema !== 1 || !/^[0-9a-f-]{36}$/i.test(value.installation_id) || !Number.isFinite(Date.parse(value.created_at))) {
      throw new Error('invalid local activation installation identity');
    }
    return value;
  }
  fs.mkdirSync(files.dir, { recursive: true });
  const value = { schema: 1, installation_id: crypto.randomUUID(), created_at: now.toISOString() };
  fs.writeFileSync(files.identity, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  return value;
}

function createEvent(input, options = {}) {
  assertObject(input, 'input');
  assertFields(input, INPUT_FIELDS, 'input');
  const root = options.root || process.cwd();
  const now = options.now || new Date();
  const identity = options.identity || readOrCreateIdentity(root, now);
  const event = {
    schema: SCHEMA,
    timestamp: now.toISOString(),
    installation_id: identity.installation_id,
    citadel_version: options.version || readVersion(root),
    runtime: input.runtime || 'unknown',
    os_family: options.os_family || osFamily(),
    stage: input.stage,
    status: input.status,
    duration_ms: input.duration_ms === undefined ? null : input.duration_ms,
    failure_code: input.failure_code === undefined ? (input.status === 'failed' ? 'unknown_error' : null) : input.failure_code,
    day_since_install: Math.max(0, Math.floor((now - new Date(identity.created_at)) / 86400000)),
    acquisition_source: input.acquisition_source || 'unknown',
  };
  return validateOrThrow(event);
}

function record(input, options = {}) {
  const root = options.root || process.cwd();
  if (!isEnabled(root, options.env || process.env)) return { recorded: false, reason: 'opted_out' };
  const event = createEvent(input, options);
  const file = pathsFor(root).events;
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
  return { recorded: true, file, event };
}

function recordOnce(input, options = {}) {
  const root = options.root || process.cwd();
  if (!isEnabled(root, options.env || process.env)) return { recorded: false, reason: 'opted_out' };
  const now = options.now || new Date();
  const identity = options.identity || readOrCreateIdentity(root, now);
  const duplicate = readEvents(root).events.some((event) => (
    event.installation_id === identity.installation_id
    && event.stage === input.stage
    && event.status === input.status
  ));
  if (duplicate) return { recorded: false, reason: 'already_recorded' };

  const event = createEvent(input, { ...options, root, now, identity });
  const minimumDay = options.minimum_day_since_install || 0;
  if (event.day_since_install < minimumDay) {
    return { recorded: false, reason: 'too_early', day_since_install: event.day_since_install };
  }
  const file = pathsFor(root).events;
  fs.mkdirSync(pathsFor(root).dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
  return { recorded: true, file, event };
}

function migrateLegacy(event) {
  assertObject(event, 'legacy event');
  assertFields(event, LEGACY_FIELDS, 'legacy event');
  if (event.schema !== 0) throw new Error('legacy schema must be 0');
  return validateOrThrow({
    schema: 1, timestamp: event.timestamp, installation_id: event.installationId,
    citadel_version: event.citadelVersion, runtime: event.runtime, os_family: event.osFamily,
    stage: event.stage, status: event.status,
    duration_ms: event.durationMs === undefined ? null : event.durationMs,
    failure_code: event.failureCode === undefined ? null : event.failureCode,
    day_since_install: event.daySinceInstall,
    acquisition_source: event.acquisitionSource || 'unknown',
  });
}

function readEvents(root = process.cwd()) {
  const file = pathsFor(root).events;
  if (!fs.existsSync(file)) return { events: [], invalid_count: 0, migrated_count: 0 };
  const events = [];
  let invalid_count = 0;
  let migrated_count = 0;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
    try {
      const raw = JSON.parse(line);
      const event = raw.schema === 0 ? migrateLegacy(raw) : validateOrThrow(raw);
      if (raw.schema === 0) migrated_count++;
      events.push(event);
    } catch { invalid_count++; }
  }
  return { events, invalid_count, migrated_count };
}

function increment(map, key) { map[key] = (map[key] || 0) + 1; }

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function successfulInstallationsByStage(events) {
  const byStage = Object.fromEntries(STAGES.map((stage) => [stage, new Set()]));
  for (const event of events) {
    if (event.status === 'succeeded') byStage[event.stage].add(event.installation_id);
  }
  return Object.fromEntries(STAGES.map((stage) => [stage, byStage[stage].size]));
}

function metric(numerator, denominator) {
  return { numerator, denominator, rate: rate(numerator, denominator) };
}

function report(root = process.cwd()) {
  const read = readEvents(root);
  const stages = {}, statuses = {}, failures = {}, sources = {};
  const installations = new Set();
  for (const event of read.events) {
    installations.add(event.installation_id);
    increment(stages, event.stage); increment(statuses, event.status);
    increment(sources, event.acquisition_source);
    if (event.failure_code) increment(failures, event.failure_code);
  }
  const successful = successfulInstallationsByStage(read.events);
  const completedInstalls = successful.install_completed;
  const stageRate = (stage) => ({
    successful_installations: successful[stage],
    rate_from_install: rate(successful[stage], completedInstalls),
  });
  return {
    schema: 1, redacted: true, transmitted: false, total_events: read.events.length,
    unique_installations: installations.size, invalid_events: read.invalid_count,
    migrated_events: read.migrated_count, by_stage: stages, by_status: statuses,
    by_failure_code: failures, by_acquisition_source: sources,
    activation_funnel: {
      successful_installs: completedInstalls,
      setup_completed: stageRate('setup_completed'),
      route_completed: stageRate('route_completed'),
      verified_handoff: stageRate('verified_handoff'),
      resume_completed: stageRate('resume_completed'),
      return_session: stageRate('return_session'),
    },
    decision_metrics: {
      verified_activation_rate: metric(successful.verified_handoff, completedInstalls),
      durable_resume_rate: metric(successful.resume_completed, completedInstalls),
      return_use_rate: metric(successful.return_session, completedInstalls),
    },
    guardrails: {
      failed_events: statuses.failed || 0,
      failure_event_rate: rate(statuses.failed || 0, read.events.length),
      invalid_events: read.invalid_count,
    },
  };
}

function setOptOut(root = process.cwd(), disabled = true) {
  const files = pathsFor(root);
  if (disabled) {
    fs.mkdirSync(files.dir, { recursive: true });
    fs.writeFileSync(files.optOut, 'Activation telemetry disabled locally.\n');
  } else if (fs.existsSync(files.optOut)) fs.unlinkSync(files.optOut);
  return !isEnabled(root);
}

module.exports = {
  SCHEMA, STAGES, STATUSES, FAILURE_CODES, ACQUISITION_SOURCES, RUNTIMES,
  OS_FAMILIES, EVENT_FIELDS, LEGACY_FIELDS, pathsFor, osFamily, validateEvent,
  createEvent, record, recordOnce, migrateLegacy, readEvents, rate,
  successfulInstallationsByStage, report, isEnabled, setOptOut,
};

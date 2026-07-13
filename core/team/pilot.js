'use strict';

const { sha256Digest } = require('../operations');

const EVENT_TYPES = Object.freeze([
  'campaign_started', 'campaign_resumed', 'discovery_shared', 'discovery_lost',
  'agent_reassigned', 'merge_attempted', 'merge_conflict', 'approval_delivered',
]);

function validateEvent(event) {
  const fields = ['event_id', 'type', 'operator_id', 'repository_id', 'recorded_at', 'duration_ms'];
  if (!event || typeof event !== 'object' || Array.isArray(event)) return ['event must be an object'];
  const errors = [];
  const unknown = Object.keys(event).filter((field) => !fields.includes(field));
  if (unknown.length) errors.push(`unknown event fields: ${unknown.join(', ')}`);
  if (typeof event.event_id !== 'string' || !/^[a-z][a-z0-9-]+$/.test(event.event_id)) errors.push('event_id is invalid');
  if (!EVENT_TYPES.includes(event.type)) errors.push('type is invalid');
  for (const field of ['operator_id', 'repository_id']) if (typeof event[field] !== 'string' || !event[field]) errors.push(`${field} is required`);
  if (typeof event.recorded_at !== 'string' || !Number.isFinite(Date.parse(event.recorded_at))) errors.push('recorded_at is invalid');
  if (event.duration_ms !== null && (!Number.isInteger(event.duration_ms) || event.duration_ms < 0)) errors.push('duration_ms is invalid');
  return errors;
}

function pilotReport(events, options = {}) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const seen = new Set();
  for (const event of events) {
    const errors = validateEvent(event);
    if (errors.length) throw new TypeError(`Invalid pilot event: ${errors.join('; ')}`);
    if (seen.has(event.event_id)) throw new Error(`duplicate event_id: ${event.event_id}`);
    seen.add(event.event_id);
  }
  const count = (type) => events.filter((event) => event.type === type).length;
  const durations = events.filter((event) => event.type === 'agent_reassigned' && event.duration_ms !== null)
    .map((event) => event.duration_ms).sort((a, b) => a - b);
  const shared = count('discovery_shared');
  const merges = count('merge_attempted');
  const operators = new Set(events.map((event) => event.operator_id)).size;
  const repositories = new Set(events.map((event) => event.repository_id)).size;
  const report = {
    schema_version: 1,
    evidence_class: options.evidenceClass || 'simulation',
    operators,
    repositories,
    event_count: events.length,
    discovery_loss_bps: shared ? Math.round((count('discovery_lost') / shared) * 10000) : null,
    merge_conflict_bps: merges ? Math.round((count('merge_conflict') / merges) * 10000) : null,
    median_reassignment_ms: durations.length ? durations[Math.floor(durations.length / 2)] : null,
    campaign_resume_count: count('campaign_resumed'),
    approval_delivery_count: count('approval_delivered'),
  };
  return Object.freeze({ ...report, report_digest: sha256Digest(report) });
}

function simulatedPilot() {
  const types = ['campaign_started', 'campaign_resumed', 'discovery_shared', 'agent_reassigned',
    'merge_attempted', 'approval_delivered'];
  const events = [];
  for (let repository = 1; repository <= 10; repository += 1) {
    for (let index = 0; index < types.length; index += 1) events.push({
      event_id: `event-r${repository}-${index + 1}`,
      type: types[index],
      operator_id: `operator-${((repository + index) % 5) + 1}`,
      repository_id: `repository-${repository}`,
      recorded_at: `2026-07-13T${String(10 + (repository % 10)).padStart(2, '0')}:${String(index).padStart(2, '0')}:00.000Z`,
      duration_ms: types[index] === 'agent_reassigned' ? 1000 + repository * 10 : null,
    });
  }
  return Object.freeze({ events: Object.freeze(events), report: pilotReport(events, { evidenceClass: 'simulation' }) });
}

module.exports = Object.freeze({ EVENT_TYPES, pilotReport, simulatedPilot, validateEvent });

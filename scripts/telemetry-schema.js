#!/usr/bin/env node

/**
 * telemetry-schema.js — Canonical schema definitions for all telemetry writers.
 *
 * Defines the shape of every JSONL event written by the harness.
 * Import this in any script that reads or writes telemetry to ensure
 * consistent structure across all writers.
 */

'use strict';

// ── Schema version ────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

// ── Agent run events (agent-runs.jsonl) ───────────────────────────────────────

/** Valid event type strings for agent-runs.jsonl. */
const AGENT_RUN_EVENT_TYPES = [
  'agent-start',
  'agent-complete',
  'agent-fail',
  'campaign-start',
  'campaign-complete',
  'wave-start',
  'wave-complete',
  'agent-timeout',
];

const AGENT_RUN_STATUS_VALUES = ['success', 'partial', 'failed'];

/**
 * Validate an agent-run event entry.
 * @param {object} entry
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAgentRunEvent(entry) {
  const errors = [];

  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: ['entry must be an object'] };
  }

  if (typeof entry.timestamp !== 'string' || !entry.timestamp) {
    errors.push('timestamp must be a non-empty string (ISO 8601)');
  }

  if (!AGENT_RUN_EVENT_TYPES.includes(entry.event)) {
    errors.push(`event must be one of: ${AGENT_RUN_EVENT_TYPES.join(', ')} — got: ${entry.event}`);
  }

  if (typeof entry.agent !== 'string' || !entry.agent) {
    errors.push('agent must be a non-empty string');
  }

  if (entry.session !== null && entry.session !== undefined && typeof entry.session !== 'string') {
    errors.push('session must be a string or null');
  }

  if (entry.campaign_slug !== null && entry.campaign_slug !== undefined && typeof entry.campaign_slug !== 'string') {
    errors.push('campaign_slug must be a string or null');
  }

  if (entry.duration_ms !== null && entry.duration_ms !== undefined && typeof entry.duration_ms !== 'number') {
    errors.push('duration_ms must be a number or null');
  }

  if (
    entry.status !== null &&
    entry.status !== undefined &&
    !AGENT_RUN_STATUS_VALUES.includes(entry.status)
  ) {
    errors.push(`status must be one of: ${AGENT_RUN_STATUS_VALUES.join(', ')} or null — got: ${entry.status}`);
  }

  if (entry.meta !== null && entry.meta !== undefined && typeof entry.meta !== 'object') {
    errors.push('meta must be an object or null');
  }

  return { valid: errors.length === 0, errors };
}

// ── Hook timing events (hook-timing.jsonl) ────────────────────────────────────

const HOOK_TIMING_EVENT_TYPES = ['timing', 'counter'];

/**
 * Validate a hook-timing event entry.
 * @param {object} entry
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateHookTimingEvent(entry) {
  const errors = [];

  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: ['entry must be an object'] };
  }

  if (typeof entry.timestamp !== 'string' || !entry.timestamp) {
    errors.push('timestamp must be a non-empty string (ISO 8601)');
  }

  if (typeof entry.hook !== 'string' || !entry.hook) {
    errors.push('hook must be a non-empty string');
  }

  // event field is optional — existing writers don't include it
  if (entry.event !== undefined && !HOOK_TIMING_EVENT_TYPES.includes(entry.event)) {
    errors.push(`event must be one of: ${HOOK_TIMING_EVENT_TYPES.join(', ')} — got: ${entry.event}`);
  }

  if (
    entry.metric !== null &&
    entry.metric !== undefined &&
    typeof entry.metric !== 'string'
  ) {
    errors.push('metric must be a string or null');
  }

  if (
    entry.duration_ms !== null &&
    entry.duration_ms !== undefined &&
    typeof entry.duration_ms !== 'number'
  ) {
    errors.push('duration_ms must be a number or null');
  }

  return { valid: errors.length === 0, errors };
}

// ── Session cost events (session-costs.jsonl) ────────────────────────────────

/**
 * Validate a session-cost event entry.
 * Written by session-end hook to track per-session cost data.
 * @param {object} entry
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSessionCostEvent(entry) {
  const errors = [];

  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: ['entry must be an object'] };
  }

  if (typeof entry.timestamp !== 'string' || !entry.timestamp) {
    errors.push('timestamp must be a non-empty string (ISO 8601)');
  }

  if (typeof entry.agent_count !== 'number' || entry.agent_count < 0) {
    errors.push('agent_count must be a non-negative number');
  }

  if (typeof entry.duration_minutes !== 'number' || entry.duration_minutes < 0) {
    errors.push('duration_minutes must be a non-negative number');
  }

  if (typeof entry.estimated_cost !== 'number' || entry.estimated_cost < 0) {
    errors.push('estimated_cost must be a non-negative number');
  }

  // Optional fields
  if (entry.campaign_slug !== null && entry.campaign_slug !== undefined && typeof entry.campaign_slug !== 'string') {
    errors.push('campaign_slug must be a string or null');
  }

  if (entry.session_id !== null && entry.session_id !== undefined && typeof entry.session_id !== 'string') {
    errors.push('session_id must be a string or null');
  }

  if (entry.override_cost !== null && entry.override_cost !== undefined && typeof entry.override_cost !== 'number') {
    errors.push('override_cost must be a number or null');
  }

  return { valid: errors.length === 0, errors };
}

// ── Trust object (harness.json trust counters) ──────────────────────────────

const TRUST_OVERRIDE_VALUES = ['novice', 'familiar', 'trusted'];

/**
 * Validate a trust object from harness.json config.
 * @param {object} trust
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateTrustObject(trust) {
  const errors = [];

  if (!trust || typeof trust !== 'object') {
    return { valid: false, errors: ['trust must be an object'] };
  }

  const nonNegativeFields = [
    'sessions_completed',
    'campaigns_completed',
    'campaigns_reverted',
    'fleet_clean_merges',
    'improve_loops_accepted',
    'daemon_runs',
  ];

  for (const field of nonNegativeFields) {
    if (typeof trust[field] !== 'number' || trust[field] < 0) {
      errors.push(`${field} must be a non-negative number`);
    }
  }

  if (trust.override !== null && trust.override !== undefined && !TRUST_OVERRIDE_VALUES.includes(trust.override)) {
    errors.push(`override must be null or one of: ${TRUST_OVERRIDE_VALUES.join(', ')} -- got: ${trust.override}`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  SCHEMA_VERSION,
  AGENT_RUN_EVENT_TYPES,
  TRUST_OVERRIDE_VALUES,
  validateAgentRunEvent,
  validateHookTimingEvent,
  validateSessionCostEvent,
  validateTrustObject,
};

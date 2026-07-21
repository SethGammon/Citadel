'use strict';

const {
  COMMAND_METHODS, FORBIDDEN_PAYLOAD_KEYS, MAX_SUPERVISOR_PAYLOAD_BYTES,
  MAX_SUPERVISOR_PAYLOAD_DEPTH, QUERY_METHODS, REQUEST_KINDS,
  SUPPORTED_SUPERVISOR_API_VERSIONS,
} = require('./constants');

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/;
const TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value, expected, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be a plain object`);
    return;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const extras = actual.filter((key) => !wanted.includes(key));
  const missing = wanted.filter((key) => !actual.includes(key));
  if (extras.length) errors.push(`${label} has unknown fields: ${extras.join(', ')}`);
  if (missing.length) errors.push(`${label} is missing fields: ${missing.join(', ')}`);
}

function validateTimestamp(value, field, errors) {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    errors.push(`${field} must be an ISO-8601 timestamp`);
  }
}

function validateId(value, field, errors) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    errors.push(`${field} must be a stable lowercase identifier`);
  }
}

function validateJsonValue(value, field, errors, depth = 0, seen = new Set()) {
  if (depth > MAX_SUPERVISOR_PAYLOAD_DEPTH) {
    errors.push(`${field} exceeds maximum nesting depth`);
    return;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${field} must contain finite numbers`);
    return;
  }
  if (typeof value !== 'object') {
    errors.push(`${field} must contain plain JSON values`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${field} must not contain cycles`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${field}[${index}]`, errors, depth + 1, seen));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) {
        errors.push(`${field}.${key} is a forbidden private or native field`);
      }
      validateJsonValue(item, `${field}.${key}`, errors, depth + 1, seen);
    }
  } else {
    errors.push(`${field} must contain only arrays and plain objects`);
  }
  seen.delete(value);
}

function validatePayload(payload, field, errors) {
  if (!isPlainObject(payload)) {
    errors.push(`${field} must be a plain object`);
    return;
  }
  validateJsonValue(payload, field, errors);
  try {
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_SUPERVISOR_PAYLOAD_BYTES) {
      errors.push(`${field} exceeds ${MAX_SUPERVISOR_PAYLOAD_BYTES} bytes`);
    }
  } catch {
    errors.push(`${field} must be serializable JSON`);
  }
}

function result(errors) {
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function validateSupervisorRequest(value) {
  const errors = [];
  if (!isPlainObject(value)) return result(['request must be a plain object']);
  const common = ['apiVersion', 'requestId', 'kind', 'method', 'payload', 'sentAt'];
  const fields = value.kind === REQUEST_KINDS.COMMAND
    ? [...common, 'idempotencyKey', 'expectedRevision']
    : common;
  exactFields(value, fields, 'request', errors);
  if (!SUPPORTED_SUPERVISOR_API_VERSIONS.includes(value.apiVersion)) errors.push('request.apiVersion is unsupported');
  validateId(value.requestId, 'request.requestId', errors);
  validateTimestamp(value.sentAt, 'request.sentAt', errors);
  if (!Object.values(REQUEST_KINDS).includes(value.kind)) errors.push('request.kind is unsupported');
  const methods = value.kind === REQUEST_KINDS.COMMAND ? COMMAND_METHODS : QUERY_METHODS;
  if (!methods.includes(value.method)) errors.push(`request.method is not allowed for ${value.kind || 'unknown'} requests`);
  validatePayload(value.payload, 'request.payload', errors);
  if (value.kind === REQUEST_KINDS.COMMAND) {
    validateId(value.idempotencyKey, 'request.idempotencyKey', errors);
    if (value.expectedRevision !== null
      && (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) {
      errors.push('request.expectedRevision must be null or a non-negative safe integer');
    }
  }
  return result(errors);
}

function validateSupervisorResponse(value) {
  const errors = [];
  if (!isPlainObject(value)) return result(['response must be a plain object']);
  const fields = value.ok
    ? ['apiVersion', 'requestId', 'ok', 'result', 'revision', 'completedAt']
    : ['apiVersion', 'requestId', 'ok', 'error', 'revision', 'completedAt'];
  exactFields(value, fields, 'response', errors);
  if (!SUPPORTED_SUPERVISOR_API_VERSIONS.includes(value.apiVersion)) errors.push('response.apiVersion is unsupported');
  validateId(value.requestId, 'response.requestId', errors);
  validateTimestamp(value.completedAt, 'response.completedAt', errors);
  if (typeof value.ok !== 'boolean') errors.push('response.ok must be boolean');
  if (value.revision !== null && (!Number.isSafeInteger(value.revision) || value.revision < 0)) errors.push('response.revision must be null or a non-negative safe integer');
  if (value.ok) {
    validatePayload(value.result, 'response.result', errors);
  } else {
    exactFields(value.error, ['code', 'message', 'retryable'], 'response.error', errors);
    if (isPlainObject(value.error)) {
      if (typeof value.error.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.error.code)) errors.push('response.error.code is invalid');
      if (typeof value.error.message !== 'string' || !value.error.message) errors.push('response.error.message is required');
      if (typeof value.error.retryable !== 'boolean') errors.push('response.error.retryable must be boolean');
    }
  }
  return result(errors);
}

function validateSupervisorEvent(value) {
  const errors = [];
  if (!isPlainObject(value)) return result(['event must be a plain object']);
  exactFields(value, ['apiVersion', 'sequence', 'eventId', 'type', 'subjectType', 'subjectId', 'revision', 'payload', 'occurredAt'], 'event', errors);
  if (!SUPPORTED_SUPERVISOR_API_VERSIONS.includes(value.apiVersion)) errors.push('event.apiVersion is unsupported');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) errors.push('event.sequence must be a positive safe integer');
  validateId(value.eventId, 'event.eventId', errors);
  if (typeof value.type !== 'string' || !TYPE_PATTERN.test(value.type)) errors.push('event.type is invalid');
  if (typeof value.subjectType !== 'string' || !TYPE_PATTERN.test(value.subjectType)) errors.push('event.subjectType is invalid');
  validateId(value.subjectId, 'event.subjectId', errors);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) errors.push('event.revision must be a non-negative safe integer');
  validatePayload(value.payload, 'event.payload', errors);
  validateTimestamp(value.occurredAt, 'event.occurredAt', errors);
  return result(errors);
}

function assertValid(validation, label) {
  if (!validation.ok) throw new TypeError(`${label}: ${validation.errors.join('; ')}`);
}

module.exports = Object.freeze({ assertValid, isPlainObject, validateSupervisorEvent, validateSupervisorRequest, validateSupervisorResponse });

'use strict';

const crypto = require('crypto');
const { canonicalSerialize, sha256Digest } = require('../operations');

const RELAY_VERSION = 1;
const EVENT_TYPES = Object.freeze(['intent', 'operation-update', 'receipt', 'approval-request', 'notification']);
const MESSAGE_ID_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const FIELDS = Object.freeze([
  'schema_version', 'message_id', 'event_type', 'created_at', 'payload_digest',
  'algorithm', 'iv_base64', 'tag_base64', 'ciphertext_base64',
]);
const FORBIDDEN_METADATA_FIELDS = new Set([
  'prompt', 'source', 'source_code', 'token', 'secret', 'credential', 'absolute_path',
]);
const MAX_METADATA_DEPTH = 32;
const MAX_METADATA_NODES = 10000;

function validateKey(key) {
  const bytes = Buffer.isBuffer(key) ? key : Buffer.from(key || '', 'base64');
  if (bytes.length !== 32) throw new TypeError('Relay key must contain exactly 32 bytes');
  return bytes;
}

function validateMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Relay payload must be an object');
  const seen = new WeakSet();
  let nodes = 0;
  function visit(node, depth) {
    if (!node || typeof node !== 'object') return;
    if (depth > MAX_METADATA_DEPTH) throw new TypeError('Relay payload exceeds the maximum metadata depth');
    if (seen.has(node)) throw new TypeError('Relay payload must not contain cycles');
    seen.add(node);
    nodes += 1;
    if (nodes > MAX_METADATA_NODES) throw new TypeError('Relay payload exceeds the maximum metadata size');
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [field, nested] of Object.entries(node)) {
      if (FORBIDDEN_METADATA_FIELDS.has(field)) throw new TypeError(`Relay payload contains forbidden field: ${field}`);
      visit(nested, depth + 1);
    }
  }
  visit(value, 0);
  return value;
}

function decodeCanonicalBase64(value, field, expectedLength) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError(`${field} must be canonical base64`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new TypeError(`${field} must be canonical base64`);
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new TypeError(`${field} must contain exactly ${expectedLength} bytes`);
  }
  return bytes;
}

function createEnvelope(eventType, payload, key, options = {}) {
  if (!EVENT_TYPES.includes(eventType)) throw new TypeError('Unsupported Relay event type');
  validateMetadata(payload);
  const createdAt = options.createdAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw new TypeError('createdAt must be canonical ISO');
  const payloadText = canonicalSerialize(payload);
  const payloadDigest = sha256Digest(payload);
  const messageId = options.messageId || `message-${payloadDigest.slice(7, 31)}`;
  if (typeof messageId !== 'string' || !MESSAGE_ID_PATTERN.test(messageId)) throw new TypeError('messageId is invalid');
  const iv = options.iv || crypto.randomBytes(12);
  if (!Buffer.isBuffer(iv) || iv.length !== 12) throw new TypeError('Relay iv must contain 12 bytes');
  const header = { schema_version: RELAY_VERSION, message_id: messageId, event_type: eventType,
    created_at: createdAt, payload_digest: payloadDigest, algorithm: 'aes-256-gcm' };
  const cipher = crypto.createCipheriv('aes-256-gcm', validateKey(key), iv);
  cipher.setAAD(Buffer.from(canonicalSerialize(header), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(payloadText, 'utf8'), cipher.final()]);
  return Object.freeze({ ...header, iv_base64: iv.toString('base64'),
    tag_base64: cipher.getAuthTag().toString('base64'), ciphertext_base64: ciphertext.toString('base64') });
}

function openEnvelope(envelope, key) {
  if (!envelope || JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify([...FIELDS].sort())) {
    throw new TypeError('Relay envelope fields must exactly match the allowlist');
  }
  if (envelope.schema_version !== RELAY_VERSION || envelope.algorithm !== 'aes-256-gcm') throw new TypeError('Unsupported Relay envelope');
  const header = { schema_version: envelope.schema_version, message_id: envelope.message_id,
    event_type: envelope.event_type, created_at: envelope.created_at,
    payload_digest: envelope.payload_digest, algorithm: envelope.algorithm };
  const iv = decodeCanonicalBase64(envelope.iv_base64, 'iv_base64', 12);
  const tag = decodeCanonicalBase64(envelope.tag_base64, 'tag_base64', 16);
  const ciphertext = decodeCanonicalBase64(envelope.ciphertext_base64, 'ciphertext_base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', validateKey(key), iv);
  decipher.setAAD(Buffer.from(canonicalSerialize(header), 'utf8'));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const payload = JSON.parse(plaintext);
  validateMetadata(payload);
  if (sha256Digest(payload) !== envelope.payload_digest) throw new Error('Relay payload digest mismatch');
  return Object.freeze(payload);
}

module.exports = Object.freeze({ EVENT_TYPES, FIELDS, MESSAGE_ID_PATTERN, RELAY_VERSION, createEnvelope, openEnvelope });

'use strict';

const path = require('path');

const SCHEMA_VERSION = 1;
const BUNDLE_FIELDS = Object.freeze(['schema_version', 'kind', 'bundle_id', 'title', 'records', 'trust_roots']);
const RECORD_FIELDS = Object.freeze([
  'schema_version', 'kind', 'record_id', 'title', 'classification', 'provenance',
  'receipt_path', 'receipt_digest', 'observed_at',
]);
const PROVENANCE_FIELDS = Object.freeze(['kind', 'reference']);
const TRUST_FIELDS = Object.freeze(['key_id', 'public_key_path', 'classification']);
const PINNED_TRUST_FIELDS = Object.freeze(['schema_version', 'kind', 'roots']);
const CLASSIFICATIONS = Object.freeze(['fixture', 'maintainer', 'independent']);
const OUTCOMES = Object.freeze(['passed', 'failed', 'blocked', 'unknown']);
const CLASSIFICATION_BY_PROVENANCE = Object.freeze({
  fixture: 'fixture',
  repository_operation: 'maintainer',
  discussion_comment: 'independent',
});
const ID = /^[a-z][a-z0-9]*(?:[-_.:][a-z0-9]+)*$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SENSITIVE = /(?:[A-Za-z]:[\\/]|(?:^|\s)\/(?:Users|home|tmp|var|etc|opt|workspace|mnt|src)\/|github_pat_|gh[pousr]_[A-Za-z0-9]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-|[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields, label, errors) {
  if (!plain(value)) { errors.push(`${label} must be a plain object`); return false; }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    errors.push(`${label} fields must exactly match the public proof allowlist`);
  }
  return true;
}

function safeLabel(value, label, errors) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\r\n]/.test(value)) {
    errors.push(`${label} must be a bounded single-line label`);
  } else if (SENSITIVE.test(value)) errors.push(`${label} contains sensitive or absolute-path content`);
}

function safeRelative(value, label, errors) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    errors.push(`${label} must be a contained relative path`);
    return;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) errors.push(`${label} must not contain traversal segments`);
}

function canonicalTime(value, label, errors) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    errors.push(`${label} must be a canonical ISO timestamp`);
  }
}

function validateProvenance(value, classification) {
  const errors = [];
  if (!exact(value, PROVENANCE_FIELDS, 'provenance', errors)) return errors;
  const expected = CLASSIFICATION_BY_PROVENANCE[value.kind];
  if (!expected) errors.push(`unsupported provenance kind: ${value.kind || '(missing)'}`);
  else if (expected !== classification) errors.push(`classification ${classification} is not allowed for provenance kind ${value.kind}`);
  if (value.kind === 'fixture' && !/^fixture:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.reference || '')) {
    errors.push('fixture provenance reference must be fixture:slug');
  }
  if (value.kind === 'repository_operation' && !/^commit:[a-f0-9]{40}$/.test(value.reference || '')) {
    errors.push('maintainer provenance reference must be a full commit digest');
  }
  if (value.kind === 'discussion_comment' &&
      !/^https:\/\/github\.com\/SethGammon\/Citadel\/discussions\/\d+#discussioncomment-\d+$/.test(value.reference || '')) {
    errors.push('independent provenance reference must be a Citadel Discussion comment URL');
  }
  return errors;
}

function validateRecord(value) {
  const errors = [];
  if (!exact(value, RECORD_FIELDS, 'proof record', errors)) return errors;
  if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (value.kind !== 'proof_record') errors.push('kind must be proof_record');
  if (!ID.test(value.record_id || '')) errors.push('record_id must be an opaque lowercase identifier');
  safeLabel(value.title, 'title', errors);
  if (!CLASSIFICATIONS.includes(value.classification)) errors.push(`classification must be one of: ${CLASSIFICATIONS.join(', ')}`);
  errors.push(...validateProvenance(value.provenance, value.classification));
  safeRelative(value.receipt_path, 'receipt_path', errors);
  if (!DIGEST.test(value.receipt_digest || '')) errors.push('receipt_digest must be a sha256 digest');
  canonicalTime(value.observed_at, 'observed_at', errors);
  return errors;
}

function validateBundle(value) {
  const errors = [];
  if (!exact(value, BUNDLE_FIELDS, 'proof bundle', errors)) return errors;
  if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (value.kind !== 'proof_bundle') errors.push('kind must be proof_bundle');
  if (!ID.test(value.bundle_id || '')) errors.push('bundle_id must be an opaque lowercase identifier');
  safeLabel(value.title, 'title', errors);
  if (!Array.isArray(value.records) || value.records.length === 0) errors.push('records must be a non-empty array');
  else {
    const unique = new Set();
    for (const record of value.records) {
      safeRelative(record, 'record path', errors);
      if (unique.has(record)) errors.push(`duplicate record path: ${record}`);
      unique.add(record);
    }
  }
  if (!Array.isArray(value.trust_roots)) errors.push('trust_roots must be an array');
  else {
    const unique = new Set();
    for (const [index, root] of value.trust_roots.entries()) {
      if (!exact(root, TRUST_FIELDS, `trust_roots[${index}]`, errors)) continue;
      if (!ID.test(root.key_id || '')) errors.push(`trust_roots[${index}].key_id is invalid`);
      safeRelative(root.public_key_path, `trust_roots[${index}].public_key_path`, errors);
      if (!CLASSIFICATIONS.includes(root.classification)) errors.push(`trust_roots[${index}].classification is invalid`);
      if (root.classification === 'independent') {
        errors.push(`trust_roots[${index}] cannot self-declare independent trust; use a separately pinned trust-root file`);
      }
      const identity = `${root.key_id}:${root.classification}`;
      if (unique.has(identity)) errors.push(`duplicate trust root: ${identity}`);
      unique.add(identity);
    }
  }
  return errors;
}

function validatePinnedTrustRoots(value) {
  const errors = [];
  if (!exact(value, PINNED_TRUST_FIELDS, 'pinned trust roots', errors)) return errors;
  if (value.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (value.kind !== 'proof_trust_roots') errors.push('kind must be proof_trust_roots');
  if (!Array.isArray(value.roots) || value.roots.length === 0) errors.push('roots must be a non-empty array');
  else {
    const unique = new Set();
    for (const [index, root] of value.roots.entries()) {
      if (!exact(root, TRUST_FIELDS, `roots[${index}]`, errors)) continue;
      if (!ID.test(root.key_id || '')) errors.push(`roots[${index}].key_id is invalid`);
      safeRelative(root.public_key_path, `roots[${index}].public_key_path`, errors);
      if (root.classification !== 'independent') errors.push(`roots[${index}].classification must be independent`);
      if (unique.has(root.key_id)) errors.push(`duplicate pinned trust root: ${root.key_id}`);
      unique.add(root.key_id);
    }
  }
  return errors;
}

module.exports = Object.freeze({
  BUNDLE_FIELDS,
  CLASSIFICATIONS,
  CLASSIFICATION_BY_PROVENANCE,
  OUTCOMES,
  PINNED_TRUST_FIELDS,
  RECORD_FIELDS,
  SCHEMA_VERSION,
  SENSITIVE,
  TRUST_FIELDS,
  validateBundle,
  validatePinnedTrustRoots,
  validateProvenance,
  validateRecord,
});

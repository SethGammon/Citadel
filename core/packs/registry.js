'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalSerialize, sha256Digest } = require('../operations');
const { isWithin, resolveExistingFile } = require('../distribution/fs-safety');

const REGISTRY_VERSION = 1;
const ID = /^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/;
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const INDEX_FIELDS = Object.freeze(['schema_version', 'kind', 'registry_id', 'generated_at', 'entries', 'revocations']);
const ENTRY_FIELDS = Object.freeze(['pack_id', 'version', 'publisher_id', 'content_digest', 'publisher_key_id', 'publisher_signature_base64']);
const ENTRY_PAYLOAD_FIELDS = Object.freeze(['pack_id', 'version', 'publisher_id', 'content_digest', 'publisher_key_id']);
const REVOCATION_FIELDS = Object.freeze(['scope', 'publisher_id', 'pack_id', 'version', 'reason_code', 'revoked_at']);
const ENVELOPE_FIELDS = Object.freeze(['schema_version', 'kind', 'index', 'index_digest', 'signature']);
const SIGNATURE_FIELDS = Object.freeze(['algorithm', 'key_id', 'signature_base64']);
const TRUST_FIELDS = Object.freeze(['schema_version', 'kind', 'registry', 'publishers']);
const TRUST_KEY_FIELDS = Object.freeze(['key_id', 'public_key_path']);
const PUBLISHER_TRUST_FIELDS = Object.freeze(['publisher_id', 'key_id', 'public_key_path', 'pack_ids']);

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields, label, errors) {
  if (!plain(value)) { errors.push(`${label} must be a plain object`); return false; }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    errors.push(`${label} fields must exactly match the allowlist`);
  }
  return true;
}

function canonicalTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function canonicalBase64(value) {
  return typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  return !value.replace(/\\/g, '/').split('/').includes('..') && !/[\0\r\n]/.test(value);
}

function uniqueArray(value, label, errors, check) {
  if (!Array.isArray(value)) { errors.push(`${label} must be an array`); return; }
  const seen = new Set();
  for (const item of value) {
    const identity = check(item, errors);
    if (identity !== null && seen.has(identity)) errors.push(`duplicate ${label}: ${identity}`);
    if (identity !== null) seen.add(identity);
  }
}

function entryPayload(entry) {
  return Object.fromEntries(ENTRY_PAYLOAD_FIELDS.map((field) => [field, entry[field]]));
}

function validateEntry(entry, errors, label = 'entry') {
  if (!exact(entry, ENTRY_FIELDS, label, errors)) return null;
  if (!PACK_ID.test(entry.pack_id || '')) errors.push(`${label}.pack_id is invalid`);
  if (!VERSION.test(entry.version || '')) errors.push(`${label}.version is invalid`);
  if (!ID.test(entry.publisher_id || '') || entry.pack_id?.split('/')[0] !== entry.publisher_id) errors.push(`${label}.publisher_id is invalid`);
  if (!DIGEST.test(entry.content_digest || '')) errors.push(`${label}.content_digest is invalid`);
  if (!ID.test(entry.publisher_key_id || '')) errors.push(`${label}.publisher_key_id is invalid`);
  if (!canonicalBase64(entry.publisher_signature_base64)) errors.push(`${label}.publisher_signature_base64 is invalid`);
  return `${entry.pack_id}@${entry.version}`;
}

function validateRevocation(record, errors, label = 'revocation') {
  if (!exact(record, REVOCATION_FIELDS, label, errors)) return null;
  if (!['publisher', 'pack', 'version'].includes(record.scope)) errors.push(`${label}.scope is invalid`);
  if (!ID.test(record.publisher_id || '')) errors.push(`${label}.publisher_id is invalid`);
  if (record.pack_id !== null && (!PACK_ID.test(record.pack_id) || record.pack_id.split('/')[0] !== record.publisher_id)) errors.push(`${label}.pack_id is invalid`);
  if (record.version !== null && !VERSION.test(record.version)) errors.push(`${label}.version is invalid`);
  if (record.scope === 'publisher' && (record.pack_id !== null || record.version !== null)) errors.push(`${label} publisher scope requires null pack_id and version`);
  if (record.scope === 'pack' && (record.pack_id === null || record.version !== null)) errors.push(`${label} pack scope requires pack_id and null version`);
  if (record.scope === 'version' && (record.pack_id === null || record.version === null)) errors.push(`${label} version scope requires pack_id and version`);
  if (!CODE.test(record.reason_code || '')) errors.push(`${label}.reason_code is invalid`);
  if (!canonicalTime(record.revoked_at)) errors.push(`${label}.revoked_at is invalid`);
  return `${record.scope}:${record.publisher_id}:${record.pack_id || ''}:${record.version || ''}`;
}

function validateRegistryIndex(index) {
  const errors = [];
  if (!exact(index, INDEX_FIELDS, 'registry index', errors)) return errors;
  if (index.schema_version !== REGISTRY_VERSION) errors.push(`schema_version must be ${REGISTRY_VERSION}`);
  if (index.kind !== 'pack_registry_index') errors.push('kind must be pack_registry_index');
  if (!ID.test(index.registry_id || '')) errors.push('registry_id is invalid');
  if (!canonicalTime(index.generated_at)) errors.push('generated_at is invalid');
  uniqueArray(index.entries, 'registry entry', errors, (entry) => validateEntry(entry, errors));
  uniqueArray(index.revocations, 'revocation', errors, (record) => validateRevocation(record, errors));
  if (Array.isArray(index.entries)) {
    const sorted = [...index.entries].sort((a, b) => `${a.pack_id}@${a.version}`.localeCompare(`${b.pack_id}@${b.version}`));
    if (canonicalSerialize(sorted) !== canonicalSerialize(index.entries)) errors.push('registry entries must be sorted by pack identity and version');
  }
  if (Array.isArray(index.revocations)) {
    const sorted = [...index.revocations].sort((a, b) => validateRevocation(a, []).localeCompare(validateRevocation(b, [])));
    if (canonicalSerialize(sorted) !== canonicalSerialize(index.revocations)) errors.push('revocations must be sorted by scope and identity');
  }
  return errors;
}

function validateRegistryEnvelope(envelope) {
  const errors = [];
  if (!exact(envelope, ENVELOPE_FIELDS, 'registry envelope', errors)) return errors;
  if (envelope.schema_version !== REGISTRY_VERSION) errors.push(`schema_version must be ${REGISTRY_VERSION}`);
  if (envelope.kind !== 'signed_pack_registry') errors.push('kind must be signed_pack_registry');
  errors.push(...validateRegistryIndex(envelope.index));
  if (envelope.index_digest !== sha256Digest(envelope.index)) errors.push('index_digest does not match index');
  if (exact(envelope.signature, SIGNATURE_FIELDS, 'registry signature', errors)) {
    if (envelope.signature.algorithm !== 'ed25519') errors.push('registry signature algorithm must be ed25519');
    if (!ID.test(envelope.signature.key_id || '')) errors.push('registry signature key_id is invalid');
    if (!canonicalBase64(envelope.signature.signature_base64)) errors.push('registry signature bytes are invalid');
  }
  return errors;
}

function validateTrustManifest(manifest) {
  const errors = [];
  if (!exact(manifest, TRUST_FIELDS, 'registry trust manifest', errors)) return errors;
  if (manifest.schema_version !== REGISTRY_VERSION) errors.push(`schema_version must be ${REGISTRY_VERSION}`);
  if (manifest.kind !== 'pack_registry_trust') errors.push('kind must be pack_registry_trust');
  if (exact(manifest.registry, TRUST_KEY_FIELDS, 'registry trust key', errors)) {
    if (!ID.test(manifest.registry.key_id || '')) errors.push('registry trust key id is invalid');
    if (!safeRelative(manifest.registry.public_key_path)) errors.push('registry public_key_path must be a safe relative path');
  }
  uniqueArray(manifest.publishers, 'publisher trust', errors, (publisher) => {
    if (!exact(publisher, PUBLISHER_TRUST_FIELDS, 'publisher trust', errors)) return null;
    if (!ID.test(publisher.publisher_id || '')) errors.push('publisher trust publisher_id is invalid');
    if (!ID.test(publisher.key_id || '')) errors.push('publisher trust key_id is invalid');
    if (!safeRelative(publisher.public_key_path)) errors.push('publisher public_key_path must be a safe relative path');
    if (!Array.isArray(publisher.pack_ids) || publisher.pack_ids.length === 0) errors.push('publisher pack_ids must be a non-empty array');
    else {
      const ids = new Set();
      for (const packId of publisher.pack_ids) {
        if (!PACK_ID.test(packId) || packId.split('/')[0] !== publisher.publisher_id) errors.push(`publisher owned pack id is invalid: ${packId}`);
        if (ids.has(packId)) errors.push(`duplicate publisher owned pack id: ${packId}`);
        ids.add(packId);
      }
    }
    return `${publisher.publisher_id}:${publisher.key_id}`;
  });
  return errors;
}

function publicKey(key) {
  const value = key && key.type === 'public' ? key : crypto.createPublicKey(key);
  if (value.asymmetricKeyType !== 'ed25519') throw new TypeError('Pack registry keys must be Ed25519');
  return value;
}

function privateKey(key) {
  const value = key && key.type === 'private' ? key : crypto.createPrivateKey(key);
  if (value.asymmetricKeyType !== 'ed25519') throw new TypeError('Pack registry keys must be Ed25519');
  return value;
}

function signBytes(value, key) {
  return crypto.sign(null, Buffer.from(canonicalSerialize(value), 'utf8'), privateKey(key)).toString('base64');
}

function verifyBytes(value, signature, key) {
  return crypto.verify(null, Buffer.from(canonicalSerialize(value), 'utf8'), publicKey(key), Buffer.from(signature, 'base64'));
}

function createSignedRegistry(options) {
  const packIndex = options.packIndex || require('./index').buildPackIndex(options.projectRoot);
  const signers = new Map((options.publisherSigners || []).map((item) => [item.publisherId, item]));
  const entries = packIndex.packs.map((pack) => {
    const signer = signers.get(pack.publisher.id);
    if (!signer) throw new Error(`Missing publisher signer: ${pack.publisher.id}`);
    const payload = {
      pack_id: pack.id,
      version: pack.version,
      publisher_id: pack.publisher.id,
      content_digest: `sha256:${pack.digest.digest}`,
      publisher_key_id: signer.keyId,
    };
    return Object.freeze({ ...payload, publisher_signature_base64: signBytes(payload, signer.privateKey) });
  }).sort((a, b) => `${a.pack_id}@${a.version}`.localeCompare(`${b.pack_id}@${b.version}`));
  const revocations = [...(options.revocations || [])]
    .sort((a, b) => validateRevocation(a, []).localeCompare(validateRevocation(b, [])));
  const index = Object.freeze({
    schema_version: REGISTRY_VERSION,
    kind: 'pack_registry_index',
    registry_id: options.registryId,
    generated_at: options.generatedAt,
    entries: Object.freeze(entries),
    revocations: Object.freeze(revocations),
  });
  const errors = validateRegistryIndex(index);
  if (errors.length) throw new TypeError(`Invalid Pack registry index: ${errors.join('; ')}`);
  const envelope = {
    schema_version: REGISTRY_VERSION,
    kind: 'signed_pack_registry',
    index,
    index_digest: sha256Digest(index),
    signature: {
      algorithm: 'ed25519',
      key_id: options.registryKeyId,
      signature_base64: signBytes(index, options.registryPrivateKey),
    },
  };
  const envelopeErrors = validateRegistryEnvelope(envelope);
  if (envelopeErrors.length) throw new TypeError(`Invalid signed Pack registry: ${envelopeErrors.join('; ')}`);
  return Object.freeze(envelope);
}

function loadTrustManifest(trustRootFile, registryRoot) {
  if (!trustRootFile) throw new Error('A separately pinned registry trust manifest is required');
  const requested = path.resolve(trustRootFile);
  const file = resolveExistingFile(path.dirname(requested), path.basename(requested), 'Pack registry trust manifest');
  if (isWithin(registryRoot, file)) throw new Error('Pack registry trust manifest must be outside the registry directory');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateTrustManifest(manifest);
  if (errors.length) throw new Error(`Invalid Pack registry trust manifest: ${errors.join('; ')}`);
  const root = path.dirname(file);
  function readPinned(relative, label) {
    const keyPath = resolveExistingFile(root, relative, label);
    if (isWithin(registryRoot, keyPath)) throw new Error(`${label} must be outside the registry directory`);
    return fs.readFileSync(keyPath, 'utf8');
  }
  return {
    registry: { ...manifest.registry, publicKey: readPinned(manifest.registry.public_key_path, 'registry public key') },
    publishers: manifest.publishers.map((item) => ({ ...item,
      publicKey: readPinned(item.public_key_path, 'publisher public key') })),
  };
}

function matchesRevocation(entry, record) {
  if (record.publisher_id !== entry.publisher_id) return false;
  if (record.scope === 'publisher') return true;
  if (record.pack_id !== entry.pack_id) return false;
  return record.scope === 'pack' || record.version === entry.version;
}

function verifyRegistryEnvelope(envelope, trust) {
  const errors = validateRegistryEnvelope(envelope);
  if (errors.length) return { status: 'invalid', reason_code: 'INVALID_REGISTRY_ENVELOPE', errors };
  if (!trust || trust.registry.key_id !== envelope.signature.key_id) {
    return { status: 'unknown', reason_code: 'REGISTRY_SIGNER_NOT_TRUSTED', errors: [] };
  }
  if (!verifyBytes(envelope.index, envelope.signature.signature_base64, trust.registry.publicKey)) {
    return { status: 'invalid', reason_code: 'REGISTRY_SIGNATURE_INVALID', errors: [] };
  }
  const publishers = new Map(trust.publishers.map((item) => [`${item.publisher_id}:${item.key_id}`, item]));
  const entries = [];
  for (const entry of envelope.index.entries) {
    const pinned = publishers.get(`${entry.publisher_id}:${entry.publisher_key_id}`);
    if (!pinned || !pinned.pack_ids.includes(entry.pack_id)) {
      entries.push({ pack_id: entry.pack_id, version: entry.version, status: 'unknown', reason_code: 'PUBLISHER_NOT_PINNED_FOR_PACK' });
      continue;
    }
    if (!verifyBytes(entryPayload(entry), entry.publisher_signature_base64, pinned.publicKey)) {
      entries.push({ pack_id: entry.pack_id, version: entry.version, status: 'invalid', reason_code: 'PUBLISHER_SIGNATURE_INVALID' });
      continue;
    }
    const revoked = envelope.index.revocations.find((record) => matchesRevocation(entry, record));
    entries.push({ pack_id: entry.pack_id, version: entry.version,
      status: revoked ? 'revoked' : 'verified', reason_code: revoked ? revoked.reason_code : 'SIGNATURES_VERIFIED' });
  }
  const status = entries.every((entry) => entry.status === 'verified') ? 'verified'
    : entries.some((entry) => ['invalid', 'revoked'].includes(entry.status)) ? 'invalid' : 'unknown';
  return { status, reason_code: status === 'verified' ? 'REGISTRY_VERIFIED' : 'REGISTRY_ENTRIES_NOT_USABLE',
    index_digest: envelope.index_digest, registry_id: envelope.index.registry_id, entries, errors: [] };
}

function verifyRegistryFile(registryFile, trustRootFile) {
  const requested = path.resolve(registryFile);
  const file = resolveExistingFile(path.dirname(requested), path.basename(requested), 'signed Pack registry');
  const root = path.dirname(file);
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  const trust = loadTrustManifest(trustRootFile, root);
  return verifyRegistryEnvelope(envelope, trust);
}

module.exports = Object.freeze({
  ENVELOPE_FIELDS,
  ENTRY_FIELDS,
  INDEX_FIELDS,
  REGISTRY_VERSION,
  REVOCATION_FIELDS,
  TRUST_FIELDS,
  createSignedRegistry,
  entryPayload,
  loadTrustManifest,
  matchesRevocation,
  validateRegistryEnvelope,
  validateRegistryIndex,
  validateTrustManifest,
  verifyRegistryEnvelope,
  verifyRegistryFile,
});

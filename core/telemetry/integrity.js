'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HASH_VERSION = 1;
const SIGNATURE_VERSION = 1;
const HMAC_ALGORITHM = 'hmac-sha256';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function stripIntegrityFields(record) {
  const {
    _hash,
    _hash_v,
    _signature,
    _signature_v,
    _signature_alg,
    _signature_key_id,
    ...body
  } = record || {};
  return body;
}

function hashRecord(record) {
  const canonical = JSON.stringify(canonicalize(stripIntegrityFields(record)));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function shortHash(value, prefix) {
  const text = typeof value === 'string' ? value : JSON.stringify(canonicalize(value));
  const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
  return `${prefix}_${digest}`;
}

function slug(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'unknown';
}

function resolveSigningKey(options = {}) {
  return options.hmacKey || process.env.CITADEL_TELEMETRY_HMAC_KEY || null;
}

function signRecord(record, options = {}) {
  const key = resolveSigningKey(options);
  if (!key) return record;

  const body = stripIntegrityFields(record);
  const canonical = JSON.stringify(canonicalize(body));
  const signature = crypto.createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
  return {
    ...record,
    _signature: signature,
    _signature_v: SIGNATURE_VERSION,
    _signature_alg: HMAC_ALGORITHM,
    _signature_key_id: options.hmacKeyId || process.env.CITADEL_TELEMETRY_HMAC_KEY_ID || 'local',
  };
}

function attachIntegrity(record, options = {}) {
  const body = stripIntegrityFields(record);
  const hashed = {
    ...body,
    _hash: hashRecord(body),
    _hash_v: HASH_VERSION,
  };
  return signRecord(hashed, options);
}

function createEventId(record) {
  return shortHash({
    schema: record.schema,
    timestamp: record.timestamp,
    event: record.event || record.kind || record.workflow || 'event',
    agent: record.agent || null,
    session: record.session || null,
    path: record.path || null,
    status: record.status || null,
  }, 'evt');
}

function withLineageIds(record, options = {}) {
  const base = {
    ...record,
    run_id: record.run_id || options.run_id || record.session || null,
    agent_id: record.agent_id || options.agent_id || (record.agent ? `agent_${slug(record.agent)}` : null),
    task_id: record.task_id || options.task_id || record.task || record.meta?.task_id || null,
    artifact_id: record.artifact_id || options.artifact_id || null,
    parent_id: record.parent_id || options.parent_id || null,
    source_event_id: record.source_event_id || options.source_event_id || null,
  };

  if (!base.event_id) base.event_id = createEventId(base);
  if (!base.run_id) base.run_id = shortHash({ session: base.session, event_id: base.event_id }, 'run');
  if (!base.artifact_id && base.path) base.artifact_id = shortHash({ path: base.path, workflow: base.workflow, route: base.route }, 'art');
  return base;
}

function createIntegrityRecord(record, options = {}) {
  return attachIntegrity(withLineageIds(record, options), options);
}

function verifyRecord(record, options = {}) {
  if (!record || typeof record !== 'object') {
    return { status: 'invalid', reason: 'record is not an object' };
  }

  if (!record._hash || record._hash_v !== HASH_VERSION) {
    return { status: 'legacy', reason: 'missing hash fields' };
  }

  const expectedHash = hashRecord(record);
  if (expectedHash !== record._hash) {
    return { status: 'tampered', reason: 'hash mismatch', expectedHash, actualHash: record._hash };
  }

  if (record._signature) {
    if (record._signature_alg !== HMAC_ALGORITHM || record._signature_v !== SIGNATURE_VERSION) {
      return { status: 'signature-unsupported', reason: 'unsupported signature metadata' };
    }
    const key = resolveSigningKey(options);
    if (!key) {
      return { status: 'verified-unsigned-key-missing', reason: 'hash valid but signing key unavailable' };
    }
    const expected = signRecord({ ...record, _signature: undefined }, options)._signature;
    if (expected !== record._signature) {
      return { status: 'tampered', reason: 'signature mismatch', expectedSignature: expected, actualSignature: record._signature };
    }
    return { status: 'verified-signed', reason: 'hash and signature valid' };
  }

  return { status: 'verified', reason: 'hash valid' };
}

function verifyJsonlFile(filePath, options = {}) {
  const summary = {
    file: filePath,
    exists: fs.existsSync(filePath),
    total: 0,
    verified: 0,
    signed: 0,
    legacy: 0,
    tampered: [],
    invalid: [],
    signatureWarnings: [],
  };

  if (!summary.exists) return summary;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (let index = 0; index < lines.length; index++) {
    summary.total++;
    let record;
    try {
      record = JSON.parse(lines[index]);
    } catch (error) {
      summary.invalid.push({ lineNumber: index + 1, reason: `invalid JSON: ${error.message}` });
      continue;
    }

    const result = verifyRecord(record, options);
    if (result.status === 'verified' || result.status === 'verified-signed') {
      summary.verified++;
      if (result.status === 'verified-signed') summary.signed++;
    } else if (result.status === 'legacy') {
      summary.legacy++;
    } else if (result.status === 'tampered') {
      summary.tampered.push({ lineNumber: index + 1, event_id: record.event_id || null, reason: result.reason });
    } else if (result.status === 'verified-unsigned-key-missing' || result.status === 'signature-unsupported') {
      summary.verified++;
      summary.signatureWarnings.push({ lineNumber: index + 1, event_id: record.event_id || null, reason: result.reason });
    } else {
      summary.invalid.push({ lineNumber: index + 1, reason: result.reason });
    }
  }

  return summary;
}

function collectJsonlFiles(projectRoot) {
  const roots = [
    path.join(projectRoot, '.planning', 'telemetry'),
    path.join(projectRoot, '.planning', 'artifacts'),
  ];
  const files = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (entry.endsWith('.jsonl')) files.push(path.join(root, entry));
    }
  }
  return files.sort();
}

function verifyProjectTelemetry(projectRoot, options = {}) {
  const files = options.files || collectJsonlFiles(projectRoot);
  const reports = files.map((file) => verifyJsonlFile(file, options));
  return {
    projectRoot,
    files: reports,
    totals: reports.reduce((acc, report) => {
      acc.total += report.total;
      acc.verified += report.verified;
      acc.signed += report.signed;
      acc.legacy += report.legacy;
      acc.tampered += report.tampered.length;
      acc.invalid += report.invalid.length;
      acc.signatureWarnings += report.signatureWarnings.length;
      return acc;
    }, { total: 0, verified: 0, signed: 0, legacy: 0, tampered: 0, invalid: 0, signatureWarnings: 0 }),
  };
}

module.exports = {
  HASH_VERSION,
  HMAC_ALGORITHM,
  SIGNATURE_VERSION,
  attachIntegrity,
  canonicalize,
  collectJsonlFiles,
  createEventId,
  createIntegrityRecord,
  hashRecord,
  shortHash,
  signRecord,
  stripIntegrityFields,
  verifyJsonlFile,
  verifyProjectTelemetry,
  verifyRecord,
  withLineageIds,
};

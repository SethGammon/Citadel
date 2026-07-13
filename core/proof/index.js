'use strict';

const fs = require('fs');
const path = require('path');
const { isWithin, resolveExistingFile } = require('../distribution/fs-safety');
const { verifyExecutionReceipt } = require('../operations');
const { OUTCOMES, validateBundle, validatePinnedTrustRoots, validateRecord } = require('./schema');

const BUNDLE_FILE = 'proof.bundle.json';

function parseJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`); }
}

function assertValid(value, validator, label) {
  const errors = validator(value);
  if (errors.length) throw new Error(`Invalid ${label}: ${errors.join('; ')}`);
  return value;
}

function loadBundle(bundleRoot) {
  const root = path.resolve(bundleRoot);
  const manifestPath = resolveExistingFile(root, BUNDLE_FILE, 'proof bundle manifest');
  const manifest = assertValid(parseJson(manifestPath, 'proof bundle manifest'), validateBundle, 'proof bundle');
  const records = manifest.records.map((relative) => {
    const recordPath = resolveExistingFile(root, relative, 'proof record');
    const record = assertValid(parseJson(recordPath, 'proof record'), validateRecord, 'proof record');
    return { relative, recordPath, record };
  });
  const ids = new Set();
  for (const item of records) {
    if (ids.has(item.record.record_id)) throw new Error(`Duplicate proof record id: ${item.record.record_id}`);
    ids.add(item.record.record_id);
  }
  return { root: path.dirname(manifestPath), manifestPath, manifest, records };
}

function loadPinnedTrustRoots(filePath, bundleRoot) {
  if (!filePath) return [];
  const resolved = path.resolve(filePath);
  const manifestPath = resolveExistingFile(path.dirname(resolved), path.basename(resolved), 'pinned proof trust roots');
  if (isWithin(bundleRoot, manifestPath)) throw new Error('Pinned trust-root file must be outside the proof bundle');
  const manifest = assertValid(parseJson(manifestPath, 'pinned proof trust roots'), validatePinnedTrustRoots, 'pinned proof trust roots');
  const rootDirectory = path.dirname(manifestPath);
  return manifest.roots.map((root) => {
    const publicKeyPath = resolveExistingFile(rootDirectory, root.public_key_path, 'pinned proof public key');
    if (isWithin(bundleRoot, publicKeyPath)) throw new Error('Pinned proof public keys must be outside the proof bundle');
    return Object.freeze({ ...root, publicKey: fs.readFileSync(publicKeyPath, 'utf8') });
  });
}

function unknownRecord(record, reasonCode) {
  return {
    record_id: record.record_id,
    title: record.title,
    classification: record.classification,
    observed_at: record.observed_at,
    receipt_digest: record.receipt_digest,
    trust_state: 'unknown',
    outcome: 'unknown',
    reason_code: reasonCode,
  };
}

function verifyRecord(bundle, item, options = {}) {
  const { record } = item;
  let envelope;
  try {
    const receiptPath = resolveExistingFile(bundle.root, record.receipt_path, 'ExecutionReceipt envelope');
    envelope = parseJson(receiptPath, 'ExecutionReceipt envelope');
  } catch (_error) {
    return unknownRecord(record, 'RECEIPT_MISSING_OR_UNSAFE');
  }
  if (envelope.receipt_digest !== record.receipt_digest) return unknownRecord(record, 'RECEIPT_DIGEST_MISMATCH');
  const keyId = envelope?.signature?.key_id;
  const trustRoots = record.classification === 'independent'
    ? (options.pinnedTrustRoots || []) : bundle.manifest.trust_roots;
  const trust = trustRoots.find((root) => (
    root.key_id === keyId && root.classification === record.classification
  ));
  if (!trust) return unknownRecord(record, 'SIGNER_NOT_TRUSTED_FOR_SOURCE');
  let publicKey;
  try {
    publicKey = trust.publicKey || fs.readFileSync(resolveExistingFile(bundle.root, trust.public_key_path, 'proof trust root'), 'utf8');
  } catch (_error) {
    return unknownRecord(record, 'TRUST_ROOT_MISSING_OR_UNSAFE');
  }
  const verified = verifyExecutionReceipt(envelope, { publicKey });
  if (verified.status !== 'verified') return unknownRecord(record, `RECEIPT_${verified.reason_code || 'INVALID'}`);
  const outcome = OUTCOMES.includes(envelope.receipt.status) ? envelope.receipt.status : 'unknown';
  return {
    record_id: record.record_id,
    title: record.title,
    classification: record.classification,
    observed_at: record.observed_at,
    receipt_digest: record.receipt_digest,
    trust_state: 'verified',
    outcome,
    reason_code: 'SIGNATURE_VERIFIED',
  };
}

function countBy(records, field, values) {
  return Object.fromEntries(values.map((value) => [value, records.filter((record) => record[field] === value).length]));
}

function ledgerFromBundle(bundleRoot, options = {}) {
  const bundle = loadBundle(bundleRoot);
  const pinnedTrustRoots = loadPinnedTrustRoots(options.trustRootFile, bundle.root);
  const records = bundle.records.map((item) => verifyRecord(bundle, item, { pinnedTrustRoots }))
    .sort((a, b) => a.record_id.localeCompare(b.record_id));
  const unverified = records.filter((record) => record.trust_state !== 'verified');
  if (options.strict && unverified.length) {
    throw new Error(`Strict proof publication refused ${unverified.length} unverified receipt record(s)`);
  }
  const outcomes = countBy(records, 'outcome', OUTCOMES);
  const classifications = countBy(records, 'classification', ['fixture', 'maintainer', 'independent']);
  const denominator = records.length;
  return {
    schema_version: 1,
    kind: 'proof_ledger',
    bundle_id: bundle.manifest.bundle_id,
    title: bundle.manifest.title,
    records,
    denominators: {
      all_records: denominator,
      verified_receipts: records.filter((record) => record.trust_state === 'verified').length,
      classifications,
      outcomes: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, {
        numerator: outcomes[outcome], denominator,
        rate: denominator ? Number((outcomes[outcome] / denominator).toFixed(4)) : null,
      }])),
    },
    limitations: [
      'Fixture, maintainer, and independent evidence are separate origin-bound classifications.',
      'Unknown includes missing, altered, unsafe, or untrusted receipts and is never counted as passed.',
      'A verified receipt proves integrity against a declared offline trust root, not product usefulness by itself.',
      'Independent records require a trust-root file pinned outside the proof bundle. Bundle-controlled keys cannot declare independent trust.',
    ],
  };
}

function renderMarkdown(ledger) {
  const lines = [
    `# ${ledger.title}`,
    '',
    'This ledger is generated from strict proof records and offline-verified ExecutionReceipt envelopes.',
    '',
    '## Denominators',
    '',
    `- All records: ${ledger.denominators.all_records}`,
    `- Verified receipts: ${ledger.denominators.verified_receipts}`,
    `- Fixture: ${ledger.denominators.classifications.fixture}`,
    `- Maintainer: ${ledger.denominators.classifications.maintainer}`,
    `- Independent: ${ledger.denominators.classifications.independent}`,
    '',
    '## Outcomes',
    '',
    '| Record | Classification | Receipt trust | Outcome |',
    '|---|---|---|---|',
  ];
  for (const record of ledger.records) {
    lines.push(`| ${record.title} | ${record.classification} | ${record.trust_state} | ${record.outcome} |`);
  }
  lines.push('', '## Outcome denominators', '');
  for (const outcome of OUTCOMES) {
    const metric = ledger.denominators.outcomes[outcome];
    lines.push(`- ${outcome}: ${metric.numerator}/${metric.denominator} (${metric.rate === null ? 'unknown' : metric.rate})`);
  }
  lines.push('', '## Interpretation limits', '');
  for (const limitation of ledger.limitations) lines.push(`- ${limitation}`);
  lines.push('');
  return lines.join('\n');
}

module.exports = Object.freeze({
  BUNDLE_FILE,
  ledgerFromBundle,
  loadBundle,
  loadPinnedTrustRoots,
  renderMarkdown,
  verifyRecord,
});

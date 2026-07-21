'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalSerialize, sha256Digest } = require('./canonical');
const { DIGEST_PATTERN, ID_PATTERN } = require('./validation');
const { PROTOCOL_VERSION } = require('./constants');

const EFFECT_CLASSES = Object.freeze([
  'pure',
  'workspace-reversible',
  'external-idempotent',
  'external-nonrepeatable',
]);
const IDEMPOTENCY_STATES = Object.freeze(['pending', 'completed', 'unknown', 'retryable']);
const JOURNAL_FIELDS = Object.freeze([
  'protocol_version', 'kind', 'sequence', 'recorded_at', 'run_id', 'attempt_id',
  'idempotency_key', 'effect_class', 'state', 'payload_digest', 'evidence_digest',
  'previous_hash', 'entry_hash',
]);
const ENTRY_PATTERN = /^(\d{8})\.json$/;

class JournalCorruptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'JournalCorruptionError';
    this.code = code;
  }
}

function exactFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...JOURNAL_FIELDS].sort());
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validateJournalEntry(entry, options = {}) {
  const errors = [];
  if (!exactFields(entry)) return ['journal entry fields must exactly match the privacy allowlist'];
  if (entry.protocol_version !== PROTOCOL_VERSION) errors.push(`protocol_version must be ${PROTOCOL_VERSION}`);
  if (entry.kind !== 'operation_journal_entry') errors.push('kind must be operation_journal_entry');
  if (!Number.isInteger(entry.sequence) || entry.sequence < 1) errors.push('sequence must be a positive integer');
  if (!canonicalTimestamp(entry.recorded_at)) errors.push('recorded_at must be a canonical ISO timestamp');
  for (const field of ['run_id', 'attempt_id', 'idempotency_key']) {
    if (typeof entry[field] !== 'string' || entry[field].length > 128 || !ID_PATTERN.test(entry[field])) {
      errors.push(`${field} must be an opaque lowercase identifier`);
    }
  }
  if (!EFFECT_CLASSES.includes(entry.effect_class)) errors.push('effect_class is invalid');
  if (!IDEMPOTENCY_STATES.includes(entry.state)) errors.push('state is invalid');
  if (typeof entry.payload_digest !== 'string' || !DIGEST_PATTERN.test(entry.payload_digest)) errors.push('payload_digest must be a sha256 digest');
  if (entry.evidence_digest !== null && (typeof entry.evidence_digest !== 'string' || !DIGEST_PATTERN.test(entry.evidence_digest))) {
    errors.push('evidence_digest must be null or a sha256 digest');
  }
  if (['completed', 'retryable'].includes(entry.state) && entry.evidence_digest === null) {
    errors.push('completed and retryable checkpoints require evidence_digest');
  }
  if (entry.previous_hash !== null && (typeof entry.previous_hash !== 'string' || !DIGEST_PATTERN.test(entry.previous_hash))) {
    errors.push('previous_hash must be null or a sha256 digest');
  }
  if (typeof entry.entry_hash !== 'string' || !DIGEST_PATTERN.test(entry.entry_hash)) errors.push('entry_hash must be a sha256 digest');
  const unsigned = { ...entry };
  delete unsigned.entry_hash;
  if (entry.entry_hash !== sha256Digest(unsigned)) errors.push('entry_hash does not match canonical entry content');
  if ('expectedSequence' in options && entry.sequence !== options.expectedSequence) errors.push('journal sequence is not contiguous');
  if ('expectedPreviousHash' in options && entry.previous_hash !== options.expectedPreviousHash) errors.push('journal hash chain is broken');
  return errors;
}

function entryFiles(journalDir) {
  if (!fs.existsSync(journalDir)) return [];
  return fs.readdirSync(journalDir)
    .filter((name) => ENTRY_PATTERN.test(name))
    .sort();
}
function validateJournalContinuation(previous, entry) {
  const errors = [];
  if (!previous) {
    if (entry.state !== 'pending') errors.push('first idempotency checkpoint must be pending');
    return errors;
  }
  for (const field of ['run_id', 'attempt_id', 'effect_class', 'payload_digest']) {
    if (entry[field] !== previous[field]) errors.push(field + ' cannot change for an idempotency key');
  }
  if (Date.parse(entry.recorded_at) < Date.parse(previous.recorded_at)) {
    errors.push('idempotency checkpoint timestamps must be monotonic');
  }
  const allowed = {
    pending: ['pending', 'completed', 'unknown', 'retryable'],
    unknown: ['pending', 'completed', 'retryable'],
    retryable: ['pending'],
    completed: [],
  };
  if (!allowed[previous.state].includes(entry.state)) {
    errors.push('invalid idempotency state transition: ' + previous.state + ' -> ' + entry.state);
  }
  if (entry.state === 'pending' && previous.effect_class === 'external-nonrepeatable'
      && previous.state !== 'retryable') {
    errors.push('nonrepeatable effects require an evidenced retryable resolution before retry');
  }
  return errors;
}


function readJournal(journalDir) {
  const files = entryFiles(journalDir);
  const entries = [];
  const latest = new Map();
  let previousHash = null;
  files.forEach((name, index) => {
    const match = name.match(ENTRY_PATTERN);
    const fileSequence = Number(match[1]);
    if (fileSequence !== index + 1) throw new JournalCorruptionError('SEQUENCE_GAP', 'Journal sequence is not contiguous');
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(journalDir, name), 'utf8'));
    } catch (_error) {
      throw new JournalCorruptionError('INVALID_JSON', 'Journal entry is not valid JSON');
    }
    const errors = validateJournalEntry(entry, {
      expectedSequence: index + 1,
      expectedPreviousHash: previousHash,
    });
    if (errors.length) throw new JournalCorruptionError('INVALID_ENTRY', errors.join('; '));
    entries.push(entry);
    const continuationErrors = validateJournalContinuation(latest.get(entry.idempotency_key), entry);
    if (continuationErrors.length) throw new JournalCorruptionError('INVALID_ENTRY', continuationErrors.join('; '));
    latest.set(entry.idempotency_key, entry);
    previousHash = entry.entry_hash;
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    head_hash: previousHash,
    next_sequence: entries.length + 1,
  });
}

function acquireLock(journalDir) {
  fs.mkdirSync(journalDir, { recursive: true });
  const lockPath = path.join(journalDir, '.append.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } catch (_error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    throw new Error('Journal append is already locked');
  }
  fs.closeSync(descriptor);
  return lockPath;
}

function atomicWrite(target, content) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.existsSync(target)) throw new Error('Journal sequence already exists');
    fs.renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function appendJournalEntry(journalDir, input, options = {}) {
  const lockPath = acquireLock(journalDir);
  try {
    const journal = readJournal(journalDir);
    const unsigned = {
      protocol_version: PROTOCOL_VERSION,
      kind: 'operation_journal_entry',
      sequence: journal.next_sequence,
      recorded_at: options.now || new Date().toISOString(),
      run_id: input.run_id,
      attempt_id: input.attempt_id,
      idempotency_key: input.idempotency_key,
      effect_class: input.effect_class,
      state: input.state,
      payload_digest: input.payload_digest,
      evidence_digest: input.evidence_digest ?? null,
      previous_hash: journal.head_hash,
    };
    const entry = { ...unsigned, entry_hash: sha256Digest(unsigned) };
    const errors = validateJournalEntry(entry, {
      expectedSequence: journal.next_sequence,
      expectedPreviousHash: journal.head_hash,
    });
    const previous = [...journal.entries].reverse()
      .find((item) => item.idempotency_key === entry.idempotency_key);
    errors.push(...validateJournalContinuation(previous, entry));

    if (errors.length) throw new TypeError(`Invalid journal entry: ${errors.join('; ')}`);
    const target = path.join(journalDir, `${String(entry.sequence).padStart(8, '0')}.json`);
    atomicWrite(target, `${canonicalSerialize(entry)}\n`);
    return Object.freeze(entry);
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

module.exports = Object.freeze({
  EFFECT_CLASSES,
  IDEMPOTENCY_STATES,
  JOURNAL_FIELDS,
  JournalCorruptionError,
  appendJournalEntry,
  readJournal,
  validateJournalEntry,
});

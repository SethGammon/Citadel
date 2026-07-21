'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalSerialize, sha256Digest } = require('./canonical');
const { assertValidGraphRun } = require('./graph-run');
const { DIGEST_PATTERN, ID_PATTERN } = require('./validation');

const GRAPH_JOURNAL_VERSION = '0.1';
const GRAPH_JOURNAL_KIND = 'operation_graph_journal_entry';
const GRAPH_EVENT_TYPES = Object.freeze([
  'initialized', 'node_transition', 'edge_decision', 'checkpoint',
]);
const GRAPH_JOURNAL_FIELDS = Object.freeze([
  'journal_version', 'kind', 'sequence', 'recorded_at', 'event_type',
  'run_id', 'graph_id', 'graph_digest', 'run_digest', 'run_snapshot',
  'previous_hash', 'entry_hash',
]);
const ENTRY_PATTERN = /^(\d{8})\.json$/;

class GraphJournalCorruptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GraphJournalCorruptionError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactFields(value) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...GRAPH_JOURNAL_FIELDS].sort());
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validateGraphJournalEntry(graph, entry, options = {}) {
  const errors = [];
  if (!exactFields(entry)) return ['graph journal entry fields must exactly match the privacy allowlist'];
  if (entry.journal_version !== GRAPH_JOURNAL_VERSION) errors.push('journal_version must be ' + GRAPH_JOURNAL_VERSION);
  if (entry.kind !== GRAPH_JOURNAL_KIND) errors.push('kind must be ' + GRAPH_JOURNAL_KIND);
  if (!Number.isInteger(entry.sequence) || entry.sequence < 1) errors.push('sequence must be a positive integer');
  if (!canonicalTimestamp(entry.recorded_at)) errors.push('recorded_at must be a canonical ISO timestamp');
  if (!GRAPH_EVENT_TYPES.includes(entry.event_type)) errors.push('event_type is invalid');
  for (const field of ['run_id', 'graph_id']) {
    if (typeof entry[field] !== 'string' || !ID_PATTERN.test(entry[field])) errors.push(field + ' is invalid');
  }
  for (const field of ['graph_digest', 'run_digest']) {
    if (typeof entry[field] !== 'string' || !DIGEST_PATTERN.test(entry[field])) errors.push(field + ' must be a sha256 digest');
  }
  if (entry.previous_hash !== null
      && (typeof entry.previous_hash !== 'string' || !DIGEST_PATTERN.test(entry.previous_hash))) {
    errors.push('previous_hash must be null or a sha256 digest');
  }
  if (typeof entry.entry_hash !== 'string' || !DIGEST_PATTERN.test(entry.entry_hash)) {
    errors.push('entry_hash must be a sha256 digest');
  }
  if (!isPlainObject(entry.run_snapshot)) errors.push('run_snapshot must be a plain object');
  else {
    try { assertValidGraphRun(graph, entry.run_snapshot); } catch (error) { errors.push(error.message); }
    if (entry.run_id !== entry.run_snapshot.run_id) errors.push('run_id does not match snapshot');
    if (entry.graph_id !== entry.run_snapshot.graph_id) errors.push('graph_id does not match snapshot');
    if (entry.graph_digest !== entry.run_snapshot.graph_digest) errors.push('graph_digest does not match snapshot');
    if (entry.run_digest !== sha256Digest(entry.run_snapshot)) errors.push('run_digest does not match snapshot');
    if (canonicalTimestamp(entry.recorded_at) && entry.run_snapshot.updated_at !== entry.recorded_at) {
      errors.push('snapshot updated_at must match recorded_at');
    }
  }
  const unsigned = { ...entry };
  delete unsigned.entry_hash;
  if (entry.entry_hash !== sha256Digest(unsigned)) errors.push('entry_hash does not match canonical entry content');
  if ('expectedSequence' in options && entry.sequence !== options.expectedSequence) errors.push('journal sequence is not contiguous');
  if ('expectedPreviousHash' in options && entry.previous_hash !== options.expectedPreviousHash) errors.push('journal hash chain is broken');
  if (options.previousEntry) {
    const previous = options.previousEntry;
    if (entry.run_id !== previous.run_id) errors.push('journal cannot change run_id');
    if (entry.graph_digest !== previous.graph_digest) errors.push('journal cannot change graph_digest');
    if (entry.run_snapshot.created_at !== previous.run_snapshot.created_at) errors.push('journal cannot change created_at');
    if (Date.parse(entry.recorded_at) < Date.parse(previous.recorded_at)) errors.push('journal timestamps must be monotonic');
    if (entry.run_snapshot.scheduler_state.transition_count
        < previous.run_snapshot.scheduler_state.transition_count) errors.push('transition_count cannot decrease');
    if (entry.run_snapshot.scheduler_state.total_attempts
        < previous.run_snapshot.scheduler_state.total_attempts) errors.push('total_attempts cannot decrease');
    const previousTokens = previous.run_snapshot.traversal_tokens;
    const nextTokens = entry.run_snapshot.traversal_tokens;
    if (nextTokens.length < previousTokens.length) errors.push('traversal token history cannot shrink');
    for (let index = 0; index < previousTokens.length && index < nextTokens.length; index++) {
      const before = previousTokens[index];
      const after = nextTokens[index];
      for (const field of ['token_id', 'node_id', 'visit']) {
        if (before[field] !== after[field]) errors.push('traversal token identity cannot change: ' + before.token_id);
      }
      for (const field of ['parent_token_ids', 'via_edge_ids']) {
        if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
          errors.push('traversal token lineage cannot change: ' + before.token_id);
        }
      }
      if (before.status !== after.status) {
        const allowed = before.status === 'pending' && after.status === 'running'
          || before.status === 'running' && ['passed', 'failed', 'blocked', 'unknown'].includes(after.status)
          || before.status === 'blocked' && after.status === 'running';
        if (!allowed) errors.push('invalid traversal token status transition: ' + before.token_id);
      }
    }
  }
  return errors;
}

function entryFiles(journalDir) {
  if (!fs.existsSync(journalDir)) return [];
  return fs.readdirSync(journalDir).filter((name) => ENTRY_PATTERN.test(name)).sort();
}

function readGraphRunJournal(journalDir, graph) {
  const files = entryFiles(journalDir);
  const entries = [];
  let previousHash = null;
  let previousEntry = null;
  files.forEach((name, index) => {
    const fileSequence = Number(name.match(ENTRY_PATTERN)[1]);
    if (fileSequence !== index + 1) {
      throw new GraphJournalCorruptionError('SEQUENCE_GAP', 'Graph journal sequence is not contiguous');
    }
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(journalDir, name), 'utf8'));
    } catch (_error) {
      throw new GraphJournalCorruptionError('INVALID_JSON', 'Graph journal entry is not valid JSON');
    }
    const errors = validateGraphJournalEntry(graph, entry, {
      expectedSequence: index + 1,
      expectedPreviousHash: previousHash,
      previousEntry,
    });
    if (errors.length) throw new GraphJournalCorruptionError('INVALID_ENTRY', errors.join('; '));
    entries.push(Object.freeze(entry));
    previousHash = entry.entry_hash;
    previousEntry = entry;
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    latest_run: entries.length ? entries[entries.length - 1].run_snapshot : null,
    head_hash: previousHash,
    next_sequence: entries.length + 1,
  });
}

function acquireLock(journalDir) {
  fs.mkdirSync(journalDir, { recursive: true });
  const lockPath = path.join(journalDir, '.graph-append.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(descriptor, String(process.pid) + '\n', 'utf8');
    fs.fsyncSync(descriptor);
  } catch (_error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    throw new Error('Graph journal append is already locked');
  }
  fs.closeSync(descriptor);
  return lockPath;
}

function atomicWrite(target, content) {
  const temporary = path.join(path.dirname(target),
    '.' + path.basename(target) + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.existsSync(target)) throw new Error('Graph journal sequence already exists');
    fs.renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function appendGraphRunSnapshot(journalDir, graph, run, eventType, options = {}) {
  assertValidGraphRun(graph, run);
  if (!GRAPH_EVENT_TYPES.includes(eventType)) throw new Error('event_type is invalid');
  const lockPath = acquireLock(journalDir);
  try {
    const journal = readGraphRunJournal(journalDir, graph);
    if (eventType === 'initialized' && journal.entries.length) throw new Error('Graph run is already initialized');
    if (eventType !== 'initialized' && !journal.entries.length) throw new Error('Graph run must be initialized first');
    if (journal.latest_run && journal.latest_run.run_id !== run.run_id) throw new Error('Graph journal cannot mix run ids');
    const recordedAt = options.now || run.updated_at;
    if (recordedAt !== run.updated_at) throw new Error('journal time must match run updated_at');
    const unsigned = {
      journal_version: GRAPH_JOURNAL_VERSION,
      kind: GRAPH_JOURNAL_KIND,
      sequence: journal.next_sequence,
      recorded_at: recordedAt,
      event_type: eventType,
      run_id: run.run_id,
      graph_id: run.graph_id,
      graph_digest: run.graph_digest,
      run_digest: sha256Digest(run),
      run_snapshot: run,
      previous_hash: journal.head_hash,
    };
    const entry = { ...unsigned, entry_hash: sha256Digest(unsigned) };
    const errors = validateGraphJournalEntry(graph, entry, {
      expectedSequence: journal.next_sequence,
      expectedPreviousHash: journal.head_hash,
      previousEntry: journal.entries.length ? journal.entries[journal.entries.length - 1] : null,
    });
    if (errors.length) throw new TypeError('Invalid graph journal entry: ' + errors.join('; '));
    const target = path.join(journalDir, String(entry.sequence).padStart(8, '0') + '.json');
    atomicWrite(target, canonicalSerialize(entry) + '\n');
    return Object.freeze(entry);
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

function planGraphRunRecovery(journalDir, graph) {
  let journal;
  try {
    journal = readGraphRunJournal(journalDir, graph);
  } catch (error) {
    if (!(error instanceof GraphJournalCorruptionError)) throw error;
    return Object.freeze({
      status: 'blocked',
      journal_status: 'corrupt',
      reason_code: 'GRAPH_JOURNAL_CORRUPT',
      run: null,
      in_flight_node_ids: Object.freeze([]),
    });
  }
  if (!journal.latest_run) {
    return Object.freeze({
      status: 'empty', journal_status: 'verified', reason_code: 'GRAPH_RUN_NOT_INITIALIZED',
      run: null, in_flight_node_ids: Object.freeze([]),
    });
  }
  const run = journal.latest_run;
  const inFlight = Object.entries(run.scheduler_state.node_statuses)
    .filter(([, status]) => status === 'running').map(([nodeId]) => nodeId);
  if (inFlight.length) {
    return Object.freeze({
      status: 'blocked',
      journal_status: 'verified',
      reason_code: 'IN_FLIGHT_NODE_REQUIRES_EFFECT_RECOVERY',
      run,
      in_flight_node_ids: Object.freeze(inFlight),
    });
  }
  const complete = run.status === 'passed';
  const blocked = TERMINAL_BLOCKING_STATUSES.includes(run.status);
  return Object.freeze({
    status: complete ? 'complete' : blocked ? 'blocked' : 'ready',
    journal_status: 'verified',
    reason_code: complete ? 'GRAPH_RUN_COMPLETE' : blocked ? 'GRAPH_RUN_BLOCKED' : 'GRAPH_RUN_RESUMABLE',
    run,
    in_flight_node_ids: Object.freeze([]),
  });
}

const TERMINAL_BLOCKING_STATUSES = Object.freeze(['failed', 'blocked', 'unknown']);

module.exports = Object.freeze({
  GRAPH_EVENT_TYPES,
  GRAPH_JOURNAL_FIELDS,
  GRAPH_JOURNAL_KIND,
  GRAPH_JOURNAL_VERSION,
  GraphJournalCorruptionError,
  appendGraphRunSnapshot,
  planGraphRunRecovery,
  readGraphRunJournal,
  validateGraphJournalEntry,
});

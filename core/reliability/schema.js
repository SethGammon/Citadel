'use strict';

const RECORD_FIELDS = Object.freeze([
  'schema', 'kind', 'run_id', 'repo_id', 'runtime', 'workload_class',
  'execution_mode', 'complexity', 'outcome', 'verified', 'human_interventions',
  'duration_ms', 'estimated_cost_microusd', 'resumed', 'held_out',
]);
const RUNTIMES = Object.freeze(['claude-code', 'codex', 'github-actions', 'local']);
const WORKLOAD_CLASSES = Object.freeze(['verify', 'repair', 'migrate', 'release', 'other']);
const EXECUTION_MODES = Object.freeze(['sequential', 'parallel']);
const COMPLEXITIES = Object.freeze(['low', 'medium', 'high']);
const OUTCOMES = Object.freeze(['passed', 'failed', 'blocked', 'unknown']);
const RUN_ID = /^run-[a-f0-9]{16,64}$/;
const REPO_ID = /^repo-[a-f0-9]{16,64}$/;

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function validateRecord(record) {
  const errors = [];
  if (!plain(record)) return ['record must be a plain object'];
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...RECORD_FIELDS].sort())) {
    errors.push('record fields must exactly match the privacy-safe allowlist');
  }
  if (record.schema !== 1) errors.push('schema must be 1');
  if (record.kind !== 'reliability_run') errors.push('kind must be reliability_run');
  if (typeof record.run_id !== 'string' || !RUN_ID.test(record.run_id)) errors.push('run_id must be an opaque hexadecimal ID');
  if (typeof record.repo_id !== 'string' || !REPO_ID.test(record.repo_id)) errors.push('repo_id must be an opaque hexadecimal ID');
  if (!RUNTIMES.includes(record.runtime)) errors.push('runtime is unsupported');
  if (!WORKLOAD_CLASSES.includes(record.workload_class)) errors.push('workload_class is unsupported');
  if (!EXECUTION_MODES.includes(record.execution_mode)) errors.push('execution_mode is unsupported');
  if (!COMPLEXITIES.includes(record.complexity)) errors.push('complexity is unsupported');
  if (!OUTCOMES.includes(record.outcome)) errors.push('outcome is unsupported');
  for (const field of ['verified', 'resumed', 'held_out']) {
    if (typeof record[field] !== 'boolean') errors.push(`${field} must be boolean`);
  }
  for (const [field, maximum] of [
    ['human_interventions', 10000], ['duration_ms', 604800000], ['estimated_cost_microusd', 100000000000],
  ]) {
    if (!Number.isInteger(record[field]) || record[field] < 0 || record[field] > maximum) {
      errors.push(`${field} must be a bounded non-negative integer`);
    }
  }
  if (record.verified && record.outcome !== 'passed') errors.push('verified can be true only for passed outcomes');
  return errors;
}

function assertValidRecord(record) {
  const errors = validateRecord(record);
  if (errors.length) throw new TypeError(`Invalid reliability record: ${errors.join('; ')}`);
  return record;
}

function parseJsonl(raw) {
  const records = String(raw).split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    let record;
    try { record = JSON.parse(line); }
    catch { throw new TypeError(`Invalid reliability record at line ${index + 1}: invalid JSON`); }
    try { return assertValidRecord(record); }
    catch (error) { throw new TypeError(`Invalid reliability record at line ${index + 1}: ${error.message}`); }
  });
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.run_id)) throw new TypeError(`Duplicate reliability run_id: ${record.run_id}`);
    ids.add(record.run_id);
  }
  return records;
}

module.exports = Object.freeze({
  COMPLEXITIES,
  EXECUTION_MODES,
  OUTCOMES,
  RECORD_FIELDS,
  REPO_ID,
  RUNTIMES,
  RUN_ID,
  WORKLOAD_CLASSES,
  assertValidRecord,
  parseJsonl,
  validateRecord,
});

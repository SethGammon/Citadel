#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments', 'fleet-ablation', 'manifest.json');
const DEFAULT_OUTPUT = path.join(ROOT, '.planning', 'research', 'citadel-proof-experiments');
const FILES = Object.freeze({
  serial: 'fleet-ablation-serial.json',
  parallel: 'fleet-ablation-parallel.json',
  results: 'fleet-ablation-results.json',
  report: 'fleet-ablation-report.md',
});
const RAW_KEYS = Object.freeze([
  'schema', 'kind', 'suite_id', 'arm', 'mode', 'started_at', 'completed_at', 'identity',
  'checkout', 'worktrees', 'agent_count', 'interventions', 'rework_cycles', 'scope_conflicts',
  'merge_conflicts', 'tokens', 'cost_usd', 'telemetry_status',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeIfChanged(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return 'unchanged';
  fs.writeFileSync(file, text, 'utf8');
  return 'written';
}

function writeJson(file, value) {
  return writeIfChanged(file, `${JSON.stringify(value, null, 2)}\n`);
}

function manifest() {
  const value = readJson(MANIFEST_PATH);
  assert.deepStrictEqual(Object.keys(value).sort(), ['claim_boundary', 'created_at', 'kind', 'schema', 'suite_id', 'tasks', 'verifier'].sort());
  ensure(value.schema === 1 && value.kind === 'citadel_fleet_ablation_suite', 'suite contract is invalid');
  ensure(value.tasks.length === 2 && new Set(value.tasks.map((task) => task.id)).size === 2, 'suite must contain two distinct tasks');
  ensure(value.verifier === 'node test.js', 'verifier drifted');
  return value;
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateIdentity(identity) {
  assert.deepStrictEqual(Object.keys(identity).sort(), ['provider', 'model', 'model_family', 'runtime', 'runtime_version'].sort());
  for (const value of Object.values(identity)) ensure(typeof value === 'string' && value.length > 0, 'identity field is missing');
}

function runVerifier(checkout) {
  const result = spawnSync(process.execPath, ['test.js'], { cwd: checkout, encoding: 'utf8', timeout: 30000 });
  return {
    command: 'node test.js',
    exit_code: result.status,
    stdout_sha256: digest(result.stdout || ''),
    stderr_sha256: digest(result.stderr || ''),
  };
}

function sourceDigest(checkout) {
  return digest({
    slugify: fs.readFileSync(path.join(checkout, 'src', 'slugify.js'), 'utf8'),
    duration: fs.readFileSync(path.join(checkout, 'src', 'duration.js'), 'utf8'),
    test: fs.readFileSync(path.join(checkout, 'test.js'), 'utf8'),
  });
}

function gitHead(checkout) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' });
  ensure(result.status === 0, `checkout is not a git repository: ${checkout}`);
  return result.stdout.trim();
}

function validateRaw(raw) {
  assert.deepStrictEqual(Object.keys(raw).sort(), [...RAW_KEYS].sort());
  ensure(raw.schema === 1 && raw.kind === 'citadel_fleet_ablation_observation', 'observation contract is invalid');
  ensure(['serial', 'parallel'].includes(raw.arm), 'arm is invalid');
  ensure(raw.mode === (raw.arm === 'serial' ? 'serial_shared_checkout' : 'isolated_parallel_worktrees'), 'mode does not match arm');
  ensure(validTime(raw.started_at) && validTime(raw.completed_at) && Date.parse(raw.completed_at) >= Date.parse(raw.started_at), 'timestamps are invalid');
  validateIdentity(raw.identity);
  ensure(Number.isInteger(raw.agent_count) && raw.agent_count === 2, 'both arms require two agents');
  for (const field of ['interventions', 'rework_cycles', 'scope_conflicts', 'merge_conflicts']) ensure(Number.isInteger(raw[field]) && raw[field] >= 0, `${field} is invalid`);
  ensure(raw.tokens === null || (Number.isInteger(raw.tokens) && raw.tokens >= 0), 'tokens are invalid');
  ensure(raw.cost_usd === null || (typeof raw.cost_usd === 'number' && raw.cost_usd >= 0), 'cost is invalid');
  ensure(['observed', 'unavailable'].includes(raw.telemetry_status), 'telemetry status is invalid');
  if (raw.telemetry_status === 'unavailable') ensure(raw.tokens === null && raw.cost_usd === null, 'unavailable telemetry must remain null');
  ensure(path.isAbsolute(raw.checkout) && fs.existsSync(raw.checkout), 'checkout path is missing');
  ensure(Array.isArray(raw.worktrees), 'worktrees must be an array');
  if (raw.arm === 'serial') ensure(raw.worktrees.length === 0, 'serial arm cannot claim worktree isolation');
  if (raw.arm === 'parallel') {
    ensure(raw.worktrees.length === 2, 'parallel arm requires two worktrees');
    const roots = new Set(raw.worktrees.map((entry) => fs.realpathSync(entry)));
    ensure(roots.size === 2 && !roots.has(fs.realpathSync(raw.checkout)), 'parallel worktrees are not isolated');
    for (const entry of roots) ensure(fs.existsSync(path.join(entry, '.git')), `missing worktree git link: ${entry}`);
  }
  return raw;
}

function projection(record) {
  const copy = { ...record };
  delete copy.receipt_digest;
  return copy;
}

function observe(options = {}) {
  ensure(options.input && options.output, 'observe requires --input and --output');
  const raw = validateRaw(readJson(path.resolve(options.input)));
  const suite = manifest();
  ensure(raw.suite_id === suite.suite_id, 'suite id mismatch');
  const verifier = runVerifier(raw.checkout);
  const base = {
    ...raw,
    manifest_sha256: digest(suite),
    wall_time_ms: Date.parse(raw.completed_at) - Date.parse(raw.started_at),
    checkout_head: gitHead(raw.checkout),
    source_tree_sha256: sourceDigest(raw.checkout),
    isolation_verified: raw.arm === 'parallel' ? true : null,
    verifier,
    accepted: verifier.exit_code === 0,
  };
  const record = { ...base, receipt_digest: digest(base) };
  writeJson(path.resolve(options.output), record);
  return record;
}

function validateRecord(record) {
  const extra = ['manifest_sha256', 'wall_time_ms', 'checkout_head', 'source_tree_sha256', 'isolation_verified', 'verifier', 'accepted', 'receipt_digest'];
  assert.deepStrictEqual(Object.keys(record).sort(), [...RAW_KEYS, ...extra].sort(), 'record fields changed');
  validateRaw(Object.fromEntries(RAW_KEYS.map((key) => [key, record[key]])));
  ensure(record.receipt_digest === digest(projection(record)), 'record receipt mismatch');
  ensure(record.manifest_sha256 === digest(manifest()), 'record manifest mismatch');
  ensure(record.verifier.command === 'node test.js', 'verifier command drifted');
  ensure(record.accepted === (record.verifier.exit_code === 0), 'accepted outcome mismatch');
  if (record.arm === 'parallel') ensure(record.isolation_verified === true, 'parallel isolation was not verified');
  return record;
}

function resultProjection(result) {
  const copy = { ...result };
  delete copy.receipt_digest;
  return copy;
}

function buildResults(serial, parallel) {
  validateRecord(serial);
  validateRecord(parallel);
  ensure(serial.arm === 'serial' && parallel.arm === 'parallel', 'records are assigned to the wrong arms');
  ensure(JSON.stringify(serial.identity) === JSON.stringify(parallel.identity), 'provider/model/runtime identity differs between arms');
  const wallImprovement = serial.wall_time_ms === 0 ? null : (serial.wall_time_ms - parallel.wall_time_ms) / serial.wall_time_ms;
  const interventionImprovement = serial.interventions === 0 ? null : (serial.interventions - parallel.interventions) / serial.interventions;
  const gates = {
    accepted_noninferior: parallel.accepted && serial.accepted,
    identity_matched: true,
    isolation_verified: parallel.isolation_verified === true,
    additional_regressions: parallel.verifier.exit_code === 0,
    wall_or_intervention_improvement: (wallImprovement !== null && wallImprovement >= 0.15)
      || (interventionImprovement !== null && interventionImprovement >= 0.25),
  };
  const base = {
    schema: 1,
    kind: 'citadel_fleet_ablation_results',
    suite_id: serial.suite_id,
    reported_at: [serial.completed_at, parallel.completed_at].sort().at(-1),
    observation_status: 'observed',
    claim_status: 'instrument_only',
    promotion_status: 'blocked_external',
    source_receipts: { serial: serial.receipt_digest, parallel: parallel.receipt_digest },
    metrics: {
      serial: { accepted: serial.accepted, wall_time_ms: serial.wall_time_ms, interventions: serial.interventions, rework_cycles: serial.rework_cycles, scope_conflicts: serial.scope_conflicts, merge_conflicts: serial.merge_conflicts, tokens: serial.tokens, cost_usd: serial.cost_usd },
      parallel: { accepted: parallel.accepted, wall_time_ms: parallel.wall_time_ms, interventions: parallel.interventions, rework_cycles: parallel.rework_cycles, scope_conflicts: parallel.scope_conflicts, merge_conflicts: parallel.merge_conflicts, tokens: parallel.tokens, cost_usd: parallel.cost_usd },
      wall_time_improvement: wallImprovement,
      intervention_improvement: interventionImprovement,
    },
    gates,
    external_promotion_gates: {
      repeated_suites: false,
      external_task_selection: false,
      accepted_outcomes_externally_verified: false,
      token_and_cost_telemetry_observed: serial.telemetry_status === 'observed' && parallel.telemetry_status === 'observed',
      preregistered_metric_gate_passed: gates.wall_or_intervention_improvement,
    },
    claim_boundary: manifest().claim_boundary,
  };
  return { ...base, receipt_digest: digest(base) };
}

function reportMarkdown(result) {
  return [
    '# Fleet isolation ablation', '',
    `Outcome: ${result.promotion_status}`, '',
    '| Arm | Accepted | Wall time ms | Interventions | Merge conflicts | Cost USD |',
    '|---|---:|---:|---:|---:|---:|',
    `| Serial | ${result.metrics.serial.accepted} | ${result.metrics.serial.wall_time_ms} | ${result.metrics.serial.interventions} | ${result.metrics.serial.merge_conflicts} | ${result.metrics.serial.cost_usd ?? 'unknown'} |`,
    `| Isolated parallel | ${result.metrics.parallel.accepted} | ${result.metrics.parallel.wall_time_ms} | ${result.metrics.parallel.interventions} | ${result.metrics.parallel.merge_conflicts} | ${result.metrics.parallel.cost_usd ?? 'unknown'} |`,
    '', `Wall-time improvement: ${result.metrics.wall_time_improvement === null ? 'unknown' : result.metrics.wall_time_improvement}.`,
    '', `Boundary: ${result.claim_boundary}`, '',
  ].join('\n');
}

function report(options = {}) {
  ensure(options.serial && options.parallel, 'report requires --serial and --parallel');
  const result = buildResults(readJson(path.resolve(options.serial)), readJson(path.resolve(options.parallel)));
  const output = path.resolve(options.output || DEFAULT_OUTPUT);
  writeJson(path.join(output, FILES.results), result);
  writeIfChanged(path.join(output, FILES.report), reportMarkdown(result));
  return result;
}

function verify(options = {}) {
  const output = path.resolve(options.output || DEFAULT_OUTPUT);
  const serial = validateRecord(readJson(path.join(output, FILES.serial)));
  const parallel = validateRecord(readJson(path.join(output, FILES.parallel)));
  ensure(runVerifier(serial.checkout).exit_code === 0, 'serial accepted outcome no longer verifies');
  ensure(runVerifier(parallel.checkout).exit_code === 0, 'parallel accepted outcome no longer verifies');
  const expected = buildResults(serial, parallel);
  const stored = readJson(path.join(output, FILES.results));
  assert.deepStrictEqual(stored, expected, 'stored Fleet report drifted');
  ensure(fs.readFileSync(path.join(output, FILES.report), 'utf8') === reportMarkdown(expected), 'Fleet Markdown report drifted');
  return { instrument_status: 'passed', claim_status: stored.claim_status, promotion_status: stored.promotion_status, metrics: stored.metrics, gates: stored.gates, remaining_external_gates: Object.entries(stored.external_promotion_gates).filter(([, value]) => !value).map(([key]) => key), receipt_digest: stored.receipt_digest };
}

function parseArgs(argv) {
  ensure(argv.length > 0, 'Usage: experiment-fleet-ablation.js <observe|report|verify> [options]');
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    ensure(/^--(?:input|output|serial|parallel)$/.test(flag || '') && value, `invalid argument ${flag || '<missing>'}`);
    options[flag.slice(2)] = value;
  }
  return { command: argv[0], options };
}

function cli(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  const result = command === 'observe' ? observe(options) : command === 'report' ? report(options) : command === 'verify' ? verify(options) : null;
  ensure(result, `unknown command ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { cli(); } catch (error) { process.stderr.write(`Fleet ablation failed: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = Object.freeze({ FILES, buildResults, digest, manifest, observe, report, validateRecord, validateRaw, verify });

#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_DIR = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments');
const MANIFEST_PATH = path.join(CONTRACT_DIR, 'experiment-manifest.json');
const BASELINE_PATH = path.join(CONTRACT_DIR, 'bloat-baseline.json');
const EXPERIMENT_IDS = Object.freeze([
  'operation-recovery',
  'safety-gates',
  'judge-eval',
  'fleet-ablation',
  'real-user-proof-v2',
  'deploy-steward',
  'package-bloat',
]);
const LOCAL_STATES = new Set(['local', 'local_with_external_promotion', 'external']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function contractProjection(manifest) {
  return {
    schema: manifest.schema,
    kind: manifest.kind,
    experiment_ids: manifest.experiment_ids,
    experiments: manifest.experiments,
    publication_rule: manifest.publication_rule,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateManifest(manifest) {
  assert(manifest && manifest.schema === 1, 'manifest schema must be 1');
  assert(manifest.kind === 'citadel_proof_experiment_manifest', 'manifest kind is invalid');
  assert(JSON.stringify(manifest.experiment_ids) === JSON.stringify(EXPERIMENT_IDS), 'experiment ids or order changed');
  assert(Array.isArray(manifest.experiments) && manifest.experiments.length === EXPERIMENT_IDS.length, 'manifest must define seven experiments');
  const ids = manifest.experiments.map((entry) => entry.id);
  assert(JSON.stringify(ids) === JSON.stringify(EXPERIMENT_IDS), 'experiment definitions do not match the frozen ids');
  for (const entry of manifest.experiments) {
    assert(typeof entry.claim === 'string' && entry.claim.length > 20, `${entry.id}: falsifiable claim is required`);
    assert(entry.control && entry.treatment, `${entry.id}: control and treatment are required`);
    assert(Array.isArray(entry.metrics) && entry.metrics.length > 0, `${entry.id}: metrics are required`);
    assert(Array.isArray(entry.gates) && entry.gates.length > 0, `${entry.id}: gates are required`);
    assert(LOCAL_STATES.has(entry.execution), `${entry.id}: execution classification is invalid`);
    assert(Array.isArray(entry.external_dependencies), `${entry.id}: external dependencies must be explicit`);
    assert(Array.isArray(entry.invalid_substitutions), `${entry.id}: invalid substitutions must be explicit`);
  }
  assert(manifest.publication_rule === 'Only observed gates may support public claims; missing external evidence remains unknown or blocked.', 'publication rule changed');
  assert(manifest.contract_sha256 === digest(contractProjection(manifest)), 'manifest contract hash mismatch');
  return manifest;
}

function validateBaseline(baseline) {
  assert(baseline && baseline.schema === 1, 'baseline schema must be 1');
  assert(baseline.kind === 'citadel_package_bloat_baseline', 'baseline kind is invalid');
  assert(baseline.source_commit === 'd3aae97446b54696c521710ee8846f2211b276c3', 'baseline source commit changed');
  assert(baseline.npm_pack.file_count === 1954, 'npm pack file count changed');
  assert(baseline.npm_pack.packed_bytes === 9678793, 'npm packed byte baseline changed');
  assert(baseline.npm_pack.unpacked_bytes === 22586511, 'npm unpacked byte baseline changed');
  assert(baseline.guardrails.runtime_install_smoke === true, 'runtime smoke guardrail is required');
  assert(baseline.guardrails.offline_evidence_replay === true, 'offline evidence guardrail is required');
  assert(baseline.accounting.runtime_and_total_published_bytes === true, 'split-package accounting guardrail is required');
  return baseline;
}

function verify() {
  const manifest = validateManifest(readJson(MANIFEST_PATH));
  const baseline = validateBaseline(readJson(BASELINE_PATH));
  return {
    outcome: 'passed',
    experiments: manifest.experiments.length,
    contract_sha256: manifest.contract_sha256,
    npm_pack: baseline.npm_pack,
    claim_status: 'contracts_and_baseline_only',
  };
}

function run(argv = process.argv.slice(2)) {
  if (argv[0] !== 'verify') throw new Error('Usage: node scripts/experiment-contracts.js verify');
  const result = verify();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`Experiment contract verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ contractProjection, digest, validateBaseline, validateManifest, verify });

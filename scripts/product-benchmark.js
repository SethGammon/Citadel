#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadFreeze, loadScenarios, metricSetIdentity, scenarioSetIdentity } = require('../core/benchmark/contract');
const { attestRun, buildReport } = require('../core/benchmark/report');
const { generateFixtureRuns, runScenario } = require('../core/benchmark/runner');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SCENARIOS = path.join(ROOT, 'benchmarks', 'product-proof', 'scenarios');
const DEFAULT_FREEZE = path.join(ROOT, 'benchmarks', 'product-proof', 'freeze.json');

function args(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) parsed._.push(token);
    else {
      const key = token.slice(2);
      const next = argv[index + 1];
      parsed[key] = next && !next.startsWith('--') ? argv[++index] : true;
    }
  }
  return parsed;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonl(file, values) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8');
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function main() {
  const options = args(process.argv.slice(2));
  const command = options._[0] || 'validate';
  if (options.scenarios || options.freeze) throw new Error('publishable benchmark commands use only the checked-in scenario and freeze records');
  const scenarios = loadScenarios(DEFAULT_SCENARIOS);
  const freeze = loadFreeze(DEFAULT_FREEZE, scenarios);
  if (command === 'validate') {
    process.stdout.write(`${JSON.stringify({
      valid: true,
      scenario_count: scenarios.length,
      scenario_set_id: scenarioSetIdentity(scenarios),
      metric_set_id: metricSetIdentity(),
    }, null, 2)}\n`);
    return;
  }
  if (command === 'fixture') {
    if (!options.output) throw new Error('fixture requires --output');
    const repetitions = Number(options.repetitions || 3);
    const runs = generateFixtureRuns(scenarios, repetitions);
    writeJsonl(options.output, runs);
    process.stdout.write(`Wrote ${runs.length} fixture/simulation runs to ${options.output}\n`);
    return;
  }
  if (command === 'report') {
    if (!options.input || !options.output) throw new Error('report requires --input and --output');
    const report = buildReport(readJsonl(options.input), { freeze, scenarios });
    writeJson(options.output, report);
    process.stdout.write(`Wrote ${report.evidence_kind} report (${report.utility_gate.status}) to ${options.output}\n`);
    return;
  }
  if (command === 'run') {
    for (const required of ['scenario', 'mode', 'repetition', 'executor-file', 'output', 'signing-key']) {
      if (!options[required]) throw new Error(`run requires --${required}`);
    }
    if (!freeze.external_scenario || !freeze.attestation_public_key) {
      throw new Error('actual runs require a checked-in external scenario selection and attestation public key');
    }
    const scenario = scenarios.find((item) => item.id === options.scenario);
    if (!scenario) throw new Error(`Unknown scenario: ${options.scenario}`);
    const privateKey = fs.readFileSync(path.resolve(options['signing-key']), 'utf8');
    const parsedPrivateKey = crypto.createPrivateKey(privateKey);
    if (parsedPrivateKey.asymmetricKeyType !== 'ed25519') throw new Error('signing key must be Ed25519');
    const derivedPublicKey = crypto.createPublicKey(parsedPrivateKey).export({ type: 'spki', format: 'pem' });
    if (derivedPublicKey.trim() !== freeze.attestation_public_key.trim()) throw new Error('signing key does not match the frozen attestation public key');
    const result = attestRun(runScenario({
      scenario,
      scenarios,
      mode: options.mode,
      repetition: Number(options.repetition),
      executorFile: options['executor-file'],
      citadelVersion: options['citadel-version'] || 'unknown',
    }), privateKey);
    writeJson(options.output, result);
    process.stdout.write(`Wrote actual run to ${options.output}\n`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Product benchmark failed: ${error.message}\n`);
  process.exitCode = 1;
}

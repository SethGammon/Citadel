#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  appendReceipt,
  appendRecord,
  atomicJson,
  buildReport,
  buildSharePreview,
  createPlan,
  loadStore,
  pathsFor,
  purgeStore,
  signReceipt,
  startStore,
  validatePlan,
  validateRecord,
  verifyPinnedReceipt,
  writeReport,
  writeSharePreview,
} = require('../core/product-proof');
const experimentContracts = require('./experiment-contracts');

const EXPERIMENT_ID = 'real-user-proof-v2';
const BINDING_FILE = 'experiment-manifest-binding.json';
const COMMAND_OPTIONS = Object.freeze({
  help: [],
  plan: ['spec', 'experiment-manifest'],
  start: ['spec', 'experiment-manifest'],
  validate: ['spec', 'experiment-manifest'],
  record: ['input', 'experiment-manifest', 'private-key', 'signer', 'assignment'],
  report: ['experiment-manifest'],
  'share-preview': ['experiment-manifest'],
  purge: [],
});

function parseArgs(argv) {
  const options = { _: [], root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    options[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  options.root = path.resolve(options.root);
  return options;
}

function readJson(file, label) {
  if (!file) throw new Error(`--${label} is required`);
  if (typeof file !== 'string') throw new Error(`--${label} requires a file path`);
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function assertKnownOptions(command, options) {
  const commandOptions = COMMAND_OPTIONS[command];
  if (!commandOptions) return;
  if (options._.length > 1) throw new Error(`unexpected argument: ${options._[1]}`);
  const allowed = new Set(['_', 'root', 'help', 'h', ...commandOptions]);
  const unknown = Object.keys(options).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`unknown option: --${unknown}`);
}

function manifestBinding(manifest, protocolId) {
  const validated = experimentContracts.validateManifest(manifest);
  const experiment = validated.experiments.find((entry) => entry.id === EXPERIMENT_ID);
  if (!experiment) throw new Error(`experiment manifest must define ${EXPERIMENT_ID}`);
  return {
    schema: 1,
    kind: 'product_proof_experiment_manifest_binding',
    protocol_id: protocolId,
    experiment_id: EXPERIMENT_ID,
    manifest_sha256: experimentContracts.digest(validated),
    contract_sha256: validated.contract_sha256,
    experiment_sha256: experimentContracts.digest(experiment),
  };
}

function readManifestBindingOption(options, protocolId) {
  if (!options['experiment-manifest']) return null;
  return manifestBinding(readJson(options['experiment-manifest'], 'experiment-manifest'), protocolId);
}

function bindingPath(root) {
  return path.join(pathsFor(root).dir, BINDING_FILE);
}

function verifyStoreBinding(options, store) {
  const file = bindingPath(options.root);
  if (!fs.existsSync(file)) {
    if (options['experiment-manifest']) {
      throw new Error('store has no experiment manifest binding; start a bound store');
    }
    return null;
  }
  if (!options['experiment-manifest']) throw new Error('--experiment-manifest is required for this bound store');
  const actual = JSON.parse(fs.readFileSync(file, 'utf8'));
  const expected = readManifestBindingOption(options, store.protocol.protocol_id);
  if (experimentContracts.digest(actual) !== experimentContracts.digest(expected)) {
    throw new Error('experiment manifest binding mismatch');
  }
  return actual;
}

function loadBoundStore(options) {
  const store = loadStore(options.root);
  return { store, binding: verifyStoreBinding(options, store) };
}

function usage() {
  return [
    'Usage: node scripts/product-proof-trial.js <command> [options]',
    '',
    'Commands:',
    '  validate [--spec FILE] [--root PATH] [--experiment-manifest FILE]',
    '  plan --spec FILE [--experiment-manifest FILE]',
    '  start --spec FILE [--root PATH] [--experiment-manifest FILE]',
    '  record --input FILE [--root PATH] [--experiment-manifest FILE] [--private-key FILE --signer ID --assignment ID]',
    '  report [--root PATH] [--experiment-manifest FILE]',
    '  share-preview [--root PATH] [--experiment-manifest FILE]',
    '  purge [--root PATH]',
    '',
    'The CLI is local-only. share-preview writes a redacted aggregate and never transmits it.',
  ].join('\n');
}

function emit(context, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  (context.stdout || process.stdout).write(text);
  return value;
}

function run(argv = process.argv.slice(2), context = {}) {
  const options = parseArgs(argv);
  const command = options._[0] || 'help';
  assertKnownOptions(command, options);
  if (command === 'help' || options.help || options.h) {
    (context.stdout || process.stdout).write(`${usage()}\n`);
    return { outcome: 'help' };
  }

  if (command === 'plan' || command === 'start') {
    const plan = createPlan(readJson(options.spec, 'spec'));
    const binding = readManifestBindingOption(options, plan.protocol.protocol_id);
    if (command === 'plan') {
      return emit(context, {
        outcome: 'plan_ready',
        wrote_files: false,
        claim_status: 'instrument_only',
        ...(binding ? { experiment_manifest_binding: binding } : {}),
        ...plan,
      });
    }
    const files = startStore(options.root, plan);
    if (binding) atomicJson(path.join(files.dir, BINDING_FILE), binding);
    return emit(context, {
      outcome: 'trial_store_started',
      claim_status: 'instrument_only',
      protocol_id: plan.protocol.protocol_id,
      assignments: plan.assignments.length,
      store: path.relative(options.root, files.dir).replace(/\\/g, '/'),
      ...(binding ? { experiment_manifest_binding: binding } : {}),
    });
  }

  if (command === 'validate') {
    if (options.spec) {
      const plan = createPlan(readJson(options.spec, 'spec'));
      validatePlan(plan.protocol, plan.assignments);
      const binding = readManifestBindingOption(options, plan.protocol.protocol_id);
      return emit(context, {
        outcome: 'spec_valid',
        claim_status: 'instrument_only',
        protocol_id: plan.protocol.protocol_id,
        assignments: plan.assignments.length,
        commitment: plan.protocol.assignment_commitment,
        ...(binding ? { experiment_manifest_binding: binding } : {}),
      });
    }
    const { store, binding } = loadBoundStore(options);
    const report = buildReport(store);
    return emit(context, {
      outcome: 'store_valid',
      claim_status: 'instrument_only',
      protocol_id: store.protocol.protocol_id,
      records: store.records.length,
      receipts: store.receipts.length,
      instrument_status: report.instrument_status,
      ...(binding ? { experiment_manifest_binding: binding } : {}),
    });
  }

  if (command === 'record') {
    const record = validateRecord(readJson(options.input, 'input'));
    const { store } = loadBoundStore(options);
    if (record.protocol_id !== store.protocol.protocol_id) throw new Error('record protocol mismatch');
    let receipt = null;
    if (options['private-key']) {
      const privateKey = fs.readFileSync(path.resolve(options['private-key']), 'utf8');
      receipt = signReceipt([record], privateKey, {
        protocol: store.protocol,
        signer: options.signer || 'local-facilitator',
        assignmentId: options.assignment || record.assignment_id,
      });
      if (!verifyPinnedReceipt(receipt, store.protocol)) {
        throw new Error('signed receipt does not match the protocol signing key');
      }
    }
    appendRecord(options.root, record);
    if (receipt) appendReceipt(options.root, receipt);
    return emit(context, {
      outcome: 'recorded',
      claim_status: 'instrument_only',
      kind: record.kind,
      signed: Boolean(receipt),
    });
  }

  if (command === 'report') {
    const { store, binding } = loadBoundStore(options);
    const report = buildReport(store);
    const output = writeReport(options.root, report);
    return emit(context, {
      ...report,
      report_relative: path.relative(options.root, output).replace(/\\/g, '/'),
      ...(binding ? { experiment_manifest_binding: binding } : {}),
    });
  }

  if (command === 'share-preview') {
    const { store, binding } = loadBoundStore(options);
    const report = buildReport(store);
    const preview = buildSharePreview(report, store.protocol.gates.minimum_public_cell);
    const output = writeSharePreview(options.root, preview);
    return emit(context, {
      ...preview,
      transmitted: false,
      preview_relative: path.relative(options.root, output).replace(/\\/g, '/'),
      ...(binding ? { experiment_manifest_binding: binding } : {}),
    });
  }

  if (command === 'purge') return emit(context, purgeStore(options.root));
  throw new Error(`unknown command: ${command}`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`Product proof trial failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ parseArgs, run, usage });

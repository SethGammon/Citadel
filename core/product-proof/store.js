'use strict';

const fs = require('fs');
const path = require('path');

const { validatePlan } = require('./assignment');
const {
  validateProtocol,
  validateReceipt,
  validateRecord,
} = require('./trial-contract');

function pathsFor(root = process.cwd()) {
  const projectRoot = path.resolve(root);
  const dir = path.join(projectRoot, '.planning', 'product-proof', 'v2');
  const relative = path.relative(projectRoot, dir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('product proof store must remain inside the project root');
  }
  return {
    root: projectRoot,
    dir,
    protocol: path.join(dir, 'protocol.json'),
    assignments: path.join(dir, 'assignments.json'),
    records: path.join(dir, 'records.jsonl'),
    receipts: path.join(dir, 'receipts.jsonl'),
    report: path.join(dir, 'report.json'),
    sharePreview: path.join(dir, 'share-preview.json'),
  };
}

function atomicJson(file, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === serialized) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, serialized, 'utf8');
  fs.renameSync(temp, file);
}

function startStore(root, plan) {
  const files = pathsFor(root);
  validatePlan(plan.protocol, plan.assignments);
  if (fs.existsSync(files.protocol) || fs.existsSync(files.assignments)) {
    throw new Error('a product proof v2 store already exists; purge it explicitly before replacing');
  }
  fs.mkdirSync(files.dir, { recursive: true });
  atomicJson(files.protocol, plan.protocol);
  atomicJson(files.assignments, plan.assignments);
  return files;
}

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} is missing`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${path.basename(file)} line ${index + 1} is invalid JSON`); }
  });
}

function loadStore(root = process.cwd()) {
  const files = pathsFor(root);
  const protocol = validateProtocol(readJson(files.protocol, 'protocol'));
  const assignments = readJson(files.assignments, 'assignments');
  validatePlan(protocol, assignments);
  const records = readJsonl(files.records).map(validateRecord);
  const receipts = readJsonl(files.receipts).map((receipt) => validateReceipt(receipt, { protocol }));
  return { files, protocol, assignments, records, receipts };
}

function appendLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

function appendRecord(root, record) {
  const store = loadStore(root);
  validateRecord(record);
  if (record.protocol_id !== store.protocol.protocol_id) throw new Error('record protocol mismatch');
  appendLine(store.files.records, record);
  return record;
}

function appendReceipt(root, receipt) {
  const store = loadStore(root);
  validateReceipt(receipt, { protocol: store.protocol });
  appendLine(store.files.receipts, receipt);
  return receipt;
}

function writeReport(root, report) {
  const files = pathsFor(root);
  atomicJson(files.report, report);
  return files.report;
}

function writeSharePreview(root, preview) {
  const files = pathsFor(root);
  atomicJson(files.sharePreview, preview);
  return files.sharePreview;
}

function countFiles(directory) {
  if (!fs.existsSync(directory)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countFiles(target);
    else count += 1;
  }
  return count;
}

function purgeStore(root = process.cwd()) {
  const files = pathsFor(root);
  const removedFiles = countFiles(files.dir);
  if (fs.existsSync(files.dir)) fs.rmSync(files.dir, { recursive: true, force: false });
  return {
    outcome: removedFiles ? 'purged' : 'already_absent',
    removed_files: removedFiles,
    store_relative: '.planning/product-proof/v2',
  };
}

module.exports = Object.freeze({
  appendReceipt,
  appendRecord,
  atomicJson,
  loadStore,
  pathsFor,
  purgeStore,
  startStore,
  writeReport,
  writeSharePreview,
});

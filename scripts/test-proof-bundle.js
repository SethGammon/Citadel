#!/usr/bin/env node

'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ledgerFromBundle, renderMarkdown } = require('../core/proof');
const { validateRecord } = require('../core/proof/schema');
const { build, parseArgs } = require('./proof-bundle');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'proof-bundles', 'reference');
let passed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

function withTemp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-proof-bundle-'));
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function copyFixture(temp) {
  const target = path.join(temp, 'bundle');
  fs.cpSync(FIXTURE, target, { recursive: true });
  return target;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

test('strict fixture ledger verifies all receipts and preserves every outcome', () => {
  const ledger = ledgerFromBundle(FIXTURE, { strict: true });
  assert.equal(ledger.denominators.all_records, 4);
  assert.equal(ledger.denominators.verified_receipts, 4);
  assert.deepEqual(ledger.denominators.classifications, { fixture: 4, maintainer: 0, independent: 0 });
  assert.deepEqual(Object.fromEntries(Object.entries(ledger.denominators.outcomes).map(([key, value]) => [key, value.numerator])), {
    passed: 1, failed: 1, blocked: 1, unknown: 1,
  });
  assert(ledger.records.every((record) => record.classification === 'fixture' && record.trust_state === 'verified'));
});

test('public projection omits private paths, provenance, signer identity, and embedded keys', () => {
  const ledger = ledgerFromBundle(FIXTURE, { strict: true });
  const publicJson = JSON.stringify(ledger);
  for (const prohibited of ['receipt_path', 'provenance', 'issuer_id', 'public_key_spki_base64', 'signature_base64',
    'discussioncomment-', 'C:\\', '/home/', '/tmp/', 'prompt', 'source_code', 'token']) {
    assert(!publicJson.includes(prohibited), `public ledger contains ${prohibited}`);
  }
});

test('build output is deterministic', () => {
  const one = build({ bundle: FIXTURE, strict: true });
  const two = build({ bundle: FIXTURE, strict: true });
  assert.equal(one.json, two.json);
  assert.equal(one.markdown, two.markdown);
  assert.deepEqual(one.ledger, two.ledger);
});

test('checked-in public projections exactly match the deterministic builder', () => {
  const generated = build({ bundle: FIXTURE, strict: true });
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs', 'proof-ledger.json'), 'utf8'), generated.json);
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs', 'PROOF_LEDGER.md'), 'utf8'), generated.markdown);
});

test('tampered receipt becomes unknown and strict publication fails', () => withTemp((temp) => {
  const bundle = copyFixture(temp);
  const receipt = path.join(bundle, 'receipts', 'passed.json');
  const value = readJson(receipt);
  value.receipt.status = 'failed';
  writeJson(receipt, value);
  const ledger = ledgerFromBundle(bundle);
  const record = ledger.records.find((item) => item.record_id === 'proof-fixture-passed');
  assert.equal(record.trust_state, 'unknown');
  assert.equal(record.outcome, 'unknown');
  assert.throws(() => ledgerFromBundle(bundle, { strict: true }), /Strict proof publication refused/);
}));

test('receipt traversal is rejected by the strict record schema', () => withTemp((temp) => {
  const bundle = copyFixture(temp);
  const file = path.join(bundle, 'records', 'passed.json');
  const record = readJson(file);
  record.receipt_path = '../outside.json';
  writeJson(file, record);
  assert.throws(() => ledgerFromBundle(bundle), /traversal|contained relative path/);
}));

test('symlinked receipts become unknown and fail strict publication where portable', () => withTemp((temp) => {
  const bundle = copyFixture(temp);
  const receipt = path.join(bundle, 'receipts', 'passed.json');
  const outside = path.join(temp, 'outside-receipt.json');
  fs.copyFileSync(receipt, outside);
  fs.unlinkSync(receipt);
  try { fs.symlinkSync(outside, receipt, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      skipped += 1;
      process.stdout.write('SKIP receipt symlink creation unavailable\n');
      return;
    }
    throw error;
  }
  const record = ledgerFromBundle(bundle).records.find((item) => item.record_id === 'proof-fixture-passed');
  assert.equal(record.trust_state, 'unknown');
  assert.throws(() => ledgerFromBundle(bundle, { strict: true }), /Strict proof publication refused/);
}));

test('classification cannot be relabeled by record or CLI', () => withTemp((temp) => {
  assert.throws(() => parseArgs(['build', '--bundle', FIXTURE, '--classification', 'independent']), /Unknown argument/);
  const bundle = copyFixture(temp);
  const file = path.join(bundle, 'records', 'passed.json');
  const record = readJson(file);
  record.classification = 'independent';
  writeJson(file, record);
  assert.throws(() => ledgerFromBundle(bundle), /not allowed for provenance kind fixture/);
}));

test('bundle-controlled keys cannot self-declare independent trust', () => withTemp((temp) => {
  const bundle = copyFixture(temp);
  const manifestFile = path.join(bundle, 'proof.bundle.json');
  const manifest = readJson(manifestFile);
  manifest.records = ['records/passed.json'];
  manifest.trust_roots[0].classification = 'independent';
  writeJson(manifestFile, manifest);
  const recordFile = path.join(bundle, 'records', 'passed.json');
  const record = readJson(recordFile);
  record.classification = 'independent';
  record.provenance = {
    kind: 'discussion_comment',
    reference: 'https://github.com/SethGammon/Citadel/discussions/1#discussioncomment-1',
  };
  writeJson(recordFile, record);
  assert.throws(() => ledgerFromBundle(bundle), /cannot self-declare independent trust/);
}));

test('independent trust requires a separately pinned external trust-root file', () => withTemp((temp) => {
  const bundle = copyFixture(temp);
  const manifestFile = path.join(bundle, 'proof.bundle.json');
  const manifest = readJson(manifestFile);
  const keyId = manifest.trust_roots[0].key_id;
  manifest.records = ['records/passed.json'];
  manifest.trust_roots = [];
  writeJson(manifestFile, manifest);
  const recordFile = path.join(bundle, 'records', 'passed.json');
  const record = readJson(recordFile);
  record.classification = 'independent';
  record.provenance = {
    kind: 'discussion_comment',
    reference: 'https://github.com/SethGammon/Citadel/discussions/1#discussioncomment-1',
  };
  writeJson(recordFile, record);

  const withoutPins = ledgerFromBundle(bundle);
  assert.equal(withoutPins.records[0].trust_state, 'unknown');
  assert.equal(withoutPins.records[0].reason_code, 'SIGNER_NOT_TRUSTED_FOR_SOURCE');

  const pinned = path.join(temp, 'pinned');
  fs.mkdirSync(pinned);
  fs.copyFileSync(path.join(bundle, 'trust', 'fixture-public.pem'), path.join(pinned, 'independent-public.pem'));
  const trustRootFile = path.join(pinned, 'trust-roots.json');
  writeJson(trustRootFile, {
    schema_version: 1,
    kind: 'proof_trust_roots',
    roots: [{ key_id: keyId, public_key_path: 'independent-public.pem', classification: 'independent' }],
  });
  const verified = ledgerFromBundle(bundle, { strict: true, trustRootFile });
  assert.equal(verified.records[0].classification, 'independent');
  assert.equal(verified.records[0].trust_state, 'verified');

  const bundleControlledPins = path.join(bundle, 'trust', 'trust-roots.json');
  writeJson(bundleControlledPins, {
    schema_version: 1,
    kind: 'proof_trust_roots',
    roots: [{ key_id: keyId, public_key_path: 'fixture-public.pem', classification: 'independent' }],
  });
  assert.throws(() => ledgerFromBundle(bundle, { trustRootFile: bundleControlledPins }), /outside the proof bundle/);
}));

test('external pins never relabel honest fixture records', () => withTemp((temp) => {
  const pinned = path.join(temp, 'pinned');
  fs.mkdirSync(pinned);
  const fixtureManifest = readJson(path.join(FIXTURE, 'proof.bundle.json'));
  fs.copyFileSync(path.join(FIXTURE, 'trust', 'fixture-public.pem'), path.join(pinned, 'independent-public.pem'));
  const trustRootFile = path.join(pinned, 'trust-roots.json');
  writeJson(trustRootFile, {
    schema_version: 1,
    kind: 'proof_trust_roots',
    roots: [{ key_id: fixtureManifest.trust_roots[0].key_id,
      public_key_path: 'independent-public.pem', classification: 'independent' }],
  });
  const ledger = ledgerFromBundle(FIXTURE, { strict: true, trustRootFile });
  assert.deepEqual(ledger.denominators.classifications, { fixture: 4, maintainer: 0, independent: 0 });
}));

test('missing receipt becomes unknown and fails strict publication', () => withTemp((temp) => {
  const bundle = copyFixture(temp);
  fs.unlinkSync(path.join(bundle, 'receipts', 'blocked.json'));
  const ledger = ledgerFromBundle(bundle);
  const record = ledger.records.find((item) => item.record_id === 'proof-fixture-blocked');
  assert.equal(record.reason_code, 'RECEIPT_MISSING_OR_UNSAFE');
  assert.equal(record.outcome, 'unknown');
  assert.throws(() => ledgerFromBundle(bundle, { strict: true }), /Strict proof publication refused/);
}));

test('untrusted signer becomes unknown and fails strict publication', () => withTemp((temp) => {
  const bundle = copyFixture(temp);
  const file = path.join(bundle, 'proof.bundle.json');
  const manifest = readJson(file);
  manifest.trust_roots[0].key_id = 'key-not-the-signer';
  writeJson(file, manifest);
  const ledger = ledgerFromBundle(bundle);
  assert(ledger.records.every((record) => record.reason_code === 'SIGNER_NOT_TRUSTED_FOR_SOURCE'));
  assert.throws(() => ledgerFromBundle(bundle, { strict: true }), /Strict proof publication refused/);
}));

test('strict schema rejects undeclared and sensitive public record content', () => {
  const file = path.join(FIXTURE, 'records', 'passed.json');
  const base = readJson(file);
  assert(validateRecord({ ...base, prompt: 'private' }).some((error) => error.includes('allowlist')));
  assert(validateRecord({ ...base, title: 'Build at C:\\Users\\person\\repo' }).some((error) => error.includes('sensitive')));
  assert(validateRecord({ ...base, title: 'Contact person@example.com' }).some((error) => error.includes('sensitive')));
});

test('Markdown projection has explicit denominators and no em dash', () => {
  const markdown = renderMarkdown(ledgerFromBundle(FIXTURE, { strict: true }));
  assert(markdown.includes('All records: 4'));
  assert(markdown.includes('passed: 1/4'));
  assert(markdown.includes('failed: 1/4'));
  assert(markdown.includes('blocked: 1/4'));
  assert(markdown.includes('unknown: 1/4'));
  assert(!markdown.includes('\u2014'));
});

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`Proof bundle pipeline: ${passed} passed, ${skipped} skipped\n`);

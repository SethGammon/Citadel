#!/usr/bin/env node

'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createSignedRegistry,
  validateRegistryEnvelope,
  validateTrustManifest,
  verifyRegistryFile,
} = require('../core/packs');
const { parseArgs } = require('./packs');

const ROOT = path.resolve(__dirname, '..');
const NOW = '2026-07-13T22:00:00.000Z';
const PACK_IDS = ['citadel/ci-recovery', 'citadel/migration-campaign', 'citadel/release-steward'];
let passed = 0;

function test(name, fn) {
  try { fn(); passed += 1; process.stdout.write(`PASS ${name}\n`); }
  catch (error) { process.stderr.write(`FAIL ${name}: ${error.stack || error.message}\n`); process.exitCode = 1; }
}

function withTemp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-pack-registry-'));
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function pem(key) { return key.export({ type: 'spki', format: 'pem' }); }

function fixture(temp, options = {}) {
  const registryKeys = options.registryKeys || crypto.generateKeyPairSync('ed25519');
  const publisherKeys = options.publisherKeys || crypto.generateKeyPairSync('ed25519');
  const registryDir = path.join(temp, 'registry');
  const pinsDir = path.join(temp, 'pins');
  fs.mkdirSync(registryDir, { recursive: true });
  fs.mkdirSync(pinsDir, { recursive: true });
  const envelope = createSignedRegistry({
    projectRoot: ROOT,
    registryId: 'citadel-local',
    generatedAt: NOW,
    registryPrivateKey: registryKeys.privateKey,
    registryKeyId: 'key-registry-v1',
    publisherSigners: [{ publisherId: 'citadel', keyId: 'key-citadel-publisher-v1', privateKey: publisherKeys.privateKey }],
    revocations: options.revocations || [],
  });
  const registryFile = path.join(registryDir, 'registry.json');
  writeJson(registryFile, envelope);
  fs.writeFileSync(path.join(pinsDir, 'registry.pem'), pem(options.pinnedRegistryKey || registryKeys.publicKey));
  fs.writeFileSync(path.join(pinsDir, 'publisher.pem'), pem(options.pinnedPublisherKey || publisherKeys.publicKey));
  const trust = {
    schema_version: 1,
    kind: 'pack_registry_trust',
    registry: { key_id: options.registryKeyId || 'key-registry-v1', public_key_path: 'registry.pem' },
    publishers: [{ publisher_id: 'citadel', key_id: options.publisherKeyId || 'key-citadel-publisher-v1',
      public_key_path: 'publisher.pem', pack_ids: PACK_IDS }],
  };
  const trustFile = path.join(pinsDir, 'trust.json');
  writeJson(trustFile, trust);
  return { envelope, registryDir, registryFile, trust, trustFile };
}

test('signed registry is deterministic and verifies against external pins', () => withTemp((temp) => {
  const registryKeys = crypto.generateKeyPairSync('ed25519');
  const publisherKeys = crypto.generateKeyPairSync('ed25519');
  const one = fixture(path.join(temp, 'one'), { registryKeys, publisherKeys });
  const two = fixture(path.join(temp, 'two'), { registryKeys, publisherKeys });
  assert.deepEqual(one.envelope, two.envelope);
  const report = verifyRegistryFile(one.registryFile, one.trustFile);
  assert.equal(report.status, 'verified');
  assert(report.entries.every((entry) => entry.status === 'verified'));
  assert.deepEqual(report.entries.map((entry) => entry.pack_id), PACK_IDS);
}));

test('registry and publisher tampering fail closed', () => withTemp((temp) => {
  const item = fixture(temp);
  const tampered = structuredClone(item.envelope);
  tampered.index.entries[0].content_digest = `sha256:${'0'.repeat(64)}`;
  writeJson(item.registryFile, tampered);
  assert.equal(verifyRegistryFile(item.registryFile, item.trustFile).status, 'invalid');

  const wrongPublisher = crypto.generateKeyPairSync('ed25519');
  const publisherMismatch = fixture(path.join(temp, 'publisher-mismatch'), { pinnedPublisherKey: wrongPublisher.publicKey });
  const mismatch = verifyRegistryFile(publisherMismatch.registryFile, publisherMismatch.trustFile);
  assert.equal(mismatch.status, 'invalid');
  assert(mismatch.entries.every((entry) => entry.reason_code === 'PUBLISHER_SIGNATURE_INVALID'));
}));

test('untrusted registry and publisher signers remain unknown', () => withTemp((temp) => {
  const item = fixture(temp, { registryKeyId: 'key-not-registry' });
  assert.equal(verifyRegistryFile(item.registryFile, item.trustFile).reason_code, 'REGISTRY_SIGNER_NOT_TRUSTED');
  const publisher = fixture(path.join(temp, 'publisher'), { publisherKeyId: 'key-not-publisher' });
  const report = verifyRegistryFile(publisher.registryFile, publisher.trustFile);
  assert.equal(report.status, 'unknown');
  assert(report.entries.every((entry) => entry.reason_code === 'PUBLISHER_NOT_PINNED_FOR_PACK'));
}));

test('publisher and version revocations make matching entries unusable', () => withTemp((temp) => {
  const publisher = fixture(path.join(temp, 'publisher'), { revocations: [{
    scope: 'publisher', publisher_id: 'citadel', pack_id: null, version: null,
    reason_code: 'PUBLISHER_REVOKED', revoked_at: NOW,
  }] });
  const publisherReport = verifyRegistryFile(publisher.registryFile, publisher.trustFile);
  assert.equal(publisherReport.status, 'invalid');
  assert(publisherReport.entries.every((entry) => entry.status === 'revoked'));

  const version = fixture(path.join(temp, 'version'), { revocations: [{
    scope: 'version', publisher_id: 'citadel', pack_id: 'citadel/ci-recovery', version: '0.1.0',
    reason_code: 'VERSION_REVOKED', revoked_at: NOW,
  }] });
  const versionReport = verifyRegistryFile(version.registryFile, version.trustFile);
  assert.equal(versionReport.entries.find((entry) => entry.pack_id === 'citadel/ci-recovery').status, 'revoked');
  assert(versionReport.entries.filter((entry) => entry.pack_id !== 'citadel/ci-recovery').every((entry) => entry.status === 'verified'));
}));

test('self-declared keys and extra fields are rejected', () => withTemp((temp) => {
  const item = fixture(temp);
  const selfDeclared = structuredClone(item.envelope);
  selfDeclared.signature.public_key_spki_base64 = 'AAAA';
  assert(validateRegistryEnvelope(selfDeclared).some((error) => error.includes('allowlist')));
  const expanded = structuredClone(item.envelope);
  expanded.index.entries[0].source_path = 'C:\\Users\\person\\private-pack';
  assert(validateRegistryEnvelope(expanded).some((error) => error.includes('allowlist')));
  const expandedTrust = structuredClone(item.trust);
  expandedTrust.publishers[0].private_key = 'forbidden';
  assert(validateTrustManifest(expandedTrust).some((error) => error.includes('allowlist')));

  const bundledTrust = path.join(item.registryDir, 'trust.json');
  writeJson(bundledTrust, item.trust);
  assert.throws(() => verifyRegistryFile(item.registryFile, bundledTrust), /outside the registry directory/);
}));

test('public registry contains no paths, private keys, or sensitive labels', () => withTemp((temp) => {
  const item = fixture(temp);
  const serialized = JSON.stringify(item.envelope);
  for (const forbidden of ['public_key', 'private_key', 'public_key_path', 'C:\\', '/home/', '/tmp/', '@', 'prompt', 'source_code']) {
    assert(!serialized.includes(forbidden), `registry leaked ${forbidden}`);
  }
  assert.equal(validateRegistryEnvelope(item.envelope).length, 0);
}));

test('Pack CLI parses registry verify and inspect with external pins', () => {
  for (const command of ['verify', 'inspect']) {
    const args = parseArgs(['node', 'packs.js', 'registry', command, '--registry', 'registry.json', '--trust-roots', 'trust.json']);
    assert.equal(args.registryCommand, command);
    assert.equal(path.basename(args.registry), 'registry.json');
    assert.equal(path.basename(args.trustRootFile), 'trust.json');
  }
});

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`Pack registry contract: ${passed} passed\n`);

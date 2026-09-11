'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sha256Digest } = require('../operations/canonical');

const INSTALLATION_IDENTITY_VERSION = 1;

// Keep this list deliberately small and relative. It captures the code that
// resolves and validates effective configuration without putting an
// installation path into a shared receipt. Adding a source file here is a
// receipt invalidation event by design.
const INSTALLATION_SOURCE_FILES = Object.freeze([
  'package.json',
  'core/config/contract.js',
  'core/config/validate.js',
  'core/config/profiles.js',
  'core/config/migrate.js',
  'core/config/bundle-catalog.js',
  'core/config/resolve.js',
  'core/config/runtime.js',
  'core/config/receipt.js',
  'core/runtime/detect-runtime.js',
  'core/runtime/registry.js',
  'runtimes/claude-code/runtime.js',
  'runtimes/codex/runtime.js',
  'runtimes/openai/runtime.js',
  'runtimes/opencode/runtime.js',
]);

function fileDigest(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function packageMetadataFor(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return {
      name: typeof raw.name === 'string' ? raw.name : 'citadel',
      version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    };
  } catch {
    return { name: 'citadel', version: '0.0.0' };
  }
}

function installationGeneration(options = {}) {
  const root = path.resolve(options.installationRoot || path.join(__dirname, '..', '..'));
  const metadata = packageMetadataFor(root);
  const files = INSTALLATION_SOURCE_FILES.map((relative) => {
    const target = path.join(root, relative);
    if (!fs.existsSync(target)) return { path: relative, digest: null };
    return {
      path: relative,
      digest: fileDigest(fs.readFileSync(target)),
    };
  });
  const sourceDigest = sha256Digest(files);
  const id = sha256Digest({
    version: INSTALLATION_IDENTITY_VERSION,
    package: metadata,
    sourceDigest,
  });
  return Object.freeze({
    id,
    version: metadata.version,
    sourceDigest,
  });
}

function runtimeContractDigest(runtime) {
  const input = runtime && typeof runtime === 'object' ? runtime : {};
  const capabilities = {};
  if (input.capabilities && typeof input.capabilities === 'object') {
    for (const key of Object.keys(input.capabilities).sort()) {
      const entry = input.capabilities[key];
      capabilities[key] = {
        support: typeof entry === 'string' ? entry : entry?.support || 'none',
        notes: typeof entry === 'object' && typeof entry.notes === 'string' ? entry.notes : '',
      };
    }
  }
  return sha256Digest({
    id: typeof input.id === 'string' ? input.id : 'unknown',
    capabilities,
    degradations: Array.isArray(input.degradations)
      ? input.degradations.filter((value) => typeof value === 'string').sort()
      : [],
  });
}

function runtimeIdentity(runtime) {
  const input = runtime && typeof runtime === 'object' ? runtime : {};
  return Object.freeze({
    id: typeof input.id === 'string' && input.id ? input.id : 'unknown',
    contractDigest: runtimeContractDigest(input),
  });
}

module.exports = Object.freeze({
  INSTALLATION_IDENTITY_VERSION,
  INSTALLATION_SOURCE_FILES,
  installationGeneration,
  runtimeContractDigest,
  runtimeIdentity,
});

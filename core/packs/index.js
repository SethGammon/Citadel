'use strict';

const fs = require('fs');
const path = require('path');
const { contentDigest } = require('./digest');
const { loadPack } = require('./manifest');

function inspectPack(packRoot, options = {}) {
  const loaded = loadPack(packRoot, options);
  return {
    id: loaded.manifest.id,
    name: loaded.manifest.name,
    version: loaded.manifest.version,
    publisher: loaded.manifest.publisher,
    description: loaded.manifest.description,
    runtimes: loaded.manifest.runtimes,
    skills: loaded.manifest.skills,
    capabilities: loaded.manifest.capabilities,
    permissions: loaded.manifest.permissions,
    dependencies: loaded.manifest.dependencies,
    entry_workflow: loaded.manifest.entry_workflow,
    artifacts: loaded.manifest.artifacts,
    verification: loaded.manifest.verification,
    stopping_conditions: loaded.manifest.stopping_conditions,
    digest: contentDigest(loaded.root),
    root: loaded.root,
  };
}

function packDirectories(projectRoot) {
  const packsRoot = path.join(path.resolve(projectRoot), 'packs');
  if (!fs.existsSync(packsRoot)) return [];
  return fs.readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packsRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'citadel.pack.json')))
    .sort();
}

function assertDependencyGraph(entries) {
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new Error(`Duplicate Pack id: ${entry.id}`);
    byId.set(entry.id, entry);
  }
  for (const entry of entries) {
    for (const dependency of entry.dependencies) {
      if (!byId.has(dependency)) throw new Error(`Pack ${entry.id} has missing dependency: ${dependency}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Pack dependency cycle includes: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}

function buildPackIndex(projectRoot) {
  const entries = packDirectories(projectRoot).map((dir) => inspectPack(dir, { projectRoot }));
  assertDependencyGraph(entries);
  return {
    schema_version: 1,
    packs: entries.map(({ root, ...entry }) => ({ ...entry, path: path.relative(projectRoot, root).split(path.sep).join('/') })),
  };
}

function verifyPack(packRoot, options = {}) {
  const checks = [];
  let pack;
  try {
    pack = inspectPack(packRoot, options);
    checks.push({ id: 'manifest-and-workflow', checked: true, status: 'passed' });
  } catch (error) {
    checks.push({ id: 'manifest-and-workflow', checked: true, status: 'failed', detail: error.message });
    return { status: 'failed', checks, errors: [error.message] };
  }
  checks.push({ id: 'content-digest', checked: true, status: 'passed', digest: pack.digest.digest });
  if (options.expectedDigest && options.expectedDigest !== pack.digest.digest) {
    checks.push({ id: 'expected-digest', checked: true, status: 'failed', detail: 'Pack content digest mismatch' });
  } else if (options.expectedDigest) {
    checks.push({ id: 'expected-digest', checked: true, status: 'passed' });
  }
  if (options.runtime) {
    checks.push(pack.runtimes.includes(options.runtime)
      ? { id: 'runtime-compatibility', checked: true, status: 'passed', runtime: options.runtime }
      : { id: 'runtime-compatibility', checked: true, status: 'failed', runtime: options.runtime,
        detail: `Pack does not support runtime: ${options.runtime}` });
  }
  const errors = checks.filter((check) => check.status === 'failed').map((check) => check.detail);
  return { status: errors.length ? 'failed' : 'passed', checks, errors, pack };
}

function certifyPack(packRoot, options = {}) {
  const verification = verifyPack(packRoot, options);
  const checks = [...verification.checks];
  if (verification.pack) {
    const supplied = options.verificationResults || {};
    for (const declared of verification.pack.verification) {
      const result = supplied[declared.id];
      if (!result) {
        checks.push({ id: `verification:${declared.id}`, checked: false, status: 'unknown',
          required: declared.required, detail: 'Declared verification command was not executed' });
      } else if (result.status === 'passed' || result.status === 'failed') {
        checks.push({ id: `verification:${declared.id}`, checked: true, status: result.status,
          required: declared.required, detail: result.detail || '' });
      } else {
        checks.push({ id: `verification:${declared.id}`, checked: Boolean(result.checked), status: 'unknown',
          required: declared.required, detail: result.detail || 'Verification result is unknown' });
      }
    }
  }
  const requiredFailed = checks.some((check) => check.status === 'failed' && check.required !== false);
  const requiredUnknown = checks.some((check) => check.status === 'unknown' && check.required !== false);
  const status = requiredFailed ? 'failed' : requiredUnknown ? 'unknown' : 'passed';
  return {
    schema_version: 1,
    pack: verification.pack ? { id: verification.pack.id, version: verification.pack.version,
      digest: verification.pack.digest.digest } : null,
    status,
    checks,
    statement: status === 'passed'
      ? 'All required static and supplied execution checks passed.'
      : status === 'failed'
        ? 'At least one required checked condition failed.'
        : 'Certification is incomplete because at least one required check was not executed or remains unknown.',
  };
}

module.exports = Object.freeze({
  assertDependencyGraph,
  buildPackIndex,
  certifyPack,
  inspectPack,
  packDirectories,
  verifyPack,
  ...require('./registry'),
});

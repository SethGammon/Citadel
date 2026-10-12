'use strict';

const fs = require('fs');
const path = require('path');
const { sha256Digest } = require('../operations/canonical');

const V2_TRUST_COUNTERS = Object.freeze([
  'sessionsCompleted',
  'campaignsCompleted',
  'campaignsReverted',
  'fleetCleanMerges',
  'improveLoopsAccepted',
  'daemonRuns',
]);
const V1_TRUST_COUNTERS = Object.freeze([
  'sessions_completed',
  'campaigns_completed',
  'campaigns_reverted',
  'fleet_clean_merges',
  'improve_loops_accepted',
  'daemon_runs',
]);

// SessionEnd bumps trust counters in harness.json for whichever runtime is
// active. They never affect resolution, so valid counter values are left out
// of the digest; otherwise every session would stale every other runtime's
// receipt. Invalid values and trust.override stay in because they change
// validation or behavior.
function digestInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const trust = raw.trust;
  if (!trust || typeof trust !== 'object' || Array.isArray(trust)) return raw;
  const counters = raw.schemaVersion === 2 ? V2_TRUST_COUNTERS : V1_TRUST_COUNTERS;
  const kept = {};
  for (const [key, value] of Object.entries(trust)) {
    if (counters.includes(key) && Number.isInteger(value) && value >= 0) continue;
    if (key === 'override' && value === null) continue;
    kept[key] = value;
  }
  const { trust: _ignored, ...rest } = raw;
  return Object.keys(kept).length ? { ...rest, trust: kept } : rest;
}

function digestSource(exists, raw, bytes, parseError) {
  if (!exists) return sha256Digest(null);
  if (parseError) {
    return sha256Digest({
      kind: 'invalid-json',
      bytes,
    });
  }
  return sha256Digest(digestInput(raw));
}

function readConfigFile(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const configPath = options.configPath
    ? path.resolve(root, options.configPath)
    : path.join(root, '.claude', 'harness.json');
  if (!fs.existsSync(configPath)) {
    return Object.freeze({
      projectRoot: root,
      configPath,
      exists: false,
      bytes: null,
      raw: undefined,
      parseError: null,
      sourceDigest: digestSource(false),
    });
  }
  const bytes = fs.readFileSync(configPath, 'utf8');
  try {
    const raw = JSON.parse(bytes);
    return Object.freeze({
      projectRoot: root,
      configPath,
      exists: true,
      bytes,
      raw,
      parseError: null,
      sourceDigest: digestSource(true, raw, bytes, null),
    });
  } catch (error) {
    return Object.freeze({
      projectRoot: root,
      configPath,
      exists: true,
      bytes,
      raw: undefined,
      parseError: error.message,
      sourceDigest: digestSource(true, undefined, bytes, error.message),
    });
  }
}

module.exports = Object.freeze({
  digestSource,
  readConfigFile,
});

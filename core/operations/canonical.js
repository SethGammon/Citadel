'use strict';

const crypto = require('crypto');

function canonicalValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical operation data cannot contain non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Canonical operation data cannot contain ${typeof value}`);
  }
  if (seen.has(value)) throw new TypeError('Canonical operation data cannot contain cycles');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('Canonical operation data must use plain JSON objects');
    }
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`Canonical operation data cannot contain undefined at ${key}`);
      output[key] = canonicalValue(value[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function canonicalSerialize(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256Digest(value) {
  const serialized = canonicalSerialize(value);
  return `sha256:${crypto.createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
}

module.exports = Object.freeze({ canonicalSerialize, canonicalValue, sha256Digest });

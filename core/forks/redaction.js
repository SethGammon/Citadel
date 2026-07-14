'use strict';

const operations = require('../operations');

const SECRET_PATTERN = /(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[=:]|authorization\s*:|[A-Za-z]:\\|\/Users\/|\/home\/)/i;

function assertRedacted(value, code) {
  const serialized = operations.canonicalSerialize(value);
  if (SECRET_PATTERN.test(serialized)) {
    throw Object.assign(new Error('Replay contains a secret-like or path-like value'), {
      code: code || 'FORK_REPLAY_REDACTION_FAILED',
    });
  }
  return serialized;
}

module.exports = Object.freeze({ SECRET_PATTERN, assertRedacted });

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { coordinates, repositoryPath } = require('./sarif-coordinates');

const root = path.resolve('fixture-root');
assert.equal(repositoryPath('scripts/check.js', root), 'scripts/check.js');
assert.equal(repositoryPath('../outside.txt', root), null);
assert.equal(repositoryPath(path.resolve(root, 'docs', 'guide.md'), root), 'docs/guide.md');

const output = coordinates({
  runs: [{
    results: [{
      ruleId: 'RULE-1',
      level: 'error',
      message: { text: 'must never be emitted' },
      locations: [{ physicalLocation: {
        artifactLocation: { uri: 'scripts/check.js' },
        region: { startLine: 7, snippet: { text: 'must never be emitted' } },
      } }],
    }],
  }],
}, root);

assert.deepEqual(output, [{ ruleId: 'RULE-1', level: 'error', path: 'scripts/check.js', line: 7 }]);
assert(!JSON.stringify(output).includes('must never be emitted'));
process.stdout.write('SARIF coordinate summary tests passed.\n');

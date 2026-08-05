'use strict';

const assert = require('assert');
const { slugify } = require('./src/slugify');
const { parseDuration } = require('./src/duration');

assert.equal(slugify('  Citadel: Proof First  '), 'citadel-proof-first');
assert.equal(slugify('Already---Bounded'), 'already-bounded');
assert.equal(slugify('***'), '');

assert.equal(parseDuration('0ms'), 0);
assert.equal(parseDuration('250ms'), 250);
assert.equal(parseDuration('12s'), 12000);
assert.equal(parseDuration('3m'), 180000);
assert.equal(parseDuration('2h'), 7200000);
for (const invalid of ['1', '-1s', '1.5s', '1d', '', null]) {
  assert.throws(() => parseDuration(invalid));
}

process.stdout.write('fleet ablation fixture passed\n');

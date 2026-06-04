#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const { runtime } = require('../core/contracts');

const matrix = runtime.getRuntimeAdapterMatrix();
for (const runtimeId of runtime.RUNTIME_IDS) {
  assert(matrix[runtimeId], `missing adapter matrix entry for ${runtimeId}`);
  assert(runtime.isAdapterLevel(matrix[runtimeId].level), `invalid adapter level for ${runtimeId}`);
  assert(Array.isArray(matrix[runtimeId].guarantees));
  assert(Array.isArray(matrix[runtimeId].missing));
  assert(matrix[runtimeId].tradeoffs.length > 20);
}

assert.equal(runtime.getRuntimeAdapterMatrix('codex').level, 'managed-subagent');
assert(runtime.getRuntimeAdapterMatrix('openai').missing.includes('local hook lifecycle'));
assert.equal(runtime.getRuntimeAdapterMatrix('not-real').level, 'native-files');

const cli = execFileSync(process.execPath, [
  path.join(__dirname, 'runtime-matrix.js'),
  '--runtime',
  'codex',
  '--json',
], { encoding: 'utf8' });
assert.equal(JSON.parse(cli).level, 'managed-subagent');

console.log('runtime matrix tests passed');

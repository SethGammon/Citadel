#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeDiscovery, readAllDiscoveries, parseArgs } = require('../core/fleet/discovery-writer');

// --- writeDiscovery ---
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-dw-'));
try {
  const { file, record } = writeDiscovery(tempRoot, {
    session: 'fleet-auth',
    agent: 'api-builder',
    wave: 1,
    status: 'success',
    scope: ['src/api/auth/'],
    handoff_items: ['Built JWT middleware'],
    decisions: ['Used jose library'],
    files_touched: ['src/api/auth/middleware.ts'],
    failures: [],
  });

  assert(fs.existsSync(file), 'discovery file should exist');
  assert.equal(record.schema, 1);
  assert.equal(record.session, 'fleet-auth');
  assert.equal(record.agent, 'api-builder');
  assert.equal(record.wave, 1);
  assert.deepEqual(record.scope, ['src/api/auth/']);
  assert.deepEqual(record.handoff_items, ['Built JWT middleware']);
  assert.deepEqual(record.decisions, ['Used jose library']);

  const content = fs.readFileSync(file, 'utf8').trim();
  const parsed = JSON.parse(content);
  assert.equal(parsed.agent, 'api-builder', 'JSONL line should be parseable');

  // Write a second record
  writeDiscovery(tempRoot, {
    session: 'fleet-auth',
    agent: 'frontend-builder',
    wave: 1,
    status: 'partial',
    scope: 'src/ui/',   // string form
    failures: ['Blocked by missing type export'],
  });

  const all = readAllDiscoveries(tempRoot);
  assert.equal(all.length, 2, 'should read back 2 records');
  assert.equal(all[0].agent, 'api-builder');
  assert.equal(all[1].agent, 'frontend-builder');
  assert.deepEqual(all[1].scope, ['src/ui/'], 'string scope should be normalized to array');

} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

// --- readAllDiscoveries with no dir ---
const tempEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-dw-empty-'));
try {
  const records = readAllDiscoveries(tempEmpty);
  assert.deepEqual(records, [], 'empty project should return []');
} finally {
  fs.rmSync(tempEmpty, { recursive: true, force: true });
}

// --- parseArgs ---
const args = parseArgs([
  'node', 'discovery-write.cjs',
  '--session', 'my-session',
  '--agent', 'builder',
  '--wave', '2',
  '--status', 'success',
  '--scope', 'src/api/,src/ui/',
  '--handoff', '["Built X","Wired Y"]',
  '--decisions', '["Use jose"]',
  '--files', '["src/api/a.ts"]',
  '--failures', '[]',
]);
assert.equal(args.session, 'my-session');
assert.equal(args.wave, 2);
assert.equal(args.scope, 'src/api/,src/ui/');
assert.deepEqual(args.handoff_items, ['Built X', 'Wired Y']);
assert.deepEqual(args.decisions, ['Use jose']);
assert.deepEqual(args.failures, []);

console.log('discovery-writer tests passed');

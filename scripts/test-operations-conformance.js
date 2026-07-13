#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runConformance } = require('../core/operations');

const fixture = path.join(__dirname, 'fixtures', 'operations-conformance', 'valid.json');
const records = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const first = runConformance(records, { adapterId: 'adapter-fixture' });
const second = runConformance(records, { adapterId: 'adapter-fixture' });
assert.equal(first.status, 'passed');
assert.equal(first.passed_count, 6);
assert.deepEqual(first.missing_kinds, []);
assert.equal(first.report_digest, second.report_digest, 'report must be deterministic');

const incomplete = runConformance(records.slice(0, 5), { adapterId: 'adapter-incomplete' });
assert.equal(incomplete.status, 'failed');
assert.deepEqual(incomplete.missing_kinds, ['execution_receipt']);

const invalid = records.map((record) => ({ ...record }));
invalid[0].prompt = 'private content';
const rejected = runConformance(invalid, { adapterId: 'adapter-private' });
assert.equal(rejected.status, 'failed');
assert.match(rejected.results[0].errors.join('; '), /privacy-safe allowlist/);

const cli = spawnSync(process.execPath, [path.join(__dirname, 'operations-conformance.js'), fixture, '--adapter', 'adapter-cli'], { encoding: 'utf8' });
assert.equal(cli.status, 0, cli.stderr);
assert.equal(JSON.parse(cli.stdout).status, 'passed');
console.log('Operations Protocol conformance tests passed');

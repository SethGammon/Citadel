#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { runConformance } = require('../core/operations');

function usage() {
  process.stdout.write('Usage: node scripts/operations-conformance.js <fixture.json> [--adapter <id>]\n');
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) return usage();
  const file = argv[0];
  if (!file) throw new TypeError('A conformance fixture file is required');
  const adapterIndex = argv.indexOf('--adapter');
  const adapterId = adapterIndex >= 0 ? argv[adapterIndex + 1] : 'adapter-local';
  if (adapterIndex >= 0 && !adapterId) throw new TypeError('--adapter requires an id');
  const records = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const report = runConformance(records, { adapterId });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

try { main(); } catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

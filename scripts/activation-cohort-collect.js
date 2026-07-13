#!/usr/bin/env node

'use strict';

const path = require('path');
const { collect } = require('../core/telemetry/activation-discussion');

function parseArgs(argv) {
  const options = { root: process.cwd(), dryRun: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--root') options.root = path.resolve(argv[++index]);
    else if (arg === '--fixture') options.fixture = path.resolve(argv[++index]);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/activation-cohort-collect.js [--root path] [--dry-run] [--json]',
    '       node scripts/activation-cohort-collect.js --fixture comments.json [--root path] [--dry-run] [--json]',
  ].join('\n');
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(`${usage()}\n`); return null; }
  const result = await collect({ ...options, execFile: dependencies.execFile, now: dependencies.now });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Activation cohort collection failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ main, parseArgs, usage });

#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { analyze, parseJsonl } = require('../core/reliability');

function parseArgs(argv) {
  const options = { input: null, output: null, requireSufficient: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--require-sufficient') options.requireSufficient = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return 'Usage: node scripts/reliability-analyze.js --input <local.jsonl> [--output report.json] [--require-sufficient]\n';
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { help: true, text: usage(), status: 0 };
  if (!options.input) throw new Error('--input is required');
  const records = parseJsonl(fs.readFileSync(path.resolve(options.input), 'utf8'));
  const report = analyze(records);
  if (options.output) {
    const output = path.resolve(options.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return { report, status: options.requireSufficient && report.status !== 'available' ? 2 : 0 };
}

function main() {
  try {
    const result = run();
    process.stdout.write(result.help ? result.text : `${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.status;
  } catch (error) {
    process.stderr.write(`reliability-analyze: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = Object.freeze({ main, parseArgs, run, usage });

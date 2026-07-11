#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runGoldenPath } = require('../core/golden-path/runner');

function parseArgs(argv) {
  const args = { runtime: null, fixture: null, json: false, output: null, keepTemp: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--runtime') args.runtime = argv[++index] || null;
    else if (value === '--fixture') args.fixture = argv[++index] || null;
    else if (value === '--json') args.json = true;
    else if (value === '--output') args.output = argv[++index] || null;
    else if (value === '--keep-temp') args.keepTemp = true;
    else if (value === '--help' || value === '-h') args.help = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/golden-path.js --runtime claude|codex --fixture <fixture.json> [--json] [--output <result.json>] [--keep-temp]',
    '',
    'Runs deterministic fixture automation only. It does not register a plugin or execute an LLM task.',
  ].join('\n');
}

function printHuman(result) {
  const lines = [
    `Citadel golden path fixture: ${result.status.toUpperCase()}`,
    `Runtime: ${result.runtime || '(invalid)'}`,
    `Fixture: ${result.fixture_id || '(invalid)'}`,
    ...result.steps.map((step) => `[${step.status.toUpperCase()}] ${step.id} (${step.duration_ms}ms)`),
  ];
  if (result.failure) lines.push(`Failure: ${result.failure.code}`, `Recovery: ${result.failure.recovery}`);
  lines.push('Mode: deterministic fixture automation; see result limitations for excluded proof.');
  process.stdout.write(`${lines.join('\n')}\n`);
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    args = { runtime: null, fixture: path.join(__dirname, '__missing-fixture__.json'), json: true };
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = runGoldenPath({
    runtime: args.runtime,
    fixture: args.fixture || path.join(__dirname, '__missing-fixture__.json'),
    keepTemp: args.keepTemp,
    pluginRoot: path.resolve(__dirname, '..'),
  });
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) {
    const output = path.resolve(args.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, rendered, 'utf8');
  }
  if (args.json) process.stdout.write(rendered);
  else printHuman(result);
  if (result.status !== 'passed') process.exitCode = 1;
  return result;
}

if (require.main === module) main();

module.exports = { main, parseArgs, printHuman, usage };

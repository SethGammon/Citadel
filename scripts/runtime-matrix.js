#!/usr/bin/env node

'use strict';

const { runtime } = require('../core/contracts');

function parseArgs(argv) {
  const args = { json: false, runtimeId: null };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--runtime') { args.runtimeId = value; index++; }
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return 'Usage: node scripts/runtime-matrix.js [--runtime codex] [--json]';
}

function render(matrix) {
  const entries = matrix.level ? [[null, matrix]] : Object.entries(matrix);
  const lines = [];
  lines.push('Runtime Adapter Matrix');
  lines.push('='.repeat(40));
  for (const [id, entry] of entries) {
    if (id) lines.push(id);
    lines.push(`  level: ${entry.level}`);
    lines.push(`  guarantees: ${entry.guarantees.join(', ') || 'none'}`);
    lines.push(`  missing: ${entry.missing.join(', ') || 'none'}`);
    lines.push(`  tradeoffs: ${entry.tradeoffs}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const matrix = runtime.getRuntimeAdapterMatrix(args.runtimeId);
  process.stdout.write(args.json ? `${JSON.stringify(matrix, null, 2)}\n` : render(matrix));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  render,
  usage,
};

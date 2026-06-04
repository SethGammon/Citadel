#!/usr/bin/env node

'use strict';

const path = require('path');

const {
  capabilityMatrix,
  getSandboxProvider,
} = require('../core/sandbox/providers');

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'matrix',
    provider: 'worktree',
    projectRoot: process.cwd(),
    json: false,
    write: false,
  };
  for (let index = 3; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--provider') { args.provider = value; index++; }
    else if (arg === '--project-root') { args.projectRoot = path.resolve(value); index++; }
    else if (arg === '--worktree') { args.worktreePath = path.resolve(value); index++; }
    else if (arg === '--branch') { args.branch = value; index++; }
    else if (arg === '--write') args.write = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/sandbox-provider.js matrix [--json]',
    '       node scripts/sandbox-provider.js status --provider worktree [--worktree path] [--json]',
    '       node scripts/sandbox-provider.js attach --provider worktree --worktree path',
    '       node scripts/sandbox-provider.js snapshot --provider worktree --worktree path',
    '       node scripts/sandbox-provider.js readiness --provider worktree [--worktree path] [--write]',
  ].join('\n');
}

function renderMatrix(matrix) {
  const lines = [];
  lines.push('Sandbox Provider Matrix');
  lines.push('='.repeat(40));
  for (const provider of matrix) {
    lines.push(provider.provider);
    for (const [operation, entry] of Object.entries(provider.capabilities)) {
      lines.push(`  ${operation.padEnd(8)} ${entry.supported ? 'yes' : 'no '} - ${entry.note}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderObject(title, value) {
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(40));
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object') lines.push(`${key}: ${JSON.stringify(item)}`);
    else lines.push(`${key}: ${item}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (args.command === 'matrix') {
    const matrix = capabilityMatrix({ projectRoot: args.projectRoot });
    process.stdout.write(args.json ? `${JSON.stringify(matrix, null, 2)}\n` : renderMatrix(matrix));
    return;
  }

  const provider = getSandboxProvider(args.provider, { projectRoot: args.projectRoot });
  const method = provider[args.command];
  if (typeof method !== 'function') {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const result = await method(args);
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : renderObject(`Sandbox ${args.command}`, result));
  } catch (error) {
    if (args.json) process.stdout.write(`${JSON.stringify({ error: error.message, code: error.code || null }, null, 2)}\n`);
    else process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  renderMatrix,
  renderObject,
  usage,
};

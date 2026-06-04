#!/usr/bin/env node

'use strict';

const path = require('path');

const {
  compileMemoryBlocks,
  lintMemoryBlocks,
  loadMemoryBlocks,
} = require('../core/memory/blocks');

function parseArgs(argv) {
  const args = { mode: argv[2] || 'compile', projectRoot: process.cwd(), json: false };
  for (let index = 3; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--project-root') { args.projectRoot = path.resolve(value); index++; }
    else if (arg === '--scope') { args.scope = value; index++; }
    else if (arg === '--type') { args.type = value; index++; }
    else if (arg === '--query') { args.query = value; index++; }
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/memory-compile.js compile [--project-root path] [--json]',
    '       node scripts/memory-compile.js lint [--project-root path] [--json]',
    '       node scripts/memory-compile.js list [--scope scope] [--type type] [--query text] [--json]',
    '',
    'Compiles compact semantic memory blocks from project planning artifacts.',
  ].join('\n');
}

function renderCompile(projectRoot, result, lint) {
  const lines = [];
  lines.push('Memory Blocks');
  lines.push('='.repeat(40));
  lines.push(`Project: ${projectRoot}`);
  lines.push(`Blocks:  ${result.blocks.length}`);
  lines.push(`Index:   ${path.relative(projectRoot, result.indexPath)}`);
  lines.push('');
  for (const block of result.blocks) {
    lines.push(`  ${block.id} (${block.type}) - ${block.sources.length} source(s), ${block.confidence}`);
  }
  lines.push('');
  lines.push(`Lint: ${lint.pass ? 'PASS' : 'FAIL'} (${lint.issues.length} issue(s))`);
  for (const issue of lint.issues.slice(0, 12)) {
    lines.push(`  ${issue.id || 'memory'}: ${issue.issue}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderList(projectRoot, blocks) {
  const lines = [];
  lines.push('Memory Blocks');
  lines.push('='.repeat(40));
  lines.push(`Project: ${projectRoot}`);
  lines.push(`Matches: ${blocks.length}`);
  for (const block of blocks) {
    lines.push(`  ${block.id} (${block.type}) scope=${block.scope.join(',')} confidence=${block.confidence}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (args.mode === 'compile') {
    const result = compileMemoryBlocks(args.projectRoot);
    const lint = lintMemoryBlocks(args.projectRoot);
    if (args.json) process.stdout.write(`${JSON.stringify({ ...result, lint }, null, 2)}\n`);
    else process.stdout.write(renderCompile(args.projectRoot, result, lint));
    process.exitCode = lint.pass ? 0 : 1;
    return;
  }

  if (args.mode === 'lint') {
    const lint = lintMemoryBlocks(args.projectRoot);
    if (args.json) process.stdout.write(`${JSON.stringify(lint, null, 2)}\n`);
    else process.stdout.write(renderCompile(args.projectRoot, { blocks: lint.blocks, indexPath: path.join(args.projectRoot, '.planning', 'memory', 'index.json') }, lint));
    process.exitCode = lint.pass ? 0 : 1;
    return;
  }

  if (args.mode === 'list') {
    const blocks = loadMemoryBlocks(args.projectRoot, args);
    if (args.json) process.stdout.write(`${JSON.stringify(blocks, null, 2)}\n`);
    else process.stdout.write(renderList(args.projectRoot, blocks));
    return;
  }

  process.stderr.write(`${usage()}\n`);
  process.exitCode = 2;
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  renderCompile,
  renderList,
  usage,
};

#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { evaluatePortfolio } = require('../core/milestones/external-gates');

function usage() {
  return 'Usage: node scripts/milestone-readiness.js [--evidence FILE] [--json]';
}

function parseArgs(argv) {
  const result = { evidence: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') result.json = true;
    else if (arg === '--evidence') result.evidence = argv[++index];
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.evidence === undefined) throw new Error('--evidence requires a file');
  return result;
}

function readEvidence(filePath) {
  if (!filePath) return {};
  const resolved = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Milestone evidence must be an object');
  }
  return parsed;
}

function render(report) {
  const lines = [`Citadel external milestone readiness: ${report.ready_count}/${report.gate_count} ready`];
  for (const gate of report.gates) {
    lines.push(`${gate.ready ? 'READY' : 'WAIT'}  ${gate.gate}`);
    for (const item of gate.missing) lines.push(`  ${item.metric}: ${item.actual}/${item.threshold}`);
  }
  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const report = evaluatePortfolio(readEvidence(args.evidence));
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : render(report));
  return report.status === 'ready' ? 0 : 2;
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ main, parseArgs, readEvidence, render });

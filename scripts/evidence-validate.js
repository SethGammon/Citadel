#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const {
  appendRepairTasks,
  validateExitEvidence,
} = require('../core/evidence/contracts');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    file: null,
    target: null,
    json: false,
    writeRepair: false,
    allowMissing: false,
  };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--project-root') { args.projectRoot = path.resolve(value); index++; }
    else if (arg === '--file') { args.file = value; index++; }
    else if (arg === '--target') { args.target = value; index++; }
    else if (arg === '--json') args.json = true;
    else if (arg === '--write-repair') args.writeRepair = true;
    else if (arg === '--allow-missing') args.allowMissing = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/evidence-validate.js --file .planning/campaigns/example.md [--target phase:1]',
    '       node scripts/evidence-validate.js --file .planning/fleet/session.md --write-repair',
    '',
    'Validates Exit Evidence markdown tables and optionally appends repair tasks.',
  ].join('\n');
}

function render(filePath, report) {
  const lines = [];
  lines.push('Exit Evidence');
  lines.push('='.repeat(40));
  lines.push(`File: ${filePath}`);
  lines.push(`Items: ${report.items.length}`);
  lines.push(`Failures: ${report.failures.length}`);
  if (report.missingDeclarations) lines.push('No exit evidence declarations found.');
  for (const failure of report.failures) {
    lines.push(`  ${failure.action}: ${failure.target}/${failure.id} (${failure.type})`);
    for (const issue of failure.issues) lines.push(`    - ${issue}`);
    const next = failure.next_action || `Add passing ${failure.type} evidence before advancing.`;
    lines.push(`    next: ${next}`);
  }
  lines.push(`Status: ${report.pass ? 'PASS' : 'FAIL'}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.file) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = args.help ? 0 : 2;
    return;
  }

  const filePath = path.resolve(args.projectRoot, args.file);
  const markdown = fs.readFileSync(filePath, 'utf8');
  const report = validateExitEvidence(markdown, {
    projectRoot: args.projectRoot,
    target: args.target,
  });
  const pass = report.pass && (args.allowMissing || !report.missingDeclarations);

  if (args.writeRepair && report.failures.length > 0) {
    fs.writeFileSync(filePath, appendRepairTasks(markdown, report.failures), 'utf8');
  }

  if (args.json) process.stdout.write(`${JSON.stringify({ ...report, pass }, null, 2)}\n`);
  else process.stdout.write(render(args.file, { ...report, pass }));
  process.exitCode = pass ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  render,
  usage,
};

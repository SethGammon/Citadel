#!/usr/bin/env node

'use strict';

const path = require('path');

const { verifyProjectTelemetry } = require('../core/telemetry/integrity');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    json: false,
    strictLegacy: false,
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--project-root') { args.projectRoot = path.resolve(value); index++; }
    else if (arg === '--file') {
      args.files = [...(args.files || []), path.resolve(args.projectRoot, value)];
      index++;
    } else if (arg === '--json') args.json = true;
    else if (arg === '--strict-legacy') args.strictLegacy = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage: node scripts/verify-telemetry-integrity.js [--project-root path] [--json] [--strict-legacy]',
    '       node scripts/verify-telemetry-integrity.js --file .planning/telemetry/agent-runs.jsonl',
    '',
    'Verifies hashed telemetry and artifact JSONL records. Legacy records are reported,',
    'but allowed unless --strict-legacy is set.',
  ].join('\n');
}

function render(report) {
  const lines = [];
  lines.push('Telemetry Integrity');
  lines.push('='.repeat(40));
  lines.push(`Project:  ${report.projectRoot}`);
  lines.push(`Records:  ${report.totals.total}`);
  lines.push(`Verified: ${report.totals.verified}`);
  lines.push(`Signed:   ${report.totals.signed}`);
  lines.push(`Legacy:   ${report.totals.legacy}`);
  lines.push(`Tampered: ${report.totals.tampered}`);
  lines.push(`Invalid:  ${report.totals.invalid}`);
  if (report.totals.signatureWarnings) lines.push(`Signature warnings: ${report.totals.signatureWarnings}`);
  lines.push('');
  lines.push('FILES');
  if (report.files.length === 0) {
    lines.push('  (no telemetry or artifact JSONL files found)');
  }
  for (const file of report.files) {
    lines.push(`  ${path.relative(report.projectRoot, file.file)} - ${file.verified}/${file.total} verified, ${file.legacy} legacy, ${file.tampered.length} tampered, ${file.invalid.length} invalid`);
    for (const issue of file.tampered.slice(0, 3)) {
      lines.push(`    tampered line ${issue.lineNumber}: ${issue.reason}`);
    }
    for (const issue of file.invalid.slice(0, 3)) {
      lines.push(`    invalid line ${issue.lineNumber}: ${issue.reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const report = verifyProjectTelemetry(args.projectRoot, {
    files: args.files,
  });
  const pass = report.totals.tampered === 0 &&
    report.totals.invalid === 0 &&
    (!args.strictLegacy || report.totals.legacy === 0);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...report, pass }, null, 2)}\n`);
  } else {
    process.stdout.write(render(report));
  }

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

#!/usr/bin/env node

'use strict';

const path = require('path');

const {
  checkWorktreeReadiness,
  listReadinessReports,
} = require('../core/worktree/readiness');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    worktreePath: process.cwd(),
    write: false,
    json: false,
    list: false,
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--project-root') { args.projectRoot = path.resolve(value); index++; }
    else if (arg === '--worktree') { args.worktreePath = path.resolve(value); index++; }
    else if (arg === '--branch') { args.branch = value; index++; }
    else if (arg === '--write') args.write = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage: node scripts/worktree-readiness.js [--worktree path] [--branch name] [--write] [--json]',
    '       node scripts/worktree-readiness.js --list [--json]',
    '',
    'Runs read-only dependency, env-file, port, and health-command readiness checks.',
    'Reports are written to .planning/verification/worktree-readiness/ only with --write.',
  ].join('\n');
}

function renderReport(report) {
  const lines = [];
  lines.push('Worktree Readiness');
  lines.push('='.repeat(40));
  lines.push(`Status:   ${report.status}`);
  lines.push(`Worktree: ${report.worktreePath}`);
  if (report.branch) lines.push(`Branch:   ${report.branch}`);
  lines.push(`Blocks Fleet: ${report.blockFleet ? 'yes' : 'no'}`);
  if (report.file) lines.push(`Report:   ${report.file}`);
  lines.push('');
  lines.push('CHECKS');
  for (const check of report.checks) {
    lines.push(`  ${check.status.toUpperCase()} ${check.name} - ${check.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderList(reports) {
  const lines = [];
  lines.push('Worktree Readiness Reports');
  lines.push('='.repeat(40));
  if (reports.length === 0) {
    lines.push('  (none recorded)');
    return `${lines.join('\n')}\n`;
  }

  for (const report of reports.slice(0, 20)) {
    const branch = report.branch ? ` - ${report.branch}` : '';
    lines.push(`  ${report.status} - ${report.worktreeName || path.basename(report.worktreePath || '')}${branch}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (args.list) {
    const reports = listReadinessReports(args.projectRoot);
    process.stdout.write(args.json ? `${JSON.stringify(reports, null, 2)}\n` : renderList(reports));
    return;
  }

  const report = await checkWorktreeReadiness(args);
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  process.exitCode = report.status === 'blocked' ? 1 : 0;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  renderList,
  renderReport,
  usage,
};

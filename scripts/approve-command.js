#!/usr/bin/env node
'use strict';

// Approve, revoke, or list repository-controlled commands Citadel may run.
//
//   node scripts/approve-command.js approve typecheck --command "typescript: tsc --noEmit"
//   node scripts/approve-command.js approve loop --command "npm test"
//   node scripts/approve-command.js revoke loop --command "npm test"
//   node scripts/approve-command.js list
//
// Approving requires an interactive terminal and a typed confirmation, so a
// hook, MCP server, or agent tool call cannot approve commands on its own.

const path = require('path');
const readline = require('readline');
const approvals = require('../core/security/command-approvals');

function parseArgs(argv) {
  const [action, kind, ...rest] = argv;
  const options = { action, kind, projectRoot: process.cwd(), command: null };
  if (action === 'list') {
    options.kind = null;
    rest.unshift(kind);
  }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) continue;
    if (arg === '--project-root') options.projectRoot = rest[++i];
    else if (arg === '--command') options.command = rest[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.projectRoot = path.resolve(options.projectRoot || process.cwd());
  return options;
}

function usage() {
  return [
    'Usage:',
    '  approve-command.js approve <typecheck|loop> --command "<exact command>" [--project-root <dir>]',
    '  approve-command.js revoke <typecheck|loop> --command "<exact command>" [--project-root <dir>]',
    '  approve-command.js list [--project-root <dir>]',
  ].join('\n');
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.action === 'list') {
    const entries = approvals.listApprovals(options.projectRoot);
    if (!entries.length) process.stdout.write('No approved commands for this project.\n');
    for (const entry of entries) process.stdout.write(`${entry.kind}\t${entry.command}\t(approved ${entry.approvedAt})\n`);
    return 0;
  }
  if (!['approve', 'revoke'].includes(options.action) || !approvals.KINDS.includes(options.kind) || !options.command) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  if (options.action === 'revoke') {
    const result = approvals.revoke(options.projectRoot, options.kind, options.command);
    process.stdout.write(result.removed ? 'Approval revoked.\n' : 'No matching approval.\n');
    return 0;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('Refusing to approve: run this yourself in an interactive terminal. Approvals cannot be granted by hooks, agents, or piped input.\n');
    return 3;
  }
  process.stdout.write([
    `Project: ${options.projectRoot}`,
    `Kind:    ${options.kind}`,
    `Command: ${options.command}`,
    '',
    'Citadel will run this command automatically for this project. Only approve',
    'commands you have read and trust; the repository supplied them.',
    '',
  ].join('\n'));
  const typed = await ask('Type the command exactly to approve it: ');
  if (typed !== options.command) {
    process.stderr.write('Confirmation did not match. Nothing approved.\n');
    return 1;
  }
  const result = approvals.approve(options.projectRoot, options.kind, options.command);
  process.stdout.write(`Approved. Stored in ${result.storePath}\n`);
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };

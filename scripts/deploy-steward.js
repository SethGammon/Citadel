#!/usr/bin/env node
'use strict';

const path = require('path');

const {
  renderReport,
  runDeploySteward,
} = require('../core/deploy-steward/steward');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    scan: false,
    run: false,
    dryRun: false,
    json: false,
    enqueue: [],
    mergeMode: 'serial',
    mergeMethod: 'squash',
    deleteBranch: true,
    write: true,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--project-root') { args.projectRoot = path.resolve(next || '.'); index++; }
    else if (arg === '--scan') args.scan = true;
    else if (arg === '--run') args.run = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--no-write') args.write = false;
    else if (arg === '--enqueue-pr') { args.enqueue.push({ pr: next }); index++; }
    else if (arg === '--branch') { args.branch = next || null; index++; }
    else if (arg === '--head') { args.head = next || null; index++; }
    else if (arg === '--merge-mode') { args.mergeMode = next || 'serial'; index++; }
    else if (arg === '--merge-method') { args.mergeMethod = next || 'squash'; index++; }
    else if (arg === '--keep-branch') args.deleteBranch = false;
    else if (arg === '--deploy-command') { args.deployCommand = next || ''; index++; }
    else if (arg === '--allow-no-checks') args.allowNoChecks = true;
    else if (arg === '--require-fresh-readiness') args.requireFreshReadiness = true;
    else if (arg === '--force-lease') args.forceLease = true;
    else if (arg === '--max-items') { args.maxItems = Number.parseInt(next, 10); index++; }
    else if (arg === '--gh') { args.gh = next || 'gh'; index++; }
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!arg.startsWith('-')) args.enqueue.push({ pr: arg });
  }

  if (!['serial', 'merge-queue'].includes(args.mergeMode)) {
    throw new Error('--merge-mode must be serial or merge-queue');
  }
  if (!['squash', 'merge', 'rebase'].includes(args.mergeMethod)) {
    throw new Error('--merge-method must be squash, merge, or rebase');
  }
  if (!Number.isFinite(args.maxItems)) delete args.maxItems;

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/deploy-steward.js --scan',
    '  node scripts/deploy-steward.js --run',
    '  node scripts/deploy-steward.js --scan --run --deploy-command "npm run deploy"',
    '  node scripts/deploy-steward.js --enqueue-pr https://github.com/OWNER/REPO/pull/123 --run',
    '',
    'Consumes .planning/pr-readiness reports or explicit PRs, owns a deploy-steward lease,',
    'updates stale branches, waits for CI, merges one candidate at a time, runs an optional',
    'deploy command, and opens .planning/intake repair tasks for failures.',
    '',
    'Options:',
    '  --scan                         Queue PR readiness reports from .planning/pr-readiness',
    '  --run                          Process the deploy queue under a lease',
    '  --dry-run                      Do not write, update branches, merge, or deploy',
    '  --enqueue-pr <url>             Add an explicit GitHub pull request URL to the queue',
    '  --merge-mode serial|merge-queue',
    '  --merge-method squash|merge|rebase',
    '  --deploy-command <command>     Run after a serial merge succeeds',
    '  --allow-no-checks              Permit repos with no visible status checks',
    '  --require-fresh-readiness      Block if PR head differs from readiness report head',
    '  --force-lease                  Replace an active lease',
    '  --max-items <n>                Bound candidates processed in this run',
    '  --json                         Emit JSON',
  ].join('\n');
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = runDeploySteward(args.projectRoot, {
      ...args,
      command: process.argv.join(' '),
    });
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(renderReport(result));
    const hasRepair = result.events.some((event) => event.action === 'repair-needed');
    const hasBlocked = result.queue.some((item) => ['blocked', 'stale'].includes(item.status));
    process.exitCode = hasRepair || hasBlocked ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  usage,
};

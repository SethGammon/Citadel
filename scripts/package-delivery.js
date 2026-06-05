#!/usr/bin/env node
'use strict';

const path = require('path');
const { packageDelivery } = require('../core/campaigns/package-delivery');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    campaign: '',
    pr: '',
    note: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--campaign') args.campaign = argv[++index] || '';
    else if (arg === '--pr') args.pr = argv[++index] || '';
    else if (arg === '--note') args.note = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!arg.startsWith('--') && !args.campaign) args.campaign = arg;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/package-delivery.js <campaign-slug-or-path> [--pr <url>] [--note <text>]',
    '  node scripts/package-delivery.js --campaign <campaign-slug-or-path>',
    '',
    'Creates .planning/review-packages/<campaign>.md and records the package or PR in the campaign Exit Evidence table.',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.campaign) {
    console.log(usage());
    process.exitCode = args.help ? 0 : 2;
    return;
  }

  try {
    const result = packageDelivery(args.projectRoot, args.campaign, {
      pr: args.pr || undefined,
      note: args.note || undefined,
    });
    console.log('Delivery review package created.');
    console.log(`  slug: ${result.slug}`);
    console.log(`  package: ${result.packagePath}`);
    console.log(`  evidence: ${result.reviewType} ${result.reviewEvidence}`);
    console.log(`  readiness: ${result.readiness}`);
    console.log('  next: review the package, then complete the campaign when all phases are complete');
  } catch (error) {
    console.error(`Delivery package failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  usage,
};

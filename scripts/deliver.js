#!/usr/bin/env node
'use strict';

const path = require('path');
const { createDeliveryFromIntake, resolveNextIntake } = require('../core/intake/deliver');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    intake: '',
    slug: '',
    force: false,
    verification: '',
    next: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--intake') args.intake = argv[++index] || '';
    else if (arg === '--next') args.next = true;
    else if (arg === '--slug') args.slug = argv[++index] || '';
    else if (arg === '--verification') args.verification = argv[++index] || '';
    else if (arg === '--force') args.force = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!arg.startsWith('--') && !args.intake) args.intake = arg;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/deliver.js --intake .planning/intake/item.md [--verification "npm run test"]',
    '  node scripts/deliver.js --next',
    '  node scripts/deliver.js .planning/intake/item.md',
    '  node scripts/deliver.js intake',
    '',
    'Creates an active delivery campaign from a real intake item and marks the intake item in-progress.',
    '--next selects the highest-priority pending item in .planning/intake/.',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.intake === 'intake' || args.intake === 'pending') args.next = true;

  if (args.help || (!args.intake && !args.next)) {
    console.log(usage());
    return;
  }

  try {
    const intakePath = args.next ? resolveNextIntake(args.projectRoot) : args.intake;
    const result = createDeliveryFromIntake(args.projectRoot, intakePath, {
      slug: args.slug,
      force: args.force,
      verification: args.verification || undefined,
    });
    console.log('Delivery campaign created.');
    console.log(`  slug: ${result.slug}`);
    console.log(`  campaign: ${result.campaignPath}`);
    console.log(`  intake: ${result.intakePath}`);
    console.log('  next: /do continue');
  } catch (error) {
    console.error(`Delivery preflight failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
};

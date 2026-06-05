#!/usr/bin/env node
'use strict';

const path = require('path');
const { createDeliveryFromIntake } = require('../core/intake/deliver');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    intake: '',
    slug: '',
    force: false,
    verification: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--intake') args.intake = argv[++index] || '';
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
    '  node scripts/deliver.js .planning/intake/item.md',
    '',
    'Creates an active delivery campaign from a real intake item and marks the intake item in-progress.',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.intake) {
    console.log(usage());
    return;
  }

  try {
    const result = createDeliveryFromIntake(args.projectRoot, args.intake, {
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

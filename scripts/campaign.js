#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { completeCampaign } = require('../core/campaigns/update-campaign');
const { getCampaignPaths } = require('../core/campaigns/load-campaign');

function parseArgs(argv) {
  const args = {
    command: argv[0] || '',
    target: argv[1] || '',
    projectRoot: process.cwd(),
    archive: false,
    force: false,
    pr: '',
    mergeSha: '',
    verification: '',
    note: '',
  };

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--archive') args.archive = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--pr') args.pr = argv[++index] || '';
    else if (arg === '--merge-sha') args.mergeSha = argv[++index] || '';
    else if (arg === '--verification') args.verification = argv[++index] || '';
    else if (arg === '--note') args.note = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/campaign.js complete <slug-or-path> [--archive] [--pr <url>] [--merge-sha <sha>] [--verification <text>] [--note <text>]',
    '',
    'Completes a campaign only when every phase is complete, completed, done, or skipped.',
    'Use --force only after human review of incomplete phases.',
  ].join('\n');
}

function resolveCampaignPath(projectRoot, target) {
  if (!target) throw new Error('Missing campaign slug or path.');

  const direct = path.resolve(projectRoot, target);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;

  const paths = getCampaignPaths(projectRoot);
  const slug = target.endsWith('.md') ? target : `${target}.md`;
  const candidates = [
    path.join(paths.campaignsDir, slug),
    path.join(paths.completedDir, slug),
  ];

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) throw new Error(`Campaign not found: ${target}`);
  return match;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    console.log(usage());
    return;
  }

  if (args.command !== 'complete') {
    console.error(`Unknown command: ${args.command}`);
    console.error(usage());
    process.exit(1);
  }

  try {
    const filePath = resolveCampaignPath(args.projectRoot, args.target);
    const result = completeCampaign(filePath, args.projectRoot, {
      archive: args.archive,
      force: args.force,
      pr: args.pr,
      mergeSha: args.mergeSha,
      verification: args.verification,
      note: args.note,
    });

    console.log('Campaign completed.');
    console.log(`  slug: ${result.slug}`);
    console.log(`  status: ${result.frontmatter.status || result.bodyStatus || 'completed'}`);
    console.log(`  file: ${result.filePath}`);
  } catch (error) {
    console.error(`Campaign completion failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  resolveCampaignPath,
};

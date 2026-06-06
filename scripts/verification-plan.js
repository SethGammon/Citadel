#!/usr/bin/env node
'use strict';

const path = require('path');
const { selectVerificationProfile } = require('../core/verification/profiles');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/verification-plan.js [--json] [--project-root <path>]',
    '',
    'Selects the verification profile for the current changed paths.',
  ].join('\n');
}

function render(plan) {
  const lines = [
    'Citadel Verification Plan',
    '='.repeat(40),
    `Profile: ${plan.id}`,
    `Label: ${plan.label}`,
    `Reason: ${plan.reason}`,
    `Primary: ${plan.primaryCommand}`,
    '',
    'Commands',
  ];

  for (const command of plan.commands) lines.push(`  - ${command}`);

  lines.push('');
  lines.push('Changed Files');
  if (plan.changedFiles.length === 0) lines.push('  (none detected)');
  else for (const file of plan.changedFiles.slice(0, 20)) lines.push(`  - ${file}`);

  if (plan.notes.length > 0) {
    lines.push('');
    lines.push('Notes');
    for (const note of plan.notes) lines.push(`  - ${note}`);
  }

  lines.push('');
  lines.push('---HANDOFF---');
  lines.push(`- Verification profile: ${plan.id}`);
  lines.push(`- Primary command: ${plan.primaryCommand}`);
  lines.push(`- Recommended commands: ${plan.commands.length}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const plan = selectVerificationProfile(args.projectRoot);
  if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else process.stdout.write(render(plan));
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  render,
  usage,
};

#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { collectDashboard } = require('./dashboard');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    json: false,
    run: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--json') args.json = true;
    else if (arg === '--run') args.run = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/continue-action.js [--json] [--run] [--project-root <path>]',
    '',
    'Resolves the deterministic action for /do continue.',
    '--run executes local repair commands such as package-delivery; skill routes are printed for the agent to invoke.',
  ].join('\n');
}

function routeAction(snapshot) {
  const needsReviewPackage = snapshot.campaigns.find((campaign) => campaign.status === 'needs-review-package');
  if (needsReviewPackage) {
    return {
      kind: 'local-command',
      label: `Package ${needsReviewPackage.slug} for review`,
      command: `node scripts/package-delivery.js ${needsReviewPackage.slug}`,
      args: [path.join(__dirname, 'package-delivery.js'), needsReviewPackage.slug],
      why: 'The campaign is ready for review packaging, but review-package evidence is not resolved yet.',
      runbook: 'docs/CAMPAIGNS.md#repair-states',
    };
  }

  const activeCampaign = snapshot.campaigns.find((campaign) => campaign.status === 'active' || campaign.status === 'needs-continue');
  if (activeCampaign) {
    return {
      kind: 'skill-route',
      label: `Resume ${activeCampaign.slug}`,
      command: '/archon continue',
      why: 'An active campaign is available and should continue through Archon.',
      runbook: 'skills/archon/SKILL.md',
    };
  }

  const fleetSession = snapshot.fleetSessions.find((session) => {
    return /^(active|needs-continue)$/i.test(String(session.status || ''));
  });
  if (fleetSession) {
    return {
      kind: 'skill-route',
      label: `Resume fleet session ${fleetSession.slug}`,
      command: '/fleet continue',
      why: 'A Fleet session is active or marked needs-continue.',
      runbook: 'skills/fleet/SKILL.md',
    };
  }

  return {
    kind: 'none',
    label: 'No active campaign or fleet session found',
    command: '',
    why: 'Nothing requires /do continue right now.',
    runbook: 'skills/do/SKILL.md',
  };
}

function runLocalCommand(projectRoot, action) {
  if (action.kind !== 'local-command') {
    return { executed: false, status: 0 };
  }

  const result = spawnSync(process.execPath, action.args, {
    cwd: projectRoot,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    executed: true,
    status: result.status ?? 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function render(action, runResult = null) {
  const lines = [
    'Continue Action',
    '='.repeat(40),
    `Kind: ${action.kind}`,
    `Label: ${action.label}`,
    `Command: ${action.command || '(none)'}`,
    `Why: ${action.why}`,
    `Runbook: ${action.runbook}`,
  ];
  if (runResult && runResult.executed) {
    lines.push(`Executed: yes`);
    lines.push(`Exit Code: ${runResult.status}`);
    if (runResult.stdout.trim()) lines.push(runResult.stdout.trim());
    if (runResult.stderr.trim()) lines.push(runResult.stderr.trim());
  } else if (runResult) {
    lines.push('Executed: no');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const projectRoot = path.resolve(args.projectRoot);
  const snapshot = collectDashboard({ projectRoot });
  const action = routeAction(snapshot);
  const runResult = args.run ? runLocalCommand(projectRoot, action) : null;
  const payload = { action, run: runResult };

  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stdout.write(render(action, runResult));

  if (runResult && runResult.executed && runResult.status !== 0) {
    process.exitCode = runResult.status;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  render,
  routeAction,
  runLocalCommand,
  usage,
};

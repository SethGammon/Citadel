#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { collectDashboard } = require('./dashboard');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    pr: '',
    verification: 'npm run test',
    runVerification: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--pr') args.pr = argv[++index] || '';
    else if (arg === '--verification') args.verification = argv[++index] || '';
    else if (arg === '--run-verification') args.runVerification = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/pr-ready.js --pr <pull-request-url> --run-verification',
    '  node scripts/pr-ready.js --pr <pull-request-url> --verification "npm run test"',
    '',
    'Writes .planning/pr-readiness/<branch>.md and exits 0 only when local readiness gates pass.',
  ].join('\n');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function slugify(value) {
  return String(value || 'pr')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'pr';
}

function runGit(projectRoot, args) {
  try {
    return spawnSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).stdout.trim();
  } catch {
    return '';
  }
}

function splitCommand(command) {
  const matches = String(command || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ''));
}

function runVerification(projectRoot, command) {
  if (!command) {
    return { status: 'skipped', command: '', exitCode: null, stdout: '', stderr: '' };
  }

  const parts = splitCommand(command);
  if (parts.length === 0) {
    return { status: 'skipped', command, exitCode: null, stdout: '', stderr: '' };
  }

  const isWindowsNpm = process.platform === 'win32' && parts[0] === 'npm';
  const executable = isWindowsNpm ? 'cmd.exe' : parts[0];
  const commandArgs = isWindowsNpm ? ['/d', '/s', '/c', 'npm', ...parts.slice(1)] : parts.slice(1);
  const result = spawnSync(executable, commandArgs, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  return {
    status: result.status === 0 ? 'pass' : 'fail',
    command,
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function validatePrUrl(pr) {
  if (!pr) return 'missing pull request URL';
  if (!/^https?:\/\/.+\/pull\/\d+/i.test(pr)) return 'PR must be a pull request URL';
  return null;
}

function summarizeDashboard(snapshot) {
  const pending = snapshot.pending || {};
  const problemSummary = snapshot.problemSummary || {};
  const issues = [];
  if (snapshot.gitStatus?.dirty) issues.push(`${snapshot.gitStatus.changedFiles} uncommitted file(s)`);
  if ((pending.docSync || 0) > 0) issues.push(`${pending.docSync} doc-sync item(s) queued`);
  if ((pending.mergeReviews || 0) > 0) issues.push(`${pending.mergeReviews} merge review item(s) queued`);
  if ((pending.intakeItems || 0) > 0) issues.push(`${pending.intakeItems} intake item(s) queued`);
  if ((problemSummary.actionable || 0) > 0) issues.push(`${problemSummary.actionable} actionable hook problem(s)`);
  if ((snapshot.repairs || []).some((repair) => repair.repairAvailable)) {
    issues.push(`${snapshot.repairs.filter((repair) => repair.repairAvailable).length} repair action(s) queued`);
  }
  return { issues };
}

function renderReport(readiness) {
  const lines = [
    `# PR Readiness: ${readiness.branch}`,
    '',
    `Generated: ${readiness.generatedAt}`,
    `Status: ${readiness.ready ? 'ready' : 'blocked'}`,
    `PR: ${readiness.pr || '(missing)'}`,
    `Branch: ${readiness.branch}`,
    `Head: ${readiness.head || '(unknown)'}`,
    '',
    '## Gates',
    '',
    '| Gate | Status | Detail |',
    '|---|---|---|',
    `| Pull request URL | ${readiness.gates.prUrl.pass ? 'pass' : 'fail'} | ${readiness.gates.prUrl.detail} |`,
    `| Git worktree | ${readiness.gates.git.pass ? 'pass' : 'fail'} | ${readiness.gates.git.detail} |`,
    `| Dashboard repairs | ${readiness.gates.dashboard.pass ? 'pass' : 'fail'} | ${readiness.gates.dashboard.detail} |`,
    `| Verification | ${readiness.gates.verification.pass ? 'pass' : 'fail'} | ${readiness.gates.verification.detail} |`,
    '',
    '## Next Action',
    '',
    readiness.ready
      ? '- Mark the draft PR ready for review or ask for approval to merge.'
      : `- Resolve blockers: ${readiness.blockers.join('; ')}`,
    '',
    '---HANDOFF---',
    `- PR: ${readiness.pr || '(missing)'}`,
    `- Branch: ${readiness.branch}`,
    `- Readiness: ${readiness.ready ? 'ready' : 'blocked'}`,
    `- Verification: ${readiness.verification.status} (${readiness.verification.command || 'none'})`,
    '---',
    '',
  ];
  return lines.join('\n');
}

function assessReadiness(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const branch = runGit(root, ['branch', '--show-current']) || 'detached';
  const head = runGit(root, ['rev-parse', '--short', 'HEAD']);
  const verification = options.runVerification
    ? runVerification(root, options.verification)
    : { status: 'not-run', command: options.verification || '', exitCode: null, stdout: '', stderr: '' };
  const snapshot = collectDashboard({ projectRoot: root });
  const dashboard = summarizeDashboard(snapshot);
  const prIssue = validatePrUrl(options.pr || '');

  const gates = {
    prUrl: {
      pass: !prIssue,
      detail: prIssue || options.pr,
    },
    git: {
      pass: !snapshot.gitStatus?.dirty,
      detail: snapshot.gitStatus?.dirty ? `${snapshot.gitStatus.changedFiles} uncommitted file(s)` : 'clean',
    },
    dashboard: {
      pass: dashboard.issues.length === 0,
      detail: dashboard.issues.length === 0 ? 'no queued repairs' : dashboard.issues.join('; '),
    },
    verification: {
      pass: verification.status === 'pass',
      detail: verification.status === 'pass'
        ? `${verification.command} exited 0`
        : (verification.status === 'not-run' ? 'verification was not run by this finalizer' : `${verification.command} exited ${verification.exitCode}`),
    },
  };

  const blockers = Object.entries(gates)
    .filter(([, gate]) => !gate.pass)
    .map(([name, gate]) => `${name}: ${gate.detail}`);

  const readiness = {
    generatedAt: options.now || new Date().toISOString(),
    projectRoot: root,
    branch,
    head,
    pr: options.pr || '',
    ready: blockers.length === 0,
    blockers,
    gates,
    verification,
    dashboard: {
      pending: snapshot.pending,
      problemSummary: snapshot.problemSummary,
      repairs: snapshot.repairs,
    },
  };

  const outDir = path.join(root, '.planning', 'pr-readiness');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${slugify(branch)}.md`);
  fs.writeFileSync(outPath, renderReport(readiness), 'utf8');
  readiness.reportPath = normalizePath(path.relative(root, outPath));
  return readiness;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const readiness = assessReadiness(args.projectRoot, {
    pr: args.pr,
    verification: args.verification,
    runVerification: args.runVerification,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
  } else {
    process.stdout.write(`PR readiness: ${readiness.ready ? 'ready' : 'blocked'}\n`);
    process.stdout.write(`Report: ${readiness.reportPath}\n`);
    if (readiness.blockers.length > 0) {
      process.stdout.write(`Blockers: ${readiness.blockers.join('; ')}\n`);
    }
  }

  process.exitCode = readiness.ready ? 0 : 1;
}

if (require.main === module) main();

module.exports = {
  assessReadiness,
  parseArgs,
  renderReport,
  runVerification,
  splitCommand,
  summarizeDashboard,
  usage,
};

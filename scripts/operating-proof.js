#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { collectDashboard } = require('./dashboard');
const { buildPreview } = require('./route-preview');
const { readPackageScripts, selectVerificationProfile } = require('../core/verification/profiles');

const DEFAULT_ROUTE_REQUEST = 'review README.md for first-time developer friction';

function parseArgs(argv) {
  const args = {
    projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    json: false,
    write: false,
    runVerification: false,
    routeRequest: DEFAULT_ROUTE_REQUEST,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--json') args.json = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--run-verification') args.runVerification = true;
    else if (arg === '--route-request') args.routeRequest = argv[++index] || DEFAULT_ROUTE_REQUEST;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/operating-proof.js [--json] [--write] [--run-verification] [--project-root <path>]',
    '',
    'Checks the inspectable Citadel operating loop: setup, orient, route, verify, and report.',
    '--write records .planning/operating-proof/latest.md.',
  ].join('\n');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function listExisting(projectRoot, relativePaths) {
  return relativePaths.filter((relativePath) => exists(path.join(projectRoot, relativePath)));
}

function splitCommand(command) {
  const matches = String(command || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ''));
}

function runCommand(projectRoot, command) {
  const parts = splitCommand(command);
  if (parts.length === 0) return { status: 'skipped', exitCode: null, stdout: '', stderr: '' };

  const isWindowsNpm = process.platform === 'win32' && parts[0] === 'npm';
  const executable = isWindowsNpm ? 'cmd.exe' : parts[0];
  const args = isWindowsNpm ? ['/d', '/s', '/c', 'npm', ...parts.slice(1)] : parts.slice(1);
  const result = childProcess.spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  return {
    status: result.status === 0 ? 'pass' : 'fail',
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  };
}

function checkStatus(checks) {
  if (checks.some((check) => check.status === 'fail')) return 'blocked';
  if (checks.some((check) => check.status === 'partial')) return 'partial';
  return 'ready';
}

function checkSetup(projectRoot, dashboard) {
  const requiredState = listExisting(projectRoot, [
    '.planning',
    '.planning/campaigns',
    '.planning/telemetry',
  ]);

  if (dashboard.planningExists) {
    return {
      id: 'setup',
      status: 'pass',
      detail: `planning state present (${requiredState.join(', ') || '.planning'})`,
      evidence: requiredState,
    };
  }

  const setupHint = dashboard.nextAction?.command === '/do setup --express';
  return {
    id: 'setup',
    status: setupHint ? 'partial' : 'fail',
    detail: setupHint
      ? 'project is not initialized yet; dashboard points to /do setup --express'
      : 'project is not initialized and dashboard did not provide an express setup path',
    evidence: setupHint ? ['/do setup --express'] : [],
  };
}

function checkOrient(dashboard) {
  const action = dashboard.nextAction || {};
  if (!action.command) {
    return {
      id: 'orient',
      status: 'fail',
      detail: 'dashboard did not expose a next action',
      evidence: [],
    };
  }

  return {
    id: 'orient',
    status: 'pass',
    detail: `${action.label || 'next action'} -> ${action.command}`,
    evidence: [
      `command=${action.command}`,
      `runbook=${action.runbook || '(none)'}`,
    ],
  };
}

function checkRoute(projectRoot, routeRequest) {
  const preview = buildPreview(routeRequest, { projectRoot });
  const usefulRoute = Boolean(preview.selected && preview.command && preview.verification);
  return {
    id: 'route',
    status: usefulRoute ? 'pass' : 'fail',
    detail: `${preview.input} -> ${preview.selected}`,
    evidence: [
      `tier=${preview.tier}`,
      `boundary=${preview.boundary}`,
      `verify=${preview.verification}`,
    ],
    preview,
  };
}

function checkVerify(projectRoot, options = {}) {
  const scripts = readPackageScripts(projectRoot);
  const profile = selectVerificationProfile(projectRoot);
  const command = scripts.test ? 'npm run test' : profile.primaryCommand;
  const hasCommand = Boolean(command);
  const result = options.runVerification && hasCommand ? runCommand(projectRoot, command) : null;

  let status = hasCommand ? 'pass' : 'partial';
  let detail = hasCommand ? `selected ${command}` : 'no verification command was discovered';
  if (result) {
    status = result.status === 'pass' ? 'pass' : 'fail';
    detail = `${command} exited ${result.exitCode}`;
  }

  return {
    id: 'verify',
    status,
    detail,
    evidence: [
      `profile=${profile.id}`,
      `primary=${profile.primaryCommand}`,
      ...profile.commands.slice(0, 4),
    ],
    profile,
    result,
  };
}

function checkReport(projectRoot) {
  const evidence = listExisting(projectRoot, [
    '.planning/operator-console/latest.md',
    '.planning/next-actions/latest.md',
    '.planning/stack-readiness/latest.md',
    '.planning/approval-capsules/latest.md',
  ]);

  let prReadiness = [];
  const readinessDir = path.join(projectRoot, '.planning', 'pr-readiness');
  try {
    prReadiness = fs.readdirSync(readinessDir)
      .filter((entry) => entry.endsWith('.md'))
      .slice(0, 5)
      .map((entry) => normalizePath(path.join('.planning', 'pr-readiness', entry)));
  } catch {
    prReadiness = [];
  }

  const allEvidence = [...evidence, ...prReadiness];
  return {
    id: 'report',
    status: allEvidence.length > 0 ? 'pass' : 'partial',
    detail: allEvidence.length > 0
      ? `${allEvidence.length} durable artifact(s) found`
      : 'no durable proof artifacts found yet',
    evidence: allEvidence,
  };
}

function buildProof(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const dashboard = collectDashboard({ projectRoot: root });
  const checks = [
    checkSetup(root, dashboard),
    checkOrient(dashboard),
    checkRoute(root, options.routeRequest || DEFAULT_ROUTE_REQUEST),
    checkVerify(root, { runVerification: Boolean(options.runVerification) }),
    checkReport(root),
  ];

  return {
    generatedAt: options.now || new Date().toISOString(),
    projectRoot: root,
    status: checkStatus(checks),
    checks,
    summary: {
      setup: checks.find((check) => check.id === 'setup')?.status,
      orient: checks.find((check) => check.id === 'orient')?.status,
      route: checks.find((check) => check.id === 'route')?.status,
      verify: checks.find((check) => check.id === 'verify')?.status,
      report: checks.find((check) => check.id === 'report')?.status,
    },
  };
}

function renderProof(proof) {
  const lines = [
    'Citadel Operating Proof',
    '='.repeat(40),
    `Generated: ${proof.generatedAt}`,
    `Project: ${proof.projectRoot}`,
    `Status: ${proof.status}`,
    '',
    'Checks',
  ];

  for (const check of proof.checks) {
    lines.push(`- ${check.id}: ${check.status} - ${check.detail}`);
    for (const item of (check.evidence || []).slice(0, 5)) {
      lines.push(`  evidence: ${item}`);
    }
  }

  lines.push('');
  lines.push('Interpretation');
  if (proof.status === 'ready') {
    lines.push('The project has an inspectable operating loop: setup state, next action, route preview, verification command, and durable artifact evidence.');
  } else if (proof.status === 'partial') {
    lines.push('The operating loop is partially inspectable. Follow the partial checks before using this as public proof.');
  } else {
    lines.push('The operating loop has blockers. Resolve failed checks before using this as proof.');
  }

  lines.push('');
  lines.push('---HANDOFF---');
  lines.push(`- Status: ${proof.status}`);
  lines.push(`- Setup: ${proof.summary.setup}`);
  lines.push(`- Route: ${proof.summary.route}`);
  lines.push(`- Verify: ${proof.summary.verify}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function writeProof(projectRoot, proof) {
  const outDir = path.join(projectRoot, '.planning', 'operating-proof');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'latest.md');
  fs.writeFileSync(outPath, renderProof(proof), 'utf8');
  proof.reportPath = normalizePath(path.relative(projectRoot, outPath));
  return proof.reportPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const proof = buildProof(args.projectRoot, {
    runVerification: args.runVerification,
    routeRequest: args.routeRequest,
  });
  if (args.write) writeProof(path.resolve(args.projectRoot), proof);

  if (args.json) process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  else {
    process.stdout.write(renderProof(proof));
    if (proof.reportPath) process.stdout.write(`Report: ${proof.reportPath}\n`);
  }

  process.exitCode = proof.status === 'blocked' ? 1 : 0;
}

if (require.main === module) main();

module.exports = {
  buildProof,
  checkReport,
  checkRoute,
  checkSetup,
  checkVerify,
  parseArgs,
  renderProof,
  usage,
  writeProof,
};

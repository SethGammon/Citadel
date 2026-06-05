#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { writeApprovalCapsule } = require('./next-action');

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
    '  node scripts/stack-plan.js [--json] [--project-root <path>]',
    '',
    'Reads .planning/pr-readiness reports and writes an ordered stack landing plan.',
    'This command never marks PRs ready, merges PRs, or pushes branches.',
  ].join('\n');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function slug(value) {
  return String(value || 'stack')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'stack';
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function lineValue(content, label) {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, 'm');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function gateStatus(content, gateLabel) {
  const escaped = gateLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|`, 'm');
  const match = content.match(pattern);
  if (!match) return { pass: false, detail: 'missing gate' };
  return {
    pass: match[1].trim() === 'pass',
    detail: match[2].trim(),
  };
}

function parseReadinessReport(projectRoot, filePath) {
  const content = readText(filePath);
  if (!content) return null;
  const relativePath = normalizePath(path.relative(projectRoot, filePath));
  const status = lineValue(content, 'Status') || 'unknown';
  const branch = lineValue(content, 'Branch') || path.basename(filePath, path.extname(filePath));
  return {
    path: relativePath,
    generatedAt: lineValue(content, 'Generated') || null,
    status,
    ready: status === 'ready',
    pr: lineValue(content, 'PR') || null,
    branch,
    head: lineValue(content, 'Head') || null,
    gates: {
      prUrl: gateStatus(content, 'Pull request URL'),
      git: gateStatus(content, 'Git worktree'),
      dashboard: gateStatus(content, 'Dashboard repairs'),
      verification: gateStatus(content, 'Verification'),
    },
  };
}

function readReadinessReports(projectRoot) {
  const dir = path.join(projectRoot, '.planning', 'pr-readiness');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => parseReadinessReport(projectRoot, path.join(dir, name)))
    .filter(Boolean);
}

function defaultIsAncestor(projectRoot, ancestor, descendant) {
  if (!ancestor || !descendant || ancestor === descendant) return false;
  try {
    childProcess.execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function resolveGitRef(projectRoot, ref) {
  if (!ref) return null;
  try {
    return childProcess.execFileSync('git', ['rev-parse', '--verify', ref], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().slice(0, 7);
  } catch {
    return null;
  }
}

function currentBranchHead(projectRoot, branch, options = {}) {
  if (!branch) return null;
  if (options.resolveBranchHead) return options.resolveBranchHead(branch);
  return resolveGitRef(projectRoot, `refs/remotes/origin/${branch}`)
    || resolveGitRef(projectRoot, `refs/heads/${branch}`);
}

function annotateCurrentHeads(projectRoot, reports, options = {}) {
  return reports.map((report) => ({
    ...report,
    currentHead: currentBranchHead(projectRoot, report.branch, options),
  }));
}

function orderReports(projectRoot, reports, options = {}) {
  const isAncestor = options.isAncestor || ((ancestor, descendant) => defaultIsAncestor(projectRoot, ancestor, descendant));
  return [...reports].sort((left, right) => {
    if (left.head && right.head) {
      if (isAncestor(left.head, right.head)) return -1;
      if (isAncestor(right.head, left.head)) return 1;
    }
    const generated = String(left.generatedAt || '').localeCompare(String(right.generatedAt || ''));
    if (generated !== 0) return generated;
    return String(left.branch || '').localeCompare(String(right.branch || ''));
  });
}

function blockerReasons(report) {
  const reasons = [];
  if (!report.ready) reasons.push(`readiness status is ${report.status}`);
  if (report.currentHead && report.head && report.currentHead !== report.head) {
    reasons.push(`readiness head ${report.head} does not match current branch head ${report.currentHead}`);
  }
  for (const [gate, result] of Object.entries(report.gates || {})) {
    if (!result.pass) reasons.push(`${gate} gate failed: ${result.detail}`);
  }
  return reasons;
}

function statusForStack(reports, blocked) {
  if (reports.length === 0) return 'no-stack';
  if (blocked.length > 0) return 'blocked';
  return 'approval-needed';
}

function buildNextAction(status, ordered) {
  if (status === 'no-stack') {
    return {
      label: 'No PR readiness reports found',
      command: 'node scripts/pr-ready.js --pr <pull-request-url> --run-verification',
      canRunNow: false,
      why: 'No stack can be planned until at least one PR readiness report exists.',
    };
  }
  if (status === 'blocked') {
    return {
      label: 'Resolve blocked PR readiness report',
      command: 'node scripts/pr-ready.js --pr <pull-request-url> --run-verification',
      canRunNow: false,
      why: 'At least one PR readiness report is blocked or missing a passing gate.',
    };
  }
  return {
    label: 'Approve stack landing order',
    command: ordered.map((report) => report.pr || report.branch).join(' -> '),
    canRunNow: false,
    why: 'Every visible PR readiness report is ready; human approval is required before marking drafts ready or merging.',
  };
}

function buildPostApprovalRunbook(status, ordered) {
  if (status === 'no-stack') {
    return [
      {
        step: 'Generate PR readiness reports',
        gate: 'At least one report exists in .planning/pr-readiness.',
        action: 'Run node scripts/pr-ready.js --pr <pull-request-url> --run-verification for each PR.',
      },
    ];
  }
  if (status === 'blocked') {
    return [
      {
        step: 'Refresh blocked readiness reports',
        gate: 'Every report status is ready and every readiness gate passes.',
        action: 'Fix the blocked PRs, then rerun node scripts/pr-ready.js --pr <pull-request-url> --run-verification.',
      },
    ];
  }
  const steps = [
    {
      step: 'Reconfirm stack state',
      gate: 'npm run stack:plan reports approval-needed with zero blocked items.',
      action: 'Read .planning/stack-readiness/latest.md and .planning/approval-capsules/latest.md.',
    },
  ];
  for (const [index, report] of ordered.entries()) {
    const label = report.pr || report.branch;
    steps.push({
      step: `Land ${index + 1}: ${label}`,
      gate: `Readiness report ${report.path} is ready and branch head is ${report.currentHead || report.head || 'current'}.`,
      action: 'Mark ready or merge only after the prior PR in this stack has landed cleanly.',
    });
  }
  steps.push({
    step: 'Verify landed main',
    gate: 'Main contains the final stack head and the selected verification command passes.',
    action: 'Run npm run test, then run npm run stack:plan to confirm no stale readiness remains.',
  });
  return steps;
}

function buildStackApprovalCapsule(projectRoot, stack) {
  if (stack.status !== 'approval-needed') return null;
  return {
    generatedAt: stack.generatedAt,
    projectRoot,
    boundary: 'stack-approval',
    risk: 'medium-high',
    request: `Approve landing stack in order: ${stack.nextAction.command}`,
    action: {
      label: stack.nextAction.label,
      command: stack.nextAction.command,
      why: stack.nextAction.why,
      confidence: 'high',
      runbook: 'docs/CAMPAIGNS.md',
    },
    context: {
      pending: {},
      gitStatus: {},
      problemSummary: {},
      campaigns: [],
      stack: stack.reports.map((report) => ({
        branch: report.branch,
        pr: report.pr,
        head: report.head,
        currentHead: report.currentHead || null,
        readiness: report.status,
        report: report.path,
      })),
    },
    verification: [
      'Run `npm run stack:plan` and confirm the landing order matches the intended stack.',
      'Confirm each listed PR readiness report is current and has no blocked gates.',
      'After approval, mark or merge PRs in the listed order only.',
    ],
    postApprovalRunbook: stack.postApprovalRunbook,
  };
}

function assessStack(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const reports = annotateCurrentHeads(root, options.reports || readReadinessReports(root), options);
  const ordered = orderReports(root, reports, options);
  const blocked = ordered
    .map((report) => ({ report, reasons: blockerReasons(report) }))
    .filter((entry) => entry.reasons.length > 0);
  const status = statusForStack(ordered, blocked);
  const stack = {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    status,
    ready: status === 'approval-needed',
    reports: ordered,
    blocked,
    nextAction: buildNextAction(status, ordered),
  };
  stack.postApprovalRunbook = buildPostApprovalRunbook(status, ordered);
  stack.approvalCapsule = buildStackApprovalCapsule(root, stack);
  if (stack.approvalCapsule && options.writeReport !== false && options.writeApprovalCapsule !== false) {
    writeApprovalCapsule(root, stack.approvalCapsule);
  }
  stack.reportPath = options.writeReport === false ? null : writeStackPlan(root, stack);
  return stack;
}

function renderStackPlan(stack) {
  const lines = [
    'Citadel Stack Landing Plan',
    '='.repeat(40),
    `Generated: ${stack.generatedAt}`,
    `Status: ${stack.status}`,
    `Project: ${stack.projectRoot}`,
    '',
    'Next Action',
    `  Label: ${stack.nextAction.label}`,
    `  Command: ${stack.nextAction.command}`,
    `  Can run now: ${stack.nextAction.canRunNow ? 'yes' : 'no'}`,
    `  Why: ${stack.nextAction.why}`,
    '',
    'Landing Order',
  ];

  if (stack.reports.length === 0) {
    lines.push('  (no PR readiness reports found)');
  } else {
    for (const [index, report] of stack.reports.entries()) {
      lines.push(`  ${index + 1}. ${report.branch}`);
      lines.push(`     PR: ${report.pr || '(missing)'}`);
      lines.push(`     Head: ${report.head || '(unknown)'}`);
      if (report.currentHead) lines.push(`     Current: ${report.currentHead}`);
      lines.push(`     Readiness: ${report.status}`);
      lines.push(`     Verification: ${report.gates.verification.pass ? 'pass' : 'fail'} (${report.gates.verification.detail})`);
      lines.push(`     Report: ${report.path}`);
    }
  }

  lines.push('');
  lines.push('Blocked Items');
  if (stack.blocked.length === 0) {
    lines.push('  (none)');
  } else {
    for (const entry of stack.blocked) {
      lines.push(`  - ${entry.report.branch}: ${entry.reasons.join('; ')}`);
    }
  }

  lines.push('');
  lines.push('Approval Boundary');
  if (stack.status === 'approval-needed') {
    lines.push('  Human approval is required before marking draft PRs ready or merging the stack.');
    if (stack.approvalCapsule?.path) lines.push(`  Approval capsule: ${stack.approvalCapsule.path}`);
  } else if (stack.status === 'blocked') {
    lines.push('  Resolve blocked readiness gates before requesting merge approval.');
  } else {
    lines.push('  Generate PR readiness reports before requesting stack approval.');
  }

  lines.push('');
  lines.push('Post-Approval Landing Runbook');
  for (const [index, item] of stack.postApprovalRunbook.entries()) {
    lines.push(`  ${index + 1}. ${item.step}`);
    lines.push(`     Gate: ${item.gate}`);
    lines.push(`     Action: ${item.action}`);
  }

  lines.push('');
  lines.push('---HANDOFF---');
  lines.push(`- Status: ${stack.status}`);
  lines.push(`- PRs: ${stack.reports.length}`);
  lines.push(`- Blocked: ${stack.blocked.length}`);
  lines.push(`- Next: ${stack.nextAction.label}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function writeStackPlan(projectRoot, stack) {
  const outDir = path.join(projectRoot, '.planning', 'stack-readiness');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'latest.md');
  fs.writeFileSync(outPath, renderStackPlan(stack), 'utf8');
  return normalizePath(path.relative(projectRoot, outPath));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const stack = assessStack(args.projectRoot);
  if (args.json) process.stdout.write(`${JSON.stringify(stack, null, 2)}\n`);
  else {
    process.stdout.write(renderStackPlan(stack));
    process.stdout.write(`Report: ${stack.reportPath}\n`);
  }
  process.exitCode = stack.status === 'blocked' ? 1 : 0;
}

if (require.main === module) main();

module.exports = {
  assessStack,
  blockerReasons,
  currentBranchHead,
  annotateCurrentHeads,
  buildStackApprovalCapsule,
  buildNextAction,
  buildPostApprovalRunbook,
  orderReports,
  parseArgs,
  parseReadinessReport,
  readReadinessReports,
  renderStackPlan,
  usage,
  writeStackPlan,
};

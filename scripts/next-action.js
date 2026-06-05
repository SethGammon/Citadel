#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { collectDashboard } = require('./dashboard');

function parseArgs(argv) {
  const args = {
    projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    json: false,
    run: false,
    maxSteps: 3,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--json') args.json = true;
    else if (arg === '--run') args.run = true;
    else if (arg === '--max-steps') {
      const parsed = Number(argv[++index]);
      if (!Number.isNaN(parsed) && parsed > 0) args.maxSteps = parsed;
    } else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/next-action.js [--json] [--run] [--max-steps <n>] [--project-root <path>]',
    '',
    'Reads the Citadel dashboard and resolves the next useful action.',
    '--run executes only deterministic local repairs, then re-checks dashboard state.',
  ].join('\n');
}

function localRepairFor(action) {
  const command = String(action?.command || '').trim();
  if (!command) return null;

  if (command === '/learn --doc-sync') {
    return {
      kind: 'local-repair',
      command,
      args: [path.join(__dirname, '..', 'hooks_src', 'doc-sync.js'), '--project-root'],
      appendProjectRoot: true,
      why: 'Drain queued doc-sync items and write the latest local review report.',
    };
  }

  const packageMatch = command.match(/^node\s+scripts\/package-delivery\.js\s+(.+)$/);
  if (packageMatch) {
    return {
      kind: 'local-repair',
      command,
      args: [path.join(__dirname, 'package-delivery.js'), packageMatch[1]],
      why: 'Create the deterministic review package for a campaign that is ready to package.',
    };
  }

  const completeMatch = command.match(/^node\s+scripts\/campaign\.js\s+complete\s+([^\s]+)\s+--archive$/);
  if (completeMatch) {
    return {
      kind: 'local-repair',
      command,
      args: [path.join(__dirname, 'campaign.js'), 'complete', completeMatch[1], '--archive'],
      why: 'Complete and archive a campaign whose phases are already complete.',
    };
  }

  return null;
}

function runNode(projectRoot, repair) {
  const args = [...repair.args];
  if (repair.appendProjectRoot) args.push(projectRoot);
  if (repair.appendProjectRootFlag) args.push('--project-root', projectRoot);

  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function summarizeSnapshot(snapshot) {
  return {
    nextAction: snapshot.nextAction,
    pending: snapshot.pending,
    gitStatus: snapshot.gitStatus,
    problemSummary: snapshot.problemSummary,
    repairs: (snapshot.repairs || []).map((repair) => ({
      label: repair.label,
      command: repair.command,
      repairAvailable: repair.repairAvailable,
    })),
  };
}

function slugify(value) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'approval';
}

function compactTimestamp(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'unknown-time';
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function isSetupCommand(command) {
  return command === '/do setup' || command === '/do setup --express';
}

function approvalBoundaryFor(action) {
  const command = String(action?.command || '').trim();
  if (!command) return 'manual-review';
  if (command === '/autopilot') return 'campaign-intake';
  if (command === '/do continue') return 'agent-continuation';
  if (command === '/merge-review') return 'merge-review';
  if (isSetupCommand(command)) return 'project-setup';
  if (command === '/telemetry') return 'telemetry-review';
  if (command.startsWith('/')) return 'agent-route';
  if (command.startsWith('git status')) return 'worktree-review';
  return 'manual-review';
}

function approvalRiskFor(action) {
  const command = String(action?.command || '').trim();
  if (command === '/autopilot') return 'medium-high';
  if (command === '/do continue') return 'medium';
  if (command === '/merge-review') return 'medium';
  if (isSetupCommand(command)) return 'medium';
  if (command === '/telemetry') return 'low';
  if (command.startsWith('git status')) return 'low';
  return 'medium';
}

function verificationPlanFor(action) {
  const command = String(action?.command || '').trim();
  if (command === '/autopilot') {
    return [
      'Inspect the generated campaign or brief before implementation starts.',
      'Run `node scripts/dashboard.js --json` and confirm intake count changed as expected.',
      'Confirm the resulting campaign has claimed scope, phases, and exit evidence.',
    ];
  }
  if (command === '/do continue') {
    return [
      'Run the verification command selected by the campaign or changed subsystem.',
      'Run `node scripts/dashboard.js --json` and confirm the campaign advanced or produced a new repair.',
      'Record the changed files, evidence, and remaining next action in the campaign file.',
    ];
  }
  if (command === '/merge-review') {
    return [
      'Inspect every queued merge package before accepting a merge order.',
      'Run the merge-review recommended verification after applying any branch.',
      'Confirm dashboard merge-review queue count falls or the remaining blocker is documented.',
    ];
  }
  if (isSetupCommand(command)) {
    return [
      'Run `node scripts/dashboard.js --json` and confirm `.planning/` exists.',
      'Confirm generated project guidance paths point at the current project root.',
      'Run `node scripts/test-all.js` if setup changed harness files.',
    ];
  }
  if (command === '/telemetry') {
    return [
      'Inspect the actionable hook problems and classify each as fixed, stale, or still blocked.',
      'Run `node scripts/dashboard.js --json` and confirm actionable problem count is understood.',
    ];
  }
  if (command.startsWith('git status')) {
    return [
      'Inspect every changed file and separate current-task work from unrelated user changes.',
      'Package, commit, or deliberately leave changes in place with a written handoff.',
      'Run `git status --short` again before starting unrelated work.',
    ];
  }
  return [
    'Run the command only after confirming scope and expected side effects.',
    'Run `node scripts/dashboard.js --json` after the action and inspect the next action.',
    'Record the result in the relevant campaign, review package, or handoff.',
  ];
}

function approvalRequestFor(action) {
  const command = String(action?.command || '').trim();
  if (command.startsWith('git status')) return 'Review the uncommitted worktree state before starting unrelated work.';
  return `Approve running \`${command || '(manual review)'}\` for this project.`;
}

function buildApprovalCapsule(projectRoot, snapshot, generatedAt) {
  const action = snapshot.nextAction || {};
  if (!action.command || localRepairFor(action)) return null;
  if (!snapshot.repairs || snapshot.repairs.length === 0) return null;

  return {
    generatedAt,
    projectRoot,
    boundary: approvalBoundaryFor(action),
    risk: approvalRiskFor(action),
    request: approvalRequestFor(action),
    action: {
      label: action.label || '(unlabeled)',
      command: action.command,
      why: action.why || '',
      confidence: action.confidence || 'medium',
      runbook: action.runbook || null,
    },
    context: {
      pending: snapshot.pending || {},
      gitStatus: snapshot.gitStatus || {},
      problemSummary: snapshot.problemSummary || {},
      campaigns: (snapshot.campaigns || []).slice(0, 3).map((campaign) => ({
        slug: campaign.slug,
        status: campaign.status,
        phase: campaign.phase?.label || null,
      })),
    },
    verification: verificationPlanFor(action),
  };
}

function resolveNext(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const steps = [];
  const generatedAt = options.now || new Date().toISOString();
  let snapshot = collectDashboard({ projectRoot: root });

  if (!options.run) {
    const repairs = snapshot.repairs || [];
    const outcome = repairs.length === 0
      ? 'idle'
      : (localRepairFor(snapshot.nextAction) ? 'repair-available' : 'needs-human');
    return {
      projectRoot: root,
      generatedAt,
      mode: 'inspect',
      outcome,
      initial: summarizeSnapshot(snapshot),
      final: summarizeSnapshot(snapshot),
      steps,
      approvalCapsule: buildApprovalCapsule(root, snapshot, generatedAt),
    };
  }

  const maxSteps = options.maxSteps || 3;
  for (let index = 0; index < maxSteps; index++) {
    const action = snapshot.nextAction || {};
    const repair = localRepairFor(action);
    if (!repair) {
      return {
        projectRoot: root,
        generatedAt,
        mode: 'run',
        outcome: (snapshot.repairs || []).length === 0 ? 'idle' : 'needs-human',
        initial: steps[0]?.before || summarizeSnapshot(snapshot),
        final: summarizeSnapshot(snapshot),
        steps,
        approvalCapsule: buildApprovalCapsule(root, snapshot, generatedAt),
      };
    }

    const before = summarizeSnapshot(snapshot);
    const result = runNode(root, repair);
    const after = collectDashboard({ projectRoot: root });
    const step = {
      action,
      repair,
      before,
      result,
      after: summarizeSnapshot(after),
    };
    steps.push(step);
    snapshot = after;

    if (result.status !== 0) {
      return {
        projectRoot: root,
        generatedAt,
        mode: 'run',
        outcome: 'failed',
        initial: steps[0].before,
        final: summarizeSnapshot(snapshot),
        steps,
        approvalCapsule: null,
      };
    }
  }

  return {
    projectRoot: root,
    generatedAt,
    mode: 'run',
    outcome: 'max-steps-reached',
    initial: steps[0]?.before || summarizeSnapshot(snapshot),
    final: summarizeSnapshot(snapshot),
    steps,
    approvalCapsule: buildApprovalCapsule(root, snapshot, generatedAt),
  };
}

function render(report) {
  const lines = [
    'Citadel Next Action',
    '='.repeat(40),
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Outcome: ${report.outcome}`,
    `Project: ${report.projectRoot}`,
    '',
    'Initial',
    `  Command: ${report.initial.nextAction?.command || '(none)'}`,
    `  Why: ${report.initial.nextAction?.why || '(none)'}`,
    '',
    'Steps',
  ];

  if (report.steps.length === 0) {
    lines.push('  (none executed)');
  } else {
    for (const [index, step] of report.steps.entries()) {
      lines.push(`  ${index + 1}. ${step.action.label}`);
      lines.push(`     command: ${step.repair.command}`);
      lines.push(`     exit: ${step.result.status}`);
      if (step.result.stdout.trim()) lines.push(`     stdout: ${step.result.stdout.trim().split(/\r?\n/)[0]}`);
      if (step.result.stderr.trim()) lines.push(`     stderr: ${step.result.stderr.trim().split(/\r?\n/)[0]}`);
    }
  }

  lines.push('');
  lines.push('Final');
  lines.push(`  Command: ${report.final.nextAction?.command || '(none)'}`);
  lines.push(`  Why: ${report.final.nextAction?.why || '(none)'}`);
  lines.push(`  Pending: docSync=${report.final.pending?.docSync || 0}, mergeReviews=${report.final.pending?.mergeReviews || 0}, intakeItems=${report.final.pending?.intakeItems || 0}`);
  lines.push(`  Git dirty: ${report.final.gitStatus?.dirty ? 'yes' : 'no'}`);

  lines.push('');
  lines.push('Approval Capsule');
  if (!report.approvalCapsule) {
    lines.push('  (none required)');
  } else {
    lines.push(`  Request: ${report.approvalCapsule.request}`);
    lines.push(`  Boundary: ${report.approvalCapsule.boundary}`);
    lines.push(`  Risk: ${report.approvalCapsule.risk}`);
    lines.push(`  Path: ${report.approvalCapsule.path || '(not written)'}`);
  }

  lines.push('');
  lines.push('---HANDOFF---');
  lines.push(`- Outcome: ${report.outcome}`);
  lines.push(`- Initial command: ${report.initial.nextAction?.command || '(none)'}`);
  lines.push(`- Steps executed: ${report.steps.length}`);
  lines.push(`- Final command: ${report.final.nextAction?.command || '(none)'}`);
  if (report.approvalCapsule) lines.push(`- Approval capsule: ${report.approvalCapsule.path || 'pending write'}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function writeReport(projectRoot, report) {
  const outDir = path.join(projectRoot, '.planning', 'next-actions');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'latest.md');
  fs.writeFileSync(outPath, render(report), 'utf8');
  return normalizePath(path.relative(projectRoot, outPath));
}

function renderApprovalCapsule(capsule) {
  const lines = [
    'Citadel Approval Capsule',
    '='.repeat(40),
    `Generated: ${capsule.generatedAt}`,
    `Project: ${capsule.projectRoot}`,
    `Boundary: ${capsule.boundary}`,
    `Risk: ${capsule.risk}`,
    '',
    'Request',
    capsule.request,
    '',
    'Action',
    `  Label: ${capsule.action.label}`,
    `  Command: ${capsule.action.command}`,
    `  Why: ${capsule.action.why}`,
    `  Confidence: ${capsule.action.confidence}`,
  ];

  if (capsule.action.runbook) lines.push(`  Runbook: ${capsule.action.runbook}`);

  lines.push('');
  lines.push('Context');
  lines.push(`  Pending: docSync=${capsule.context.pending.docSync || 0}, mergeReviews=${capsule.context.pending.mergeReviews || 0}, intakeItems=${capsule.context.pending.intakeItems || 0}`);
  lines.push(`  Git dirty: ${capsule.context.gitStatus.dirty ? 'yes' : 'no'}`);
  lines.push(`  Actionable hook problems: ${capsule.context.problemSummary.actionable || 0}`);
  if (capsule.context.campaigns.length === 0) {
    lines.push('  Campaigns: none active');
  } else {
    lines.push('  Campaigns:');
    for (const campaign of capsule.context.campaigns) {
      lines.push(`    - ${campaign.slug}: ${campaign.status}${campaign.phase ? ` (${campaign.phase})` : ''}`);
    }
  }
  if (Array.isArray(capsule.context.stack) && capsule.context.stack.length > 0) {
    lines.push('  Stack:');
    for (const [index, item] of capsule.context.stack.entries()) {
      lines.push(`    ${index + 1}. ${item.pr || item.branch} (${item.branch})`);
      lines.push(`       head=${item.head || '(unknown)'}, current=${item.currentHead || '(unknown)'}, readiness=${item.readiness || '(unknown)'}`);
      if (item.report) lines.push(`       report=${item.report}`);
    }
  }

  lines.push('');
  lines.push('Verification Plan');
  for (const item of capsule.verification) lines.push(`  - ${item}`);

  if (Array.isArray(capsule.postApprovalRunbook) && capsule.postApprovalRunbook.length > 0) {
    lines.push('');
    lines.push('Post-Approval Landing Runbook');
    for (const [index, item] of capsule.postApprovalRunbook.entries()) {
      lines.push(`  ${index + 1}. ${item.step}`);
      lines.push(`     Gate: ${item.gate}`);
      lines.push(`     Action: ${item.action}`);
    }
  }

  lines.push('');
  lines.push('---HANDOFF---');
  lines.push(`- Approval requested: ${capsule.action.command}`);
  lines.push(`- Boundary: ${capsule.boundary}`);
  lines.push(`- Risk: ${capsule.risk}`);
  lines.push(`- Verify with: ${capsule.verification[0] || 'inspect result'}`);
  lines.push('---');

  return `${lines.join('\n')}\n`;
}

function writeApprovalCapsule(projectRoot, capsule) {
  if (!capsule) return null;
  const outDir = path.join(projectRoot, '.planning', 'approval-capsules');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = `${compactTimestamp(capsule.generatedAt)}-${slugify(capsule.action.command || capsule.action.label)}.md`;
  const outPath = path.join(outDir, filename);
  const latestPath = path.join(outDir, 'latest.md');
  const relativePath = normalizePath(path.relative(projectRoot, outPath));
  capsule.path = relativePath;
  capsule.latestPath = normalizePath(path.relative(projectRoot, latestPath));
  const rendered = renderApprovalCapsule(capsule);
  fs.writeFileSync(outPath, rendered, 'utf8');
  fs.writeFileSync(latestPath, rendered, 'utf8');
  return relativePath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const report = resolveNext(args.projectRoot, {
    run: args.run,
    maxSteps: args.maxSteps,
  });
  if (report.approvalCapsule) {
    writeApprovalCapsule(path.resolve(args.projectRoot), report.approvalCapsule);
  }
  report.reportPath = writeReport(path.resolve(args.projectRoot), report);

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(render(report));
    process.stdout.write(`Report: ${report.reportPath}\n`);
  }

  if (report.outcome === 'failed') {
    const failed = report.steps.find((step) => step.result.status !== 0);
    process.exitCode = failed?.result.status || 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildApprovalCapsule,
  localRepairFor,
  parseArgs,
  render,
  renderApprovalCapsule,
  resolveNext,
  usage,
  writeApprovalCapsule,
  writeReport,
};

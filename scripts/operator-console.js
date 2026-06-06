#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { collectDashboard } = require('./dashboard');
const {
  localRepairFor,
  resolveNext,
  writeApprovalCapsule,
  writeReport: writeNextReport,
} = require('./next-action');
const { selectVerificationProfile } = require('../core/verification/profiles');

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    json: false,
    summary: false,
    run: false,
    maxSteps: 3,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--json') args.json = true;
    else if (arg === '--summary') args.summary = true;
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
    '  node scripts/operator-console.js [--json|--summary] [--run] [--max-steps <n>] [--project-root <path>]',
    '',
    'Renders the decision-first Citadel operator cockpit.',
    '--summary prints a compact JSON contract for scripts and agents.',
    '--run executes only deterministic local repairs, then writes a refreshed console report.',
  ].join('\n');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function countByStatus(items, predicate) {
  return (items || []).filter(predicate).length;
}

function statusForDecision(decision) {
  if (decision.outcome === 'idle') return 'idle';
  if (decision.outcome === 'repair-available') return 'repair-ready';
  if (decision.outcome === 'needs-human') return 'approval-needed';
  if (decision.outcome === 'failed') return 'failed';
  if (decision.outcome === 'max-steps-reached') return 'needs-review';
  return decision.outcome || 'unknown';
}

function summarizeDashboard(snapshot) {
  const campaigns = snapshot.campaigns || [];
  const fleetSessions = snapshot.fleetSessions || [];
  const pending = snapshot.pending || {};
  const artifacts = snapshot.operatorArtifacts || {};

  return {
    planningExists: snapshot.planningExists,
    pending: {
      docSync: pending.docSync || 0,
      mergeReviews: pending.mergeReviews || 0,
      intakeItems: pending.intakeItems || 0,
    },
    git: {
      available: Boolean(snapshot.gitStatus?.available),
      dirty: Boolean(snapshot.gitStatus?.dirty),
      changedFiles: snapshot.gitStatus?.changedFiles || 0,
      sample: snapshot.gitStatus?.sample || [],
    },
    campaigns: {
      active: countByStatus(campaigns, (campaign) => /^(active|needs-continue)$/i.test(String(campaign.status || ''))),
      needsReviewPackage: countByStatus(campaigns, (campaign) => campaign.status === 'needs-review-package'),
      needsCompletion: countByStatus(campaigns, (campaign) => campaign.status === 'needs-completion'),
      needsArchive: countByStatus(campaigns, (campaign) => campaign.status === 'needs-archive'),
      totalVisible: campaigns.length,
    },
    fleet: {
      active: countByStatus(fleetSessions, (session) => /^(active|needs-continue)$/i.test(String(session.status || ''))),
      totalVisible: fleetSessions.length,
    },
    problems: {
      actionable: snapshot.problemSummary?.actionable || 0,
      safetyBlocks: snapshot.problemSummary?.safetyBlocks || 0,
      stale: snapshot.problemSummary?.stale || 0,
    },
    artifacts: {
      nextActionReport: artifacts.nextActionReport || null,
      approvalCapsule: artifacts.approvalCapsule || null,
      staleCount: [
        artifacts.nextActionReport,
        artifacts.approvalCapsule,
      ].filter((artifact) => artifact && artifact.stale).length,
    },
  };
}

function boundaryForDecision(decision) {
  const finalAction = decision.final?.nextAction || decision.initial?.nextAction || {};
  const repair = localRepairFor(finalAction);
  if (decision.approvalCapsule) {
    return {
      kind: decision.approvalCapsule.boundary,
      risk: decision.approvalCapsule.risk,
      request: decision.approvalCapsule.request,
      verification: decision.approvalCapsule.verification || [],
    };
  }
  if (repair) {
    return {
      kind: 'local-repair',
      risk: 'low',
      request: `Run deterministic repair: ${repair.command}`,
      verification: [
        'Re-run `node scripts/operator-console.js` and confirm status becomes idle or a human boundary is explicit.',
        'Run the selected verification profile if source files changed.',
      ],
    };
  }
  return {
    kind: 'none',
    risk: 'low',
    request: 'No approval required.',
    verification: [
      'Run `node scripts/dashboard.js --json` if the idle state looks surprising.',
    ],
  };
}

function compactConsoleSummary(consoleState) {
  const artifacts = consoleState.dashboard.artifacts;
  const staleArtifacts = [
    artifacts.nextActionReport,
    artifacts.approvalCapsule,
  ].filter((artifact) => artifact && artifact.stale);
  const historicalStaleArtifacts = staleArtifacts.filter((artifact) => (
    artifact.path === '.planning/approval-capsules/latest.md' &&
    (artifact.staleReasons || []).includes('no current repair or approval boundary is queued')
  ));

  return {
    status: consoleState.status,
    mode: consoleState.mode,
    command: consoleState.nextAction.command,
    label: consoleState.nextAction.label,
    canRunNow: consoleState.nextAction.canRunNow,
    boundary: consoleState.boundary.kind,
    risk: consoleState.boundary.risk,
    pending: consoleState.dashboard.pending,
    gitDirty: consoleState.dashboard.git.dirty,
    changedFiles: consoleState.dashboard.git.changedFiles,
    artifactsStale: staleArtifacts.length,
    artifactsNeedAttention: staleArtifacts.length - historicalStaleArtifacts.length,
    historicalArtifactsStale: historicalStaleArtifacts.length,
    verificationProfile: consoleState.verificationProfile.id,
    primaryVerification: consoleState.verificationProfile.primaryCommand,
    reportPath: consoleState.reportPath || null,
    nextReportPath: consoleState.decision.reportPath || null,
    approvalCapsulePath: consoleState.decision.approvalCapsule?.path || null,
    latestApprovalCapsulePath: consoleState.decision.approvalCapsule ? '.planning/approval-capsules/latest.md' : null,
  };
}

function writeConsoleReport(projectRoot, consoleState) {
  const outDir = path.join(projectRoot, '.planning', 'operator-console');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'latest.md');
  fs.writeFileSync(outPath, renderConsole(consoleState), 'utf8');
  return normalizePath(path.relative(projectRoot, outPath));
}

function buildConsole(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const decision = resolveNext(root, {
    run: Boolean(options.run),
    maxSteps: options.maxSteps || 3,
  });

  if (decision.approvalCapsule) {
    writeApprovalCapsule(root, decision.approvalCapsule);
  }
  decision.reportPath = writeNextReport(root, decision);

  const snapshot = collectDashboard({ projectRoot: root });
  const verificationProfile = selectVerificationProfile(root);
  const finalAction = decision.final?.nextAction || decision.initial?.nextAction || {};
  const canRunNow = Boolean(localRepairFor(finalAction)) && !options.run;
  const consoleState = {
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    mode: options.run ? 'run' : 'inspect',
    status: statusForDecision(decision),
    nextAction: {
      label: finalAction.label || '(none)',
      command: finalAction.command || '(none)',
      why: finalAction.why || '(none)',
      confidence: finalAction.confidence || 'medium',
      runbook: finalAction.runbook || null,
      canRunNow,
    },
    boundary: boundaryForDecision(decision),
    dashboard: summarizeDashboard(snapshot),
    verificationProfile,
    decision,
  };
  consoleState.reportPath = writeConsoleReport(root, consoleState);
  consoleState.summary = compactConsoleSummary(consoleState);
  return consoleState;
}

function renderArtifact(label, artifact) {
  if (!artifact) return [`  ${label}: none`];
  const lines = [
    `  ${label}: ${artifact.path || '(unknown)'}`,
    `    freshness: ${artifact.freshness || 'unknown'}`,
  ];
  for (const reason of (artifact.staleReasons || []).slice(0, 2)) {
    lines.push(`    stale: ${reason}`);
  }
  return lines;
}

function renderConsole(consoleState) {
  const pending = consoleState.dashboard.pending;
  const git = consoleState.dashboard.git;
  const campaigns = consoleState.dashboard.campaigns;
  const fleet = consoleState.dashboard.fleet;
  const problems = consoleState.dashboard.problems;
  const profile = consoleState.verificationProfile;

  const lines = [
    'Citadel Operator Console',
    '='.repeat(40),
    `Generated: ${consoleState.generatedAt}`,
    `Mode: ${consoleState.mode}`,
    `Status: ${consoleState.status}`,
    `Project: ${consoleState.projectRoot}`,
    '',
    'Decision',
    `  Next: ${consoleState.nextAction.label}`,
    `  Command: ${consoleState.nextAction.command}`,
    `  Why: ${consoleState.nextAction.why}`,
    `  Confidence: ${consoleState.nextAction.confidence}`,
    `  Can run now: ${consoleState.nextAction.canRunNow ? 'yes' : 'no'}`,
    `  Runbook: ${consoleState.nextAction.runbook || '(none)'}`,
    '',
    'Boundary',
    `  Kind: ${consoleState.boundary.kind}`,
    `  Risk: ${consoleState.boundary.risk}`,
    `  Request: ${consoleState.boundary.request}`,
    '',
    'Context',
    `  Pending: docSync=${pending.docSync}, mergeReviews=${pending.mergeReviews}, intakeItems=${pending.intakeItems}`,
    `  Git: ${git.available ? (git.dirty ? `${git.changedFiles} changed file(s)` : 'clean') : 'unavailable'}`,
    `  Campaigns: active=${campaigns.active}, package=${campaigns.needsReviewPackage}, complete=${campaigns.needsCompletion}, archive=${campaigns.needsArchive}`,
    `  Fleet: active=${fleet.active}, visible=${fleet.totalVisible}`,
    `  Problems: actionable=${problems.actionable}, safetyBlocks=${problems.safetyBlocks}, stale=${problems.stale}`,
    '',
    'Artifacts',
    ...renderArtifact('Next report', consoleState.dashboard.artifacts.nextActionReport),
    ...renderArtifact('Approval capsule', consoleState.dashboard.artifacts.approvalCapsule),
    `  Stale artifacts: ${consoleState.dashboard.artifacts.staleCount}`,
    '',
    'Verification',
    `  Profile: ${profile.id} (${profile.label})`,
    `  Reason: ${profile.reason}`,
    `  Primary: ${profile.primaryCommand}`,
    '  Commands:',
    ...profile.commands.map((command) => `    - ${command}`),
  ];

  if (consoleState.boundary.verification.length > 0) {
    lines.push('  Boundary checks:');
    for (const item of consoleState.boundary.verification) lines.push(`    - ${item}`);
  }

  lines.push('');
  lines.push('Run Result');
  if (consoleState.mode !== 'run') {
    lines.push('  (not run)');
  } else if (consoleState.decision.steps.length === 0) {
    lines.push('  No deterministic repair was executed.');
  } else {
    for (const [index, step] of consoleState.decision.steps.entries()) {
      lines.push(`  ${index + 1}. ${step.action.label}`);
      lines.push(`     command: ${step.repair.command}`);
      lines.push(`     exit: ${step.result.status}`);
    }
  }

  lines.push('');
  lines.push('Paper Trail');
  lines.push(`  Console report: ${consoleState.reportPath || '(pending)'}`);
  lines.push(`  Next report: ${consoleState.decision.reportPath || '(pending)'}`);
  if (consoleState.decision.approvalCapsule) {
    lines.push(`  Approval capsule: ${consoleState.decision.approvalCapsule.path || '(pending)'}`);
  }

  lines.push('');
  lines.push('---HANDOFF---');
  lines.push(`- Status: ${consoleState.status}`);
  lines.push(`- Next: ${consoleState.nextAction.command}`);
  lines.push(`- Boundary: ${consoleState.boundary.kind} (${consoleState.boundary.risk})`);
  lines.push(`- Verify: ${profile.primaryCommand}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const consoleState = buildConsole(args.projectRoot, {
    run: args.run,
    maxSteps: args.maxSteps,
  });

  if (args.summary) process.stdout.write(`${JSON.stringify(consoleState.summary, null, 2)}\n`);
  else if (args.json) process.stdout.write(`${JSON.stringify(consoleState, null, 2)}\n`);
  else {
    process.stdout.write(renderConsole(consoleState));
    process.stdout.write(`Report: ${consoleState.reportPath}\n`);
  }

  if (consoleState.status === 'failed') {
    const failed = consoleState.decision.steps.find((step) => step.result.status !== 0);
    process.exitCode = failed?.result.status || 1;
  }
}

if (require.main === module) main();

module.exports = {
  boundaryForDecision,
  buildConsole,
  compactConsoleSummary,
  parseArgs,
  renderConsole,
  summarizeDashboard,
  usage,
  writeConsoleReport,
};

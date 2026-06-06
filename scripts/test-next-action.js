#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildApprovalCapsule,
  localRepairFor,
  resolveNext,
  writeApprovalCapsule,
  writeReport,
} = require('./next-action');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-next-action-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

assert.equal(localRepairFor({ command: '/learn --doc-sync' }).args[0].endsWith(path.join('hooks_src', 'doc-sync.js')), true);
assert.equal(localRepairFor({ command: '/merge-review' }), null);

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'), [
    JSON.stringify({ event: 'session-end', status: 'pending', timestamp: '2026-06-05T12:00:00.000Z' }),
  ].join('\n') + '\n');

  const inspected = resolveNext(projectRoot, { run: false });
  assert.equal(inspected.mode, 'inspect');
  assert.equal(inspected.outcome, 'repair-available');
  assert.equal(inspected.initial.nextAction.command, '/learn --doc-sync');
  assert.equal(inspected.steps.length, 0);

  const repaired = resolveNext(projectRoot, { run: true, maxSteps: 2 });
  assert.equal(repaired.mode, 'run');
  assert.equal(repaired.outcome, 'idle');
  assert.equal(repaired.steps.length, 1);
  assert.equal(repaired.steps[0].result.status, 0);
  assert.equal(repaired.final.pending.docSync, 0);
  assert.equal(repaired.final.nextAction.command, 'npm run dashboard');
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'doc-sync', 'latest.md')));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'active.md'), [
    '---',
    'status: active',
    '---',
    '',
    '# Campaign: Active',
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | in-progress | build | Build | done |',
  ].join('\n'));

  const report = resolveNext(projectRoot, { run: true, maxSteps: 2 });
  assert.equal(report.outcome, 'needs-human');
  assert.equal(report.steps.length, 0);
  assert.equal(report.final.nextAction.command, '/do continue');
  assert(report.approvalCapsule);
  assert.equal(report.approvalCapsule.boundary, 'agent-continuation');
  assert.equal(report.approvalCapsule.risk, 'medium');
  assert(report.approvalCapsule.request.includes('/do continue'));
  assert(report.approvalCapsule.verification.some((item) => item.includes('campaign')));

  const capsulePath = writeApprovalCapsule(projectRoot, report.approvalCapsule);
  assert(capsulePath.endsWith('-do-continue.md'));
  assert(fs.existsSync(path.join(projectRoot, capsulePath)));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md')));
  assert(fs.readFileSync(path.join(projectRoot, capsulePath), 'utf8').includes('Citadel Approval Capsule'));
});

withTempProject((projectRoot) => {
  const snapshot = {
    nextAction: {
      label: 'Process intake queue',
      command: '/autopilot',
      why: '1 real intake item is waiting.',
      confidence: 'medium',
      runbook: 'skills/autopilot/SKILL.md',
    },
    repairs: [{ command: '/autopilot' }],
    pending: { docSync: 0, mergeReviews: 0, intakeItems: 1 },
    gitStatus: { dirty: false },
    problemSummary: { actionable: 0 },
    campaigns: [],
  };

  const capsule = buildApprovalCapsule(projectRoot, snapshot, '2026-06-05T12:00:00.000Z');
  assert.equal(capsule.boundary, 'campaign-intake');
  assert.equal(capsule.risk, 'medium-high');
  assert(capsule.verification.some((item) => item.includes('generated campaign')));
});

withTempProject((projectRoot) => {
  fs.mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
  const inspected = resolveNext(projectRoot, { run: false });
  assert.equal(inspected.outcome, 'idle');
  const reportPath = writeReport(projectRoot, inspected);
  assert.equal(reportPath, '.planning/next-actions/latest.md');
  assert(fs.existsSync(path.join(projectRoot, reportPath)));

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'next-action.js'),
    '--project-root',
    projectRoot,
  ], { encoding: 'utf8' });

  assert(output.includes('Citadel Next Action'));
  assert(output.includes('Report: .planning/next-actions/latest.md'));
  assert(output.includes('---HANDOFF---'));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'next-actions', 'latest.md')));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'active.md'), [
    '---',
    'status: active',
    '---',
    '',
    '# Campaign: Active',
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | in-progress | build | Build | done |',
  ].join('\n'));

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'next-action.js'),
    '--project-root',
    projectRoot,
  ], { encoding: 'utf8' });

  assert(output.includes('Approval Capsule'));
  assert(output.includes('Path: .planning/approval-capsules/'));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md')));
  assert(fs.readFileSync(path.join(projectRoot, '.planning', 'next-actions', 'latest.md'), 'utf8').includes('Approval capsule: .planning/approval-capsules/'));
});

withTempProject((projectRoot) => {
  fs.mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'next-action.js'),
    '--project-root',
    projectRoot,
    '--json',
  ], { encoding: 'utf8' });

  const payload = JSON.parse(output);
  assert.equal(payload.reportPath, '.planning/next-actions/latest.md');
  assert(fs.existsSync(path.join(projectRoot, payload.reportPath)));
});

console.log('next action tests passed');

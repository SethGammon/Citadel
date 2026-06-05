#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildConsole, renderConsole } = require('./operator-console');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operator-console-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'), [
    JSON.stringify({ event: 'session-end', status: 'pending', timestamp: '2026-06-05T12:00:00.000Z' }),
  ].join('\n') + '\n');

  const consoleState = buildConsole(projectRoot, { run: false });
  const output = renderConsole(consoleState);

  assert.equal(consoleState.status, 'repair-ready');
  assert.equal(consoleState.nextAction.command, '/learn --doc-sync');
  assert.equal(consoleState.nextAction.canRunNow, true);
  assert.equal(consoleState.summary.status, 'repair-ready');
  assert.equal(consoleState.summary.command, '/learn --doc-sync');
  assert.equal(consoleState.summary.canRunNow, true);
  assert.equal(consoleState.summary.boundary, 'local-repair');
  assert.equal(consoleState.summary.risk, 'low');
  assert.equal(consoleState.summary.pending.docSync, 1);
  assert.equal(consoleState.summary.artifactsStale, 0);
  assert.equal(consoleState.summary.artifactsNeedAttention, 0);
  assert.equal(consoleState.summary.historicalArtifactsStale, 0);
  assert.equal(consoleState.summary.reportPath, '.planning/operator-console/latest.md');
  assert.equal(consoleState.summary.nextReportPath, '.planning/next-actions/latest.md');
  assert.equal(consoleState.boundary.kind, 'local-repair');
  assert.equal(consoleState.boundary.risk, 'low');
  assert.equal(consoleState.dashboard.pending.docSync, 1);
  assert.equal(consoleState.reportPath, '.planning/operator-console/latest.md');
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'operator-console', 'latest.md')));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'next-actions', 'latest.md')));
  assert(output.includes('Citadel Operator Console'));
  assert(output.includes('Status: repair-ready'));
  assert(output.includes('Can run now: yes'));
  assert(output.includes('Boundary'));
  assert(output.includes('Profile: baseline'));
  assert(output.includes('---HANDOFF---'));
  assert(!output.includes('undefined'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'), [
    JSON.stringify({ event: 'session-end', status: 'pending', timestamp: '2026-06-05T12:00:00.000Z' }),
  ].join('\n') + '\n');

  const consoleState = buildConsole(projectRoot, { run: true, maxSteps: 2 });
  const output = renderConsole(consoleState);

  assert.equal(consoleState.status, 'idle');
  assert.equal(consoleState.dashboard.pending.docSync, 0);
  assert.equal(consoleState.summary.status, 'idle');
  assert.equal(consoleState.summary.pending.docSync, 0);
  assert.equal(consoleState.summary.canRunNow, false);
  assert.equal(consoleState.summary.artifactsNeedAttention, 0);
  assert.equal(consoleState.decision.steps.length, 1);
  assert(output.includes('Mode: run'));
  assert(output.includes('1. Drain doc-sync queue'));
  assert(output.includes('exit: 0'));
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

  const consoleState = buildConsole(projectRoot, { run: false });
  const output = renderConsole(consoleState);

  assert.equal(consoleState.status, 'approval-needed');
  assert.equal(consoleState.nextAction.command, '/do continue');
  assert.equal(consoleState.nextAction.canRunNow, false);
  assert.equal(consoleState.boundary.kind, 'agent-continuation');
  assert.equal(consoleState.boundary.risk, 'medium');
  assert.equal(consoleState.summary.boundary, 'agent-continuation');
  assert.equal(consoleState.summary.risk, 'medium');
  assert(consoleState.summary.approvalCapsulePath.startsWith('.planning/approval-capsules/'));
  assert(consoleState.summary.approvalCapsulePath.endsWith('-do-continue.md'));
  assert.equal(consoleState.summary.latestApprovalCapsulePath, '.planning/approval-capsules/latest.md');
  assert(consoleState.boundary.request.includes('/do continue'));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md')));
  assert(output.includes('Status: approval-needed'));
  assert(output.includes('Kind: agent-continuation'));
  assert(output.includes('Risk: medium'));
  assert(output.includes('Boundary checks:'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md'), [
    'Citadel Approval Capsule',
    '========================================',
    'Generated: 2026-06-05T12:00:00.000Z',
    'Command: /do continue',
    'Boundary: agent-continuation',
    'Risk: medium',
    'Request: Approve running `/do continue` for this project.',
  ].join('\n'));

  const consoleState = buildConsole(projectRoot, { run: false });

  assert.equal(consoleState.status, 'idle');
  assert.equal(consoleState.summary.artifactsStale, 1);
  assert.equal(consoleState.summary.artifactsNeedAttention, 0);
  assert.equal(consoleState.summary.historicalArtifactsStale, 1);
});

withTempProject((projectRoot) => {
  fs.mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'operator-console.js'),
    '--project-root',
    projectRoot,
    '--json',
  ], { encoding: 'utf8' });

  const payload = JSON.parse(output);
  assert.equal(payload.status, 'idle');
  assert.equal(payload.reportPath, '.planning/operator-console/latest.md');
  assert.equal(payload.summary.status, 'idle');
  assert.equal(payload.summary.reportPath, '.planning/operator-console/latest.md');
  assert(fs.existsSync(path.join(projectRoot, payload.reportPath)));
});

withTempProject((projectRoot) => {
  fs.mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'operator-console.js'),
    '--project-root',
    projectRoot,
    '--summary',
  ], { encoding: 'utf8' });

  const payload = JSON.parse(output);
  assert.equal(payload.status, 'idle');
  assert.equal(payload.mode, 'inspect');
  assert.equal(payload.command, 'npm run dashboard');
  assert.equal(payload.canRunNow, false);
  assert.equal(payload.boundary, 'none');
  assert.equal(payload.risk, 'low');
  assert.equal(payload.reportPath, '.planning/operator-console/latest.md');
  assert.equal(payload.nextReportPath, '.planning/next-actions/latest.md');
  assert(!Object.prototype.hasOwnProperty.call(payload, 'decision'));
  assert(!Object.prototype.hasOwnProperty.call(payload, 'dashboard'));
  assert(fs.existsSync(path.join(projectRoot, payload.reportPath)));
});

console.log('operator console tests passed');

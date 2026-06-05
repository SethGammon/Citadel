#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectDashboard, renderDashboard } = require('./dashboard');
const { buildConsole, renderConsole } = require('./operator-console');

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-first-use-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function scaffoldPlanning(projectRoot) {
  fs.mkdirSync(path.join(projectRoot, '.planning', 'campaigns'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.planning', 'intake'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.planning', 'telemetry'), { recursive: true });
}

withTempProject((projectRoot) => {
  const dashboard = collectDashboard({ projectRoot, now: '2026-06-05T12:00:00.000Z' });
  const dashboardOutput = renderDashboard(dashboard);

  assert.equal(dashboard.nextAction.command, '/do setup --express');
  assert(!dashboardOutput.includes('undefined'));
  assert(!dashboardOutput.includes('ENOENT'));
});

withTempProject((projectRoot) => {
  const consoleState = buildConsole(projectRoot, { run: false });
  const consoleOutput = renderConsole(consoleState);

  assert.equal(consoleState.status, 'approval-needed');
  assert.equal(consoleState.summary.command, '/do setup --express');
  assert.equal(consoleState.summary.boundary, 'project-setup');
  assert.equal(consoleState.summary.risk, 'medium');
  assert.equal(consoleState.summary.canRunNow, false);
  assert.equal(consoleState.summary.approvalCapsulePath.startsWith('.planning/approval-capsules/'), true);
  assert.equal(consoleState.summary.latestApprovalCapsulePath, '.planning/approval-capsules/latest.md');
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md')));
  assert(consoleOutput.includes('Approve running `/do setup --express` for this project.'));
  assert(consoleOutput.includes('Runbook: skills/setup/SKILL.md'));
  assert(!consoleOutput.includes('undefined'));
  assert(!consoleOutput.includes('ENOENT'));
});

withTempProject((projectRoot) => {
  scaffoldPlanning(projectRoot);

  const consoleState = buildConsole(projectRoot, { run: false });
  const output = renderConsole(consoleState);

  assert.equal(consoleState.status, 'idle');
  assert.equal(consoleState.summary.command, 'npm run dashboard');
  assert.equal(consoleState.summary.boundary, 'none');
  assert.equal(consoleState.summary.risk, 'low');
  assert.equal(consoleState.summary.pending.docSync, 0);
  assert.equal(consoleState.summary.pending.mergeReviews, 0);
  assert.equal(consoleState.summary.pending.intakeItems, 0);
  assert.equal(consoleState.summary.artifactsNeedAttention, 0);
  assert.equal(consoleState.summary.approvalCapsulePath, null);
  assert(output.includes('No urgent Citadel action detected'));
  assert(!output.includes('undefined'));
  assert(!output.includes('ENOENT'));
});

console.log('first-use operator tests passed');

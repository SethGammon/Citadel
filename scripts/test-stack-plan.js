#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assessStack,
  blockerReasons,
  buildPostApprovalRunbook,
  parseReadinessReport,
} = require('./stack-plan');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-stack-plan-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readinessReport({ branch, head, pr, status = 'ready', verification = 'pass', generated = '2026-06-05T12:00:00.000Z' }) {
  return [
    `# PR Readiness: ${branch}`,
    '',
    `Generated: ${generated}`,
    `Status: ${status}`,
    `PR: ${pr}`,
    `Branch: ${branch}`,
    `Head: ${head}`,
    '',
    '## Gates',
    '',
    '| Gate | Status | Detail |',
    '|---|---|---|',
    `| Pull request URL | ${pr ? 'pass' : 'fail'} | ${pr || 'missing'} |`,
    '| Git worktree | pass | clean |',
    '| Dashboard repairs | pass | no queued repairs |',
    `| Verification | ${verification} | npm run test exited ${verification === 'pass' ? 0 : 1} |`,
    '',
    '---HANDOFF---',
    `- PR: ${pr}`,
    `- Branch: ${branch}`,
    `- Readiness: ${status}`,
    `- Verification: ${verification}`,
    '---',
  ].join('\n');
}

withTempProject((projectRoot) => {
  const reportPath = path.join(projectRoot, '.planning', 'pr-readiness', 'top.md');
  write(reportPath, readinessReport({
    branch: 'codex/top',
    head: 'c333333',
    pr: 'https://github.com/SethGammon/Citadel/pull/3',
  }));

  const report = parseReadinessReport(projectRoot, reportPath);
  assert.equal(report.branch, 'codex/top');
  assert.equal(report.head, 'c333333');
  assert.equal(report.ready, true);
  assert.equal(report.gates.verification.pass, true);
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'pr-readiness', 'top.md'), readinessReport({
    branch: 'codex/top',
    head: 'c333333',
    pr: 'https://github.com/SethGammon/Citadel/pull/3',
    generated: '2026-06-05T12:03:00.000Z',
  }));
  write(path.join(projectRoot, '.planning', 'pr-readiness', 'base.md'), readinessReport({
    branch: 'codex/base',
    head: 'a111111',
    pr: 'https://github.com/SethGammon/Citadel/pull/1',
    generated: '2026-06-05T12:01:00.000Z',
  }));
  write(path.join(projectRoot, '.planning', 'pr-readiness', 'middle.md'), readinessReport({
    branch: 'codex/middle',
    head: 'b222222',
    pr: 'https://github.com/SethGammon/Citadel/pull/2',
    generated: '2026-06-05T12:02:00.000Z',
  }));

  const ancestry = new Set([
    'a111111:b222222',
    'a111111:c333333',
    'b222222:c333333',
  ]);
  const stack = assessStack(projectRoot, {
    isAncestor: (ancestor, descendant) => ancestry.has(`${ancestor}:${descendant}`),
  });

  assert.equal(stack.status, 'approval-needed');
  assert.equal(stack.ready, true);
  assert.deepEqual(stack.reports.map((report) => report.branch), ['codex/base', 'codex/middle', 'codex/top']);
  assert.equal(stack.nextAction.label, 'Approve stack landing order');
  assert.equal(stack.nextAction.canRunNow, false);
  assert.equal(stack.postApprovalRunbook.length, 5);
  assert.equal(stack.postApprovalRunbook[0].step, 'Reconfirm stack state');
  assert.equal(stack.postApprovalRunbook[1].step, 'Land 1: https://github.com/SethGammon/Citadel/pull/1');
  assert.equal(stack.postApprovalRunbook[3].step, 'Land 3: https://github.com/SethGammon/Citadel/pull/3');
  assert.equal(stack.postApprovalRunbook[4].step, 'Verify landed main');
  assert(stack.approvalCapsule);
  assert.equal(stack.approvalCapsule.boundary, 'stack-approval');
  assert.equal(stack.approvalCapsule.risk, 'medium-high');
  assert.equal(stack.approvalCapsule.postApprovalRunbook.length, stack.postApprovalRunbook.length);
  assert(stack.approvalCapsule.path.startsWith('.planning/approval-capsules/'));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md')));
  assert(fs.readFileSync(path.join(projectRoot, '.planning', 'stack-readiness', 'latest.md'), 'utf8').includes('Approval capsule: .planning/approval-capsules/'));
  assert(fs.readFileSync(path.join(projectRoot, '.planning', 'stack-readiness', 'latest.md'), 'utf8').includes('Post-Approval Landing Runbook'));
  assert(fs.readFileSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md'), 'utf8').includes('Stack:'));
  assert(fs.readFileSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md'), 'utf8').includes('Post-Approval Landing Runbook'));
  assert(fs.readFileSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md'), 'utf8').includes('Verify landed main'));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'stack-readiness', 'latest.md')));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'pr-readiness', 'blocked.md'), readinessReport({
    branch: 'codex/blocked',
    head: 'd444444',
    pr: 'https://github.com/SethGammon/Citadel/pull/4',
    status: 'blocked',
    verification: 'fail',
  }));

  const stack = assessStack(projectRoot);
  assert.equal(stack.status, 'blocked');
  assert.equal(stack.ready, false);
  assert.equal(stack.blocked.length, 1);
  assert(blockerReasons(stack.reports[0]).some((reason) => reason.includes('readiness status is blocked')));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'pr-readiness', 'stale.md'), readinessReport({
    branch: 'codex/stale',
    head: 'f666666',
    pr: 'https://github.com/SethGammon/Citadel/pull/6',
  }));

  const stack = assessStack(projectRoot, {
    resolveBranchHead: (branch) => branch === 'codex/stale' ? 'f777777' : null,
  });

  assert.equal(stack.status, 'blocked');
  assert.equal(stack.ready, false);
  assert.equal(stack.reports[0].currentHead, 'f777777');
  assert(stack.blocked[0].reasons.some((reason) => reason.includes('does not match current branch head f777777')));
});

assert.deepEqual(buildPostApprovalRunbook('no-stack', []), [
  {
    step: 'Generate PR readiness reports',
    gate: 'At least one report exists in .planning/pr-readiness.',
    action: 'Run node scripts/pr-ready.js --pr <pull-request-url> --run-verification for each PR.',
  },
]);

assert.equal(buildPostApprovalRunbook('blocked', []).length, 1);

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'pr-readiness', 'ready.md'), readinessReport({
    branch: 'codex/ready',
    head: 'e555555',
    pr: 'https://github.com/SethGammon/Citadel/pull/5',
  }));

  const stack = assessStack(projectRoot, { writeReport: false });
  assert.equal(stack.status, 'approval-needed');
  assert.equal(stack.reportPath, null);
  assert.equal(stack.approvalCapsule.path, undefined);
  assert(!fs.existsSync(path.join(projectRoot, '.planning', 'stack-readiness', 'latest.md')));
  assert(!fs.existsSync(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md')));
});

withTempProject((projectRoot) => {
  fs.mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'stack-plan.js'),
    '--project-root',
    projectRoot,
    '--json',
  ], { encoding: 'utf8' });

  const payload = JSON.parse(output);
  assert.equal(payload.status, 'no-stack');
  assert.equal(payload.nextAction.command, 'node scripts/pr-ready.js --pr <pull-request-url> --run-verification');
  assert(fs.existsSync(path.join(projectRoot, payload.reportPath)));
});

console.log('stack plan tests passed');

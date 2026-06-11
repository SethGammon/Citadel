#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { classifyHookProblem, collectDashboard, percentile, readOperatorArtifacts, renderDashboard, relativeTime } = require('./dashboard');

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-dashboard-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function appendJsonl(filePath, entries) {
  write(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

assert.equal(relativeTime('2026-06-04T12:00:00.000Z', new Date('2026-06-04T12:00:30.000Z')), 'just now');
assert.equal(relativeTime('2026-06-04T11:30:00.000Z', new Date('2026-06-04T12:00:00.000Z')), '30 min ago');
assert.equal(relativeTime('2026-06-03T12:00:00.000Z', new Date('2026-06-04T12:00:00.000Z')), '1 day ago');

// Percentile math: nearest-rank method on a sorted ascending array
assert.equal(percentile([], 50), null);
assert.equal(percentile([7], 50), 7);
assert.equal(percentile([7], 95), 7);
assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
{
  const oneToHundred = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(oneToHundred, 50), 50);
  assert.equal(percentile(oneToHundred, 95), 95);
  assert.equal(percentile(oneToHundred, 100), 100);
}

{
  const classified = classifyHookProblem({
    timestamp: '2026-06-04T11:59:00.000Z',
    hook: 'protect-files',
    action: 'blocked',
    detail: 'Read .env (.env secrets)',
  }, new Date('2026-06-04T12:00:00.000Z'));
  assert.equal(classified.category, 'safety-block');
  assert.equal(classified.actionable, false);
  assert.equal(classified.severity, 'info');
}

{
  const classified = classifyHookProblem({
    timestamp: '2026-06-04T11:59:00.000Z',
    hook: 'protect-files',
    action: 'parse-fail',
    detail: 'Could not parse stdin JSON',
  }, new Date('2026-06-04T12:00:00.000Z'));
  assert.equal(classified.category, 'hook-failure');
  assert.equal(classified.actionable, true);
  assert.equal(classified.severity, 'high');
}

{
  const classified = classifyHookProblem({
    timestamp: '2026-06-04T11:59:05.000Z',
    hook: 'external-action-gate',
    action: 'consent-block',
    detail: 'git push: git push -u origin codex/branch',
  }, new Date('2026-06-04T12:00:00.000Z'), {
    auditEntries: [
      { timestamp: '2026-06-04T11:59:00.000Z', event: 'tool-call', target: 'git push origin codex/branch' },
    ],
  });
  assert.equal(classified.category, 'resolved-approval');
  assert.equal(classified.actionable, false);
  assert.equal(classified.severity, 'info');
}

{
  const classified = classifyHookProblem({
    timestamp: '2026-06-04T11:30:00.000Z',
    hook: 'external-action-gate',
    action: 'consent-block',
    detail: 'git push: git push origin codex/branch',
  }, new Date('2026-06-04T12:00:00.000Z'));
  assert.equal(classified.category, 'stale-approval');
  assert.equal(classified.actionable, false);
  assert.equal(classified.severity, 'low');
}

withTempProject((projectRoot) => {
  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert(output.includes('Citadel Dashboard'));
  assert(output.includes('NEXT ACTION'));
  assert.equal(snapshot.nextAction.command, '/do setup --express');
  assert.equal(snapshot.nextAction.repairAvailable, true);
  assert(output.includes('Command: /do setup --express'));
  assert(output.includes('OPERATOR ARTIFACTS'));
  assert(output.includes('(none recorded yet - run npm run next)'));
  assert(output.includes('REPAIR CONSOLE'));
  assert(output.includes('CAMPAIGNS'));
  assert(output.includes('FLEET SESSIONS'));
  assert(output.includes('HEALTH'));
  assert(!output.includes('undefined'));
  assert(!output.includes('ENOENT'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'next-actions', 'latest.md'), [
    'Citadel Next Action',
    '========================================',
    'Generated: 2026-06-04T11:59:00.000Z',
    'Mode: run',
    'Outcome: needs-human',
    '',
    '---HANDOFF---',
    '- Final command: /do continue',
    '---',
  ].join('\n'));
  write(path.join(projectRoot, '.planning', 'approval-capsules', 'latest.md'), [
    'Citadel Approval Capsule',
    '========================================',
    'Generated: 2026-06-04T11:59:00.000Z',
    'Boundary: agent-continuation',
    'Risk: medium',
    '',
    'Request',
    'Approve running `/do continue` for this project.',
    '',
    'Action',
    '  Command: /do continue',
  ].join('\n'));

  const artifacts = readOperatorArtifacts(projectRoot);
  assert.equal(artifacts.nextActionReport.path, '.planning/next-actions/latest.md');
  assert.equal(artifacts.nextActionReport.outcome, 'needs-human');
  assert.equal(artifacts.nextActionReport.mode, 'run');
  assert.equal(artifacts.approvalCapsule.path, '.planning/approval-capsules/latest.md');
  assert.equal(artifacts.approvalCapsule.boundary, 'agent-continuation');
  assert.equal(artifacts.approvalCapsule.risk, 'medium');
  assert.equal(artifacts.approvalCapsule.request, 'Approve running `/do continue` for this project.');

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);
  assert.equal(snapshot.operatorArtifacts.nextActionReport.freshness, 'stale');
  assert.equal(snapshot.operatorArtifacts.approvalCapsule.freshness, 'stale');
  assert(output.includes('OPERATOR ARTIFACTS'));
  assert(output.includes('Next report: .planning/next-actions/latest.md'));
  assert(output.includes('outcome: needs-human | mode: run | freshness: stale'));
  assert(output.includes('Approval capsule: .planning/approval-capsules/latest.md'));
  assert(output.includes('boundary: agent-continuation | risk: medium | freshness: stale'));
  assert(output.includes('request: Approve running `/do continue` for this project.'));
  assert(output.includes('stale: latest report final command is /do continue, current command is npm run dashboard'));
  assert(output.includes('stale: no current repair or approval boundary is queued'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'intake', '_TEMPLATE.md'), 'status: pending\n');
  write(path.join(projectRoot, '.planning', 'intake', 'active.md'), [
    '---',
    'status: in-progress',
    '---',
    '',
    'Already claimed.',
  ].join('\n'));
  write(path.join(projectRoot, '.planning', 'intake', 'done.md'), [
    '---',
    'status: completed',
    '---',
    '',
    'Already completed.',
  ].join('\n'));
  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  assert.equal(snapshot.pending.intakeItems, 0);
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'completed', 'shipped.md'), [
    '---',
    'status: completed',
    '---',
    '',
    '# Campaign: Shipped',
    '',
    'Status: completed',
    '',
    '## Completion Record',
    '',
    '- Completed At: 2026-06-04T11:59:00.000Z',
    '- Outcome: shipped-pr',
    '- PR: https://github.com/acme/repo/pull/7',
    '- Merge SHA: abc123',
    '- Verification: npm run test',
  ].join('\n'));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);
  assert.equal(snapshot.outcomeLedger.length, 1);
  assert.equal(snapshot.outcomeLedger[0].slug, 'shipped');
  assert.equal(snapshot.outcomeLedger[0].outcome, 'shipped-pr');
  assert.equal(snapshot.outcomeLedger[0].pr, 'https://github.com/acme/repo/pull/7');
  assert(output.includes('OUTCOMES'));
  assert(output.includes('shipped: shipped-pr - https://github.com/acme/repo/pull/7'));
  assert(output.includes('verification: npm run test'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'completed', 'legacy-pr.md'), [
    '---',
    'status: completed',
    '---',
    '',
    '# Campaign: Legacy PR',
    '',
    'Status: completed',
    '',
    '## Completion Record',
    '',
    '- Completed At: 2026-06-04T11:59:00.000Z',
    '- PR: https://github.com/acme/repo/pull/8',
  ].join('\n'));

  write(path.join(projectRoot, '.planning', 'campaigns', 'completed', 'legacy-archive.md'), [
    '---',
    'status: completed',
    '---',
    '',
    '# Campaign: Legacy Archive',
    '',
    'Status: completed',
  ].join('\n'));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  assert.equal(snapshot.outcomeLedger.find((entry) => entry.slug === 'legacy-pr').outcome, 'review-package');
  assert.equal(snapshot.outcomeLedger.find((entry) => entry.slug === 'legacy-archive').outcome, 'archived-completion');
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'intake', 'pending.md'), [
    '---',
    'status: pending',
    '---',
    '',
    'Ready to process.',
  ].join('\n'));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  assert.equal(snapshot.pending.intakeItems, 1);
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'done-but-active.md'), [
    '---',
    'status: active',
    '---',
    '',
    '# Campaign: Done But Active',
    '',
    'Direction: Prove completion repair appears.',
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | complete | build | Build | done |',
    '| 2 | completed | verify | Verify | tests pass |',
  ].join('\n'));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.campaigns[0].status, 'needs-completion');
  assert.equal(snapshot.nextAction.label, 'Complete done-but-active');
  assert.equal(snapshot.nextAction.command, 'node scripts/campaign.js complete done-but-active --archive');
  assert.equal(snapshot.nextAction.confidence, 'high');
  assert(output.includes('repair | high | Complete done-but-active'));
  assert(output.includes('done-but-active: Phase 2/2 - needs-completion'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'done-in-active-dir.md'), [
    '---',
    'status: completed',
    '---',
    '',
    '# Campaign: Done In Active Dir',
    '',
    'Direction: Prove archive repair appears.',
    '',
    'Status: completed',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | complete | build | Build | done |',
  ].join('\n'));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.campaigns[0].status, 'needs-archive');
  assert.equal(snapshot.nextAction.label, 'Archive completed campaign done-in-active-dir');
  assert.equal(snapshot.nextAction.command, 'node scripts/campaign.js complete done-in-active-dir --archive');
  assert(output.includes('repair | high | Archive completed campaign done-in-active-dir'));
  assert(output.includes('done-in-active-dir: Phase 1/1 - needs-archive'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'ready-for-package.md'), [
    '---',
    'status: active',
    '---',
    '',
    '# Campaign: Ready For Package',
    '',
    'Direction: Prove review package repair appears.',
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | complete | brief | Intake preflight | done |',
    '| 2 | complete | build | Build | done |',
    '| 3 | complete | verify | Verify | tests pass |',
    '| 4 | pending | package | Package for review | review package exists |',
    '',
    '## Exit Evidence',
    '',
    '| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |',
    '|---|---|---|---|---|---|---|---|',
    '| phase:2 | implementation-diff | file_diff | yes | git diff --stat | resolved | 2 | implement requested change |',
    '| phase:3 | verification-command | test_result | yes | npm run test | pass | 2 | fix verification failures |',
    '| phase:4 | review-package | review_package | yes | .planning/review-packages/ready-for-package.md | pending | 2 | package delivery for review |',
  ].join('\n'));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.campaigns[0].status, 'needs-review-package');
  assert.equal(snapshot.nextAction.label, 'Package ready-for-package for review');
  assert.equal(snapshot.nextAction.command, 'node scripts/package-delivery.js ready-for-package');
  assert.equal(snapshot.nextAction.confidence, 'high');
  assert(output.includes('repair | high | Package ready-for-package for review'));
  assert(output.includes('campaign review-package evidence is not ready'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'not-ready-for-package.md'), [
    '---',
    'status: active',
    '---',
    '',
    '# Campaign: Not Ready For Package',
    '',
    'Direction: Prove package repair waits for prior phases.',
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | complete | brief | Intake preflight | done |',
    '| 2 | pending | build | Build | done |',
    '| 3 | pending | verify | Verify | tests pass |',
    '| 4 | pending | package | Package for review | review package exists |',
    '',
    '## Exit Evidence',
    '',
    '| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |',
    '|---|---|---|---|---|---|---|---|',
    '| phase:4 | review-package | review_package | yes | .planning/review-packages/not-ready-for-package.md | pending | 2 | package delivery for review |',
  ].join('\n'));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });

  assert.equal(snapshot.nextAction.label, 'Resume not-ready-for-package');
  assert.equal(snapshot.nextAction.command, '/do continue');
  assert(!snapshot.repairs.some((repair) => repair.command === 'node scripts/package-delivery.js not-ready-for-package'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'complete-but-unpackaged.md'), [
    '---',
    'status: active',
    '---',
    '',
    '# Campaign: Complete But Unpackaged',
    '',
    'Direction: Prove packaging outranks completion.',
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | complete | build | Build | done |',
    '| 2 | complete | verify | Verify | tests pass |',
    '| 3 | complete | package | Package for review | review package exists |',
    '',
    '## Exit Evidence',
    '',
    '| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |',
    '|---|---|---|---|---|---|---|---|',
    '| phase:3 | review-package | review_package | yes | .planning/review-packages/complete-but-unpackaged.md | pending | 2 | package delivery for review |',
  ].join('\n'));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });

  assert.equal(snapshot.campaigns[0].status, 'needs-review-package');
  assert.equal(snapshot.nextAction.label, 'Package complete-but-unpackaged for review');
  assert(!snapshot.repairs.some((repair) => repair.label === 'Complete complete-but-unpackaged'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'), [
    JSON.stringify({ event: 'session-end', status: 'pending' }),
    JSON.stringify({ event: 'session-end', status: 'pending' }),
    JSON.stringify({ event: 'session-end', status: 'surfaced' }),
  ].join('\n') + '\n');

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.pending.docSync, 2);
  assert.equal(snapshot.nextAction.label, 'Drain doc-sync queue');
  assert.equal(snapshot.nextAction.command, '/learn --doc-sync');
  assert.equal(snapshot.repairs[0].runbook, 'skills/learn/SKILL.md');
  assert(output.includes('repair | medium | Drain doc-sync queue'));
  assert(output.includes('why: 2 doc-sync item(s) are queued'));
});

withTempProject((projectRoot) => {
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'hook-errors.jsonl'), [
    { timestamp: '2026-06-04T11:59:00.000Z', hook: 'protect-files', action: 'blocked', detail: 'Read .env (.env secrets)' },
    { timestamp: '2026-06-04T11:58:00.000Z', hook: 'external-action-gate', action: 'blocked', detail: 'gh release create: gh release create v1.0.0' },
    { timestamp: '2026-06-02T11:58:00.000Z', hook: 'quality-gate', action: 'blocked', detail: 'old quality gate block' },
  ]);

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.problemSummary.actionable, 0);
  assert.equal(snapshot.problemSummary.safetyBlocks, 2);
  assert.equal(snapshot.problemSummary.stale, 1);
  assert.equal(snapshot.nextAction.label, 'No urgent Citadel action detected');
  assert(output.includes('Actionable: 0 | Safety blocks: 2 | Resolved approvals: 0 | Stale: 1'));
  assert(output.includes('info | safety-block | protect-files'));
  assert(output.includes('low | stale | quality-gate'));
});

withTempProject((projectRoot) => {
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'hook-errors.jsonl'), [
    { timestamp: '2026-06-04T11:59:00.000Z', hook: 'external-action-gate', action: 'consent-block', detail: 'git push: git push origin codex/branch' },
  ]);
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'audit.jsonl'), [
    { timestamp: '2026-06-04T11:59:30.000Z', event: 'tool-call', target: 'git push origin codex/branch' },
  ]);

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.problemSummary.actionable, 0);
  assert.equal(snapshot.problemSummary.resolvedApprovals, 1);
  assert.equal(snapshot.nextAction.label, 'No urgent Citadel action detected');
  assert(output.includes('info | resolved-approval | external-action-gate'));
});

withTempProject((projectRoot) => {
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'hook-errors.jsonl'), [
    { timestamp: '2026-06-04T11:59:00.000Z', hook: 'external-action-gate', action: 'first-encounter', detail: 'git push: git push origin branch' },
  ]);

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.problemSummary.actionable, 1);
  assert.equal(snapshot.problemSummary.approvalNeeded, 1);
  assert.equal(snapshot.nextAction.label, 'Review recent hook problems');
  assert.equal(snapshot.nextAction.command, '/telemetry');
  assert(output.includes('medium | approval-needed | external-action-gate'));
  assert(output.includes('1 actionable hook problem(s) are recorded'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'campaigns', 'test-campaign.md'), [
    '---',
    'slug: test-campaign',
    'status: active',
    'phase_count: 3',
    'current_phase: 2',
    '---',
    '',
    '# Campaign: Test Campaign',
    '',
    'Direction: Build a dashboard that is easy to understand without raw logs.',
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | complete | build | Collect state | state is collected |',
    '| 2 | in-progress | build | Render dashboard | dashboard is readable |',
    '| 3 | pending | verify | Verify | tests pass |',
    '',
    '## Decision Log',
    '',
    '- Keep dashboard read-only.',
  ].join('\n'));

  write(path.join(projectRoot, '.planning', 'fleet', 'session-alpha.md'), [
    'status: active',
    'current_wave: 1',
    'agents_total: 2',
  ].join('\n'));
  write(path.join(projectRoot, '.planning', 'verification', 'worktree-readiness', 'alpha.json'), JSON.stringify({
    schema: 1,
    timestamp: '2026-06-04T11:56:00.000Z',
    worktreePath: path.join(projectRoot, 'alpha-worktree'),
    worktreeName: 'alpha-worktree',
    branch: 'codex/alpha',
    status: 'blocked',
    blockFleet: true,
    checks: [
      { name: 'dependencies:node', status: 'fail', detail: 'node_modules is missing after worktree setup.' },
      { name: 'health:1', status: 'warn', detail: 'health check skipped' },
    ],
  }));

  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'hook-timing.jsonl'), [
    { timestamp: '2026-06-04T11:59:00.000Z', hook: 'quality-gate', duration_ms: 45 },
    { timestamp: '2026-06-04T11:58:00.000Z', hook: 'circuit-breaker', metric: 'trips' },
  ]);
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'hook-errors.jsonl'), [
    { timestamp: '2026-06-04T11:59:00.200Z', hook: 'quality-gate', reason: 'missing verification evidence' },
  ]);
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'audit.jsonl'), [
    { timestamp: '2026-06-04T11:57:00.000Z', event: 'agent-complete', agent: 'marshal', status: 'success' },
  ]);

  write(path.join(projectRoot, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node hook.js' }] }],
    },
  }));
  write(path.join(projectRoot, '.claude', 'harness.json'), JSON.stringify({
    trust: { sessions_completed: 7, campaigns_completed: 1 },
  }));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.campaigns.length, 1);
  assert.equal(snapshot.campaigns[0].phase.label, 'Phase 2/3');
  assert.equal(snapshot.nextAction.label, 'Resume test-campaign');
  assert.equal(snapshot.nextAction.command, '/do continue');
  assert.equal(snapshot.fleetSessions.length, 1);
  assert.equal(snapshot.worktreeReadiness.length, 1);
  assert(output.includes('test-campaign: Phase 2/3 - active'));
  assert(output.includes('Last decision: Keep dashboard read-only.'));
  assert(output.includes('alpha: Wave 1 - 2 agents - active'));
  assert(output.includes('WORKTREE READINESS'));
  assert(output.includes('blocked - alpha-worktree - codex/alpha - blocks Fleet'));
  assert(output.includes('checks: 1 fail, 1 warn'));
  assert(output.includes('PROBLEMS'));
  assert(output.includes('missing verification evidence'));
  assert(output.includes('HOOK ACTIVITY'));
  assert(output.includes('quality-gate'));
  assert(output.includes('REPAIR CONSOLE'));
  assert(output.includes('repair | high | Resume test-campaign'));
  assert(output.includes('Trust level:                        familiar'));
  assert(!output.includes('{"hook"'));
  assert(!output.includes('undefined'));
});

// Hook Overhead: percentiles per hook from a synthetic hook-timing fixture
withTempProject((projectRoot) => {
  const timings = [];
  for (let durationMs = 1; durationMs <= 20; durationMs++) {
    timings.push({ timestamp: '2026-06-04T11:00:00.000Z', hook: 'post-edit', event: 'timing', duration_ms: durationMs });
  }
  timings.push({ timestamp: '2026-06-04T11:01:00.000Z', hook: 'session-end', event: 'timing', duration_ms: 300 });
  timings.push({ timestamp: '2026-06-04T11:02:00.000Z', hook: 'session-end', event: 'timing', duration_ms: 100 });
  // Counter entries have no duration and must be excluded from overhead stats
  timings.push({ timestamp: '2026-06-04T11:03:00.000Z', hook: 'circuit-breaker', event: 'counter', metric: 'count' });
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'hook-timing.jsonl'), timings);

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.hookOverhead.length, 2);
  assert.equal(snapshot.hookOverhead[0].hook, 'session-end'); // sorted by p95 descending
  assert.equal(snapshot.hookOverhead[0].count, 2);
  assert.equal(snapshot.hookOverhead[0].p50Ms, 100);
  assert.equal(snapshot.hookOverhead[0].p95Ms, 300);
  assert.equal(snapshot.hookOverhead[0].maxMs, 300);
  assert.equal(snapshot.hookOverhead[1].hook, 'post-edit');
  assert.equal(snapshot.hookOverhead[1].count, 20);
  assert.equal(snapshot.hookOverhead[1].p50Ms, 10);
  assert.equal(snapshot.hookOverhead[1].p95Ms, 19);
  assert.equal(snapshot.hookOverhead[1].maxMs, 20);
  const overheadIndex = output.indexOf('HOOK OVERHEAD');
  assert(overheadIndex >= 0);
  assert(output.indexOf('session-end', overheadIndex) < output.indexOf('post-edit', overheadIndex));
  assert(!output.includes('(no hook timing data recorded yet)'));
});

// Hook Overhead: missing telemetry renders the one-line note and never crashes
withTempProject((projectRoot) => {
  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.deepEqual(snapshot.hookOverhead, []);
  assert(output.includes('HOOK OVERHEAD'));
  assert(output.includes('(no hook timing data recorded yet)'));
});

// Hook Overhead: empty hook-timing.jsonl renders the note too
withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'telemetry', 'hook-timing.jsonl'), '');

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.deepEqual(snapshot.hookOverhead, []);
  assert(output.includes('(no hook timing data recorded yet)'));
});

// Routine quota: 3 runs inside the 24h window shows 3/15 with no warning;
// entries older than 24h are excluded from the count
withTempProject((projectRoot) => {
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'routine-runs.jsonl'), [
    { ts: '2026-06-02T12:00:00.000Z', kind: 'RemoteTrigger' }, // outside 24h window
    { ts: '2026-06-04T01:00:00.000Z', kind: 'RemoteTrigger' },
    { ts: '2026-06-04T08:00:00.000Z', kind: 'CronCreate' },
    { ts: '2026-06-04T11:30:00.000Z', kind: 'ScheduleWakeup' },
  ]);

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.routineQuota.runsLast24h, 3);
  assert.equal(snapshot.routineQuota.cap, 15);
  assert.equal(snapshot.routineQuota.warning, false);
  assert(output.includes('ROUTINE QUOTA'));
  assert(output.includes('Runs (last 24h): 3/15'));
  assert(!output.includes('WARNING: 3 of 15'));
  assert(!output.includes('remote-run logging populates'));
});

// Routine quota: 13 runs in the window crosses the warn-above-12 threshold
withTempProject((projectRoot) => {
  const runs = Array.from({ length: 13 }, (_, index) => ({
    ts: `2026-06-04T${String(index).padStart(2, '0')}:30:00.000Z`,
    kind: index % 2 === 0 ? 'RemoteTrigger' : 'CronCreate',
  }));
  appendJsonl(path.join(projectRoot, '.planning', 'telemetry', 'routine-runs.jsonl'), runs);

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T23:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.routineQuota.runsLast24h, 13);
  assert.equal(snapshot.routineQuota.warning, true);
  assert(output.includes('Runs (last 24h): 13/15'));
  assert(output.includes('WARNING: 13 of 15 routine runs used in the last 24h'));
  assert(output.includes('docs/ROUTINE-QUOTA.md'));
});

// Routine quota: no routine-runs.jsonl renders 0/15 plus the population hint
withTempProject((projectRoot) => {
  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert.equal(snapshot.routineQuota.sourceExists, false);
  assert.equal(snapshot.routineQuota.runsLast24h, 0);
  assert.equal(snapshot.routineQuota.warning, false);
  assert(output.includes('ROUTINE QUOTA'));
  assert(output.includes('Runs (last 24h): 0/15'));
  assert(output.includes('(remote-run logging populates .planning/telemetry/routine-runs.jsonl - local runners do not consume quota)'));
});

console.log('dashboard tests passed');

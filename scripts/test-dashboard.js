#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { classifyHookProblem, collectDashboard, renderDashboard, relativeTime } = require('./dashboard');

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
  assert.equal(snapshot.nextAction.command, '/do setup');
  assert.equal(snapshot.nextAction.repairAvailable, true);
  assert(output.includes('Command: /do setup'));
  assert(output.includes('REPAIR CONSOLE'));
  assert(output.includes('CAMPAIGNS'));
  assert(output.includes('FLEET SESSIONS'));
  assert(output.includes('HEALTH'));
  assert(!output.includes('undefined'));
  assert(!output.includes('ENOENT'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'intake', '_TEMPLATE.md'), 'status: pending\n');
  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  assert.equal(snapshot.pending.intakeItems, 0);
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

console.log('dashboard tests passed');

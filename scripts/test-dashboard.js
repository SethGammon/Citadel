#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectDashboard, renderDashboard, relativeTime } = require('./dashboard');

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

withTempProject((projectRoot) => {
  const snapshot = collectDashboard({ projectRoot, now: '2026-06-04T12:00:00.000Z' });
  const output = renderDashboard(snapshot);

  assert(output.includes('Citadel Dashboard'));
  assert(output.includes('NEXT ACTION'));
  assert(output.includes('/do setup'));
  assert(output.includes('CAMPAIGNS'));
  assert(output.includes('FLEET SESSIONS'));
  assert(output.includes('HEALTH'));
  assert(!output.includes('undefined'));
  assert(!output.includes('ENOENT'));
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
  assert(output.includes('Trust level:                        familiar'));
  assert(!output.includes('{"hook"'));
  assert(!output.includes('undefined'));
});

console.log('dashboard tests passed');

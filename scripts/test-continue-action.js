#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectDashboard } = require('./dashboard');
const { routeAction } = require('./continue-action');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-continue-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function reviewPackageCampaign(title, slug) {
  return [
    '---',
    'status: active',
    '---',
    '',
    `# Campaign: ${title}`,
    '',
    `Direction: Package ${title} for review.`,
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
    `| phase:4 | review-package | review_package | yes | .planning/review-packages/${slug}.md | pending | 2 | package delivery for review |`,
  ].join('\n');
}

withTempProject((projectRoot) => {
  const slug = 'ready-for-package';
  write(path.join(projectRoot, '.planning', 'campaigns', `${slug}.md`), reviewPackageCampaign('Ready For Package', slug));

  const snapshot = collectDashboard({ projectRoot, now: '2026-06-05T12:00:00.000Z' });
  const action = routeAction(snapshot);

  assert.equal(action.kind, 'local-command');
  assert.equal(action.command, 'node scripts/package-delivery.js ready-for-package');
  assert.equal(action.args[0], path.join(__dirname, 'package-delivery.js'));
  assert.equal(action.args[1], 'ready-for-package');

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'continue-action.js'),
    '--project-root',
    projectRoot,
    '--run',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });

  assert(output.includes('Kind: local-command'));
  assert(output.includes('Delivery review package created.'));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'review-packages', `${slug}.md`)));
  const updated = fs.readFileSync(path.join(projectRoot, '.planning', 'campaigns', `${slug}.md`), 'utf8');
  assert(updated.includes('| phase:4 | review-package | review_package | yes | .planning/review-packages/ready-for-package.md | resolved | 2 | review local handoff package |'));
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

  const action = routeAction(collectDashboard({ projectRoot, now: '2026-06-05T12:00:00.000Z' }));
  assert.equal(action.kind, 'skill-route');
  assert.equal(action.command, '/archon continue');
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'fleet', 'session-alpha.md'), [
    'status: needs-continue',
    'current_wave: 2',
    'agents_total: 3',
  ].join('\n'));

  const action = routeAction(collectDashboard({ projectRoot, now: '2026-06-05T12:00:00.000Z' }));
  assert.equal(action.kind, 'skill-route');
  assert.equal(action.command, '/fleet continue');
});

withTempProject((projectRoot) => {
  fs.mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'continue-action.js'),
    '--project-root',
    projectRoot,
    '--json',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  const payload = JSON.parse(output);
  assert.equal(payload.action.kind, 'none');
  assert.equal(payload.action.command, '');
});

console.log('continue action tests passed');

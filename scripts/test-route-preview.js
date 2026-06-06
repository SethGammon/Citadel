#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');

const { buildPreview, keywordMatches, parseArgs, render, selectRoute } = require('./route-preview');

assert.deepEqual(parseArgs(['--json', '--project-root', '.', '--', 'review', 'auth']).input, 'review auth');

{
  const preview = buildPreview('what should I do next', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: false,
    now: '2026-06-05T12:00:00.000Z',
  });
  assert.equal(preview.selected, '/do next');
  assert.equal(preview.command, 'node scripts/operator-console.js --run');
  assert.equal(preview.tier, 0);
  assert.equal(preview.canRunNow, true);
}

{
  const route = selectRoute('review src/auth.ts');
  assert.equal(route.selected, '/review');
  assert.equal(route.tier, 2);
  assert(route.reason.includes('/review'));
}

{
  const route = selectRoute('review README.md for first-time developer friction');
  assert.equal(route.selected, '/review');
  assert.equal(route.tier, 2);
  assert(route.reason.includes('review intent'));
}

{
  const route = selectRoute('document README.md setup steps');
  assert.equal(route.selected, '/doc-gen');
  assert.equal(route.tier, 2);
}

{
  const route = selectRoute('research competitors and write implementation phases');
  assert.equal(route.selected, '/marshal');
  assert.equal(route.tier, 3);
  assert(route.alternatives.some((item) => item.route === '/research'));
}

{
  const route = selectRoute('use multiple agents at the same time on scripts/dashboard.js');
  assert.equal(route.selected, '/marshal');
  assert(route.reason.includes('single file') || route.reason.includes('single-file'));
}

{
  const route = selectRoute('run a campaign');
  assert.equal(route.selected, '/marshal');
  assert(route.reason.includes('brief'));
}

{
  const preview = buildPreview('review auth module', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: true,
  });
  assert.equal(preview.canRunNow, false);
  assert.equal(preview.boundary, 'worktree-review');
  assert(preview.approval.includes('uncommitted'));
}

{
  const matches = keywordMatches('fix ci and watch pr checks');
  assert(matches.some((item) => item.route === '/pr-watch'));
}

{
  const rendered = render(buildPreview('review auth module', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: false,
    now: '2026-06-05T12:00:00.000Z',
  }));
  assert(rendered.includes('Routing Preview'));
  assert(rendered.includes('Selected: /review'));
  assert(rendered.includes('Boundary'));
  assert(rendered.includes('Verify'));
}

{
  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'route-preview.js'),
    '--json',
    '--',
    'review auth module',
  ], { encoding: 'utf8' });
  const payload = JSON.parse(output);
  assert.equal(payload.selected, '/review');
  assert.equal(payload.input, 'review auth module');
}

console.log('route preview tests passed');

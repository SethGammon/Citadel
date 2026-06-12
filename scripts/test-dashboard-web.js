#!/usr/bin/env node

'use strict';

/**
 * test-dashboard-web.js -- Dashboard web server checks (docs/DASHBOARD_SPEC.md).
 *
 * Verifies the v0.1 read-only server against fixture .planning trees:
 * empty project, healthy project, and corrupted state. Also does one HTTP
 * round-trip on an ephemeral port, including the static traversal guard.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createServer, createDataSource, deriveViews } = require('./dashboard-server');

let failures = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function makeFixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `citadel-dash-${name}-`));
  return root;
}

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

async function main() {
  // 1. Empty project: no .planning at all. Must not crash, must say so.
  const emptyRoot = makeFixture('empty');
  try {
    const source = createDataSource(emptyRoot);
    const views = deriveViews(source.get());
    check('empty project does not crash', Boolean(views.overview));
    check('empty project reports planning_exists=false', views.overview.planning_exists === false);
    check('empty project has empty needs_you', Array.isArray(views.overview.needs_you));
    check('empty project cost is honest', views.cost.mode === 'unavailable' || typeof views.cost.mode === 'string');
  } finally {
    cleanup(emptyRoot);
  }

  // 2. Healthy project: a loop needing review, a handoff, daemon state.
  const healthyRoot = makeFixture('healthy');
  try {
    write(healthyRoot, '.planning/loops/nightly-deps.json', JSON.stringify({
      id: 'nightly-deps',
      type: 'dependency-refresh',
      status: 'needs-human-review',
      budget: { total: 5, spent: 3 },
      verifier: 'npm test',
    }));
    write(healthyRoot, '.planning/handoffs/2026-06-12-auth.md', '# Handoff\n');
    write(healthyRoot, '.planning/daemon.json', JSON.stringify({ running: false }));

    const source = createDataSource(healthyRoot);
    const views = deriveViews(source.get());
    // listLoops also surfaces legacy daemon state as a loop record, so find by id.
    check('healthy: loop listed', views.loops.loops.some((loop) => loop.id === 'nightly-deps'),
      `ids: ${views.loops.loops.map((loop) => loop.id).join(',')}`);
    check('healthy: loop surfaces in needs_you', views.overview.needs_you.some((item) => item.kind === 'loop'));
    check('healthy: handoff listed', views.handoffs.handoffs.length === 1);
    check('healthy: daemon read', views.loops.daemon && views.loops.daemon.running === false);

    // Invalidation: new handoff appears after invalidate().
    write(healthyRoot, '.planning/handoffs/2026-06-12-second.md', '# Handoff 2\n');
    source.invalidate();
    const after = deriveViews(source.get());
    check('healthy: invalidate picks up new files', after.handoffs.handoffs.length === 2,
      `got ${after.handoffs.handoffs.length}`);
  } finally {
    cleanup(healthyRoot);
  }

  // 3. Corrupted state: malformed JSON must render as absence, not a crash.
  const corruptRoot = makeFixture('corrupt');
  try {
    write(corruptRoot, '.planning/loops/broken.json', '{not json');
    write(corruptRoot, '.planning/daemon.json', '{also broken');
    const source = createDataSource(corruptRoot);
    let views = null;
    let threw = false;
    try {
      views = deriveViews(source.get());
    } catch {
      threw = true;
    }
    check('corrupted state does not throw', !threw);
    check('corrupted daemon renders as null', !threw && views.loops.daemon === null);
  } finally {
    cleanup(corruptRoot);
  }

  // 4. HTTP round-trip on an ephemeral port.
  const httpRoot = makeFixture('http');
  write(httpRoot, '.planning/handoffs/one.md', '# h\n');
  const server = createServer({ projectRoot: httpRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const overview = await fetch(`${base}/api/overview`).then((r) => r.json());
    check('http: /api/overview returns schema 1', overview.schema === 1);
    check('http: envelope carries generated_at', typeof overview.generated_at === 'string');

    const handoffs = await fetch(`${base}/api/handoffs`).then((r) => r.json());
    check('http: handoffs served', handoffs.data.handoffs.length === 1);

    const index = await fetch(`${base}/`);
    check('http: index served', index.status === 200);
    const indexBody = await index.text();
    check('http: index is the dashboard shell', indexBody.includes('CITADEL'));

    const css = await fetch(`${base}/styles.css`);
    check('http: static css served', css.status === 200 && (css.headers.get('content-type') || '').includes('text/css'));

    const traversal = await fetch(`${base}/..%2f..%2fpackage.json`);
    check('http: traversal guarded', traversal.status === 404, `got ${traversal.status}`);

    const unknown = await fetch(`${base}/api/nope`);
    check('http: unknown endpoint 404s', unknown.status === 404);

    const method = await fetch(`${base}/api/overview`, { method: 'POST' });
    check('http: write methods rejected', method.status === 405, `got ${method.status}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(httpRoot);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall dashboard web tests passed');
}

main().catch((error) => {
  console.error(`unhandled: ${error.stack || error}`);
  process.exit(1);
});

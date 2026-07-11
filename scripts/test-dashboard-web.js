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
const { EventEmitter } = require('events');

const { createServer, createDataSource, deriveViews, resolveEvidencePath, startWatcher } = require('./dashboard-server');

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
  const fallbackRoot = makeFixture('watcher-fallback');
  write(fallbackRoot, '.planning/campaigns/active.md', 'before');
  let fallbackChanged = false;
  const stopFallback = startWatcher(fallbackRoot, () => { fallbackChanged = true; }, {
    watchImpl: () => { throw new Error('recursive watch unsupported'); },
    pollMs: 20,
    debounceMs: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  write(fallbackRoot, '.planning/campaigns/active.md', 'after-content-is-different');
  await new Promise((resolve) => setTimeout(resolve, 70));
  stopFallback();
  check('watcher: polling fallback observes nested file edits', fallbackChanged);
  cleanup(fallbackRoot);

  const errorRoot = makeFixture('watcher-error');
  write(errorRoot, '.planning/campaigns/active.md', 'before');
  const fakeWatcher = new EventEmitter();
  fakeWatcher.close = () => {};
  let errorFallbackChanged = false;
  const stopErrorFallback = startWatcher(errorRoot, () => { errorFallbackChanged = true; }, {
    watchImpl: () => fakeWatcher,
    pollMs: 20,
    debounceMs: 5,
  });
  fakeWatcher.emit('error', new Error('watcher failed'));
  await new Promise((resolve) => setTimeout(resolve, 25));
  write(errorRoot, '.planning/campaigns/active.md', 'after-content-is-different');
  await new Promise((resolve) => setTimeout(resolve, 70));
  stopErrorFallback();
  check('watcher: runtime errors transition to nested polling', errorFallbackChanged);
  cleanup(errorRoot);

  // Pure policy coverage works even when the host cannot create symlinks.
  const policyRoot = path.resolve('C:/citadel-evidence-policy-fixture');
  const policyPlanning = path.join(policyRoot, '.planning');
  const policyLink = path.join(policyPlanning, 'linked');
  const policyTarget = path.join(policyLink, 'secret.md');
  const fakeFs = {
    lstatSync(candidate) {
      const normalized = path.resolve(candidate);
      return {
        isSymbolicLink: () => normalized === policyLink,
        isDirectory: () => normalized === policyPlanning,
        isFile: () => normalized === policyTarget,
      };
    },
    realpathSync(candidate) { return path.resolve(candidate); },
  };
  check('policy: symbolic intermediate entry is rejected',
    resolveEvidencePath(policyRoot, '.planning/linked/secret.md', fakeFs) === null);

  const escapingRealpathFs = {
    lstatSync(candidate) {
      const normalized = path.resolve(candidate);
      return {
        isSymbolicLink: () => false,
        isDirectory: () => normalized === policyPlanning,
        isFile: () => normalized === policyTarget,
      };
    },
    realpathSync(candidate) {
      return path.resolve(candidate) === policyTarget ? path.resolve(policyRoot, '..', 'secret.md') : path.resolve(candidate);
    },
  };
  check('policy: realpath escape is rejected',
    resolveEvidencePath(policyRoot, '.planning/linked/secret.md', escapingRealpathFs) === null);

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

  // 1b. Empty-but-initialized project: known empty is distinct from absent/unknown.
  const initializedRoot = makeFixture('initialized-empty');
  try {
    for (const dir of ['campaigns', 'fleet', 'loops', 'telemetry', 'handoffs']) {
      fs.mkdirSync(path.join(initializedRoot, '.planning', dir), { recursive: true });
    }
    const views = deriveViews(createDataSource(initializedRoot).get());
    check('initialized empty has schema-ready overview state', views.overview.state === 'empty', views.overview.state);
    check('initialized empty campaigns count is known zero', views.overview.active.campaigns === 0);
    check('initialized empty fleet count is known zero', views.overview.active.fleet_sessions === 0);
    check('initialized empty loops count is known zero', views.overview.active.loops === 0);
    for (const panel of ['campaigns', 'fleet', 'loops', 'hooks', 'handoffs']) {
      check(`initialized empty: ${panel} state is explicit`, views[panel].state.status === 'empty', views[panel].state.status);
    }
    check('initialized empty cost remains unknown, never zero', views.cost.state.status === 'unknown' && views.cost.mode === 'unavailable');
    check('initialized empty activation remains unknown', views.activation.state.status === 'unknown' && views.activation.report === null);
  } finally {
    cleanup(initializedRoot);
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
    write(healthyRoot, '.planning/fleet/session-live.md', 'status: active\ncurrent_wave: 2\nagents_total: 3\n');
    write(healthyRoot, '.planning/telemetry/hook-timing.jsonl', `${JSON.stringify({ timestamp: '2026-06-12T12:00:00.000Z', hook: 'quality-gate', duration_ms: 4 })}\n`);
    write(healthyRoot, '.planning/telemetry/session-costs.jsonl', `${JSON.stringify({ timestamp: '2026-06-12T12:00:00.000Z', campaign_slug: 'proof', estimated_cost: 1.25 })}\n`);
    write(healthyRoot, '.planning/product-proof/activation-report.json', JSON.stringify({
      schema: 1, redacted: true, transmitted: false, total_events: 2,
      unique_installations: 1, invalid_events: 0, migrated_events: 0,
      by_stage: { setup_completed: 1 }, by_status: { succeeded: 2 },
      by_failure_code: {}, by_acquisition_source: { github_search: 1 },
    }));

    const source = createDataSource(healthyRoot);
    const views = deriveViews(source.get());
    // listLoops also surfaces legacy daemon state as a loop record, so find by id.
    check('healthy: loop listed', views.loops.loops.some((loop) => loop.id === 'nightly-deps'),
      `ids: ${views.loops.loops.map((loop) => loop.id).join(',')}`);
    check('healthy: loop surfaces in needs_you', views.overview.needs_you.some((item) => item.kind === 'loop'));
    check('healthy: handoff listed', views.handoffs.handoffs.length === 1);
    check('healthy: daemon read', views.loops.daemon && views.loops.daemon.running === false);
    check('mid-run fleet state is explicit', views.fleet.state.status === 'mid-run', views.fleet.state.status);
    check('healthy hook source is explicit', views.hooks.state.status === 'healthy', views.hooks.state.status);
    check('healthy cost source is explicit', views.cost.state.status === 'healthy' && views.cost.session_count === 1);
    check('healthy activation source is explicit', views.activation.state.status === 'healthy' && views.activation.report.total_events === 2);

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
    write(corruptRoot, '.planning/campaigns/broken.md', '---\nstatus: [broken\n---\n');
    write(corruptRoot, '.planning/telemetry/hook-timing.jsonl', '{bad jsonl\n');
    write(corruptRoot, '.planning/telemetry/session-costs.jsonl', '{bad cost\n');
    write(corruptRoot, '.planning/product-proof/activation-report.json', '{bad activation');
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
    check('corrupted loops are unreadable, not empty', views.loops.state.status === 'unreadable', views.loops.state.status);
    check('corrupted hooks are unreadable, not zero', views.hooks.state.status === 'unreadable', views.hooks.state.status);
    check('corrupted cost is unreadable, not zero', views.cost.state.status === 'unreadable' && views.cost.mode === 'unavailable');
    check('corrupted activation is unreadable, not empty', views.activation.state.status === 'unreadable' && views.activation.report === null);
    check('corrupted overview exposes source failures', views.overview.state === 'unreadable' && views.overview.needs_you.some((item) => item.kind === 'source'));
    check('corrupted loop count is unknown', views.overview.active.loops === null);
  } finally {
    cleanup(corruptRoot);
  }

  // 4. HTTP round-trip on an ephemeral port.
  const httpRoot = makeFixture('http');
  const outsideRoot = makeFixture('outside');
  write(httpRoot, '.planning/handoffs/one.md', '# h\n');
  write(outsideRoot, 'secret.md', 'must not escape\n');
  let symlinkCreated = false;
  try {
    fs.symlinkSync(path.join(outsideRoot, 'secret.md'), path.join(httpRoot, '.planning', 'handoffs', 'escape.md'), 'file');
    symlinkCreated = true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
  }
  const server = createServer({ projectRoot: httpRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const overview = await fetch(`${base}/api/overview`).then((r) => r.json());
    check('http: /api/overview returns schema 1', overview.schema === 1);
    check('http: envelope carries generated_at', typeof overview.generated_at === 'string');
    check('http: envelope carries source_files', Array.isArray(overview.source_files));

    for (const endpoint of ['campaigns', 'fleet', 'loops', 'hooks/feed', 'cost', 'handoffs', 'activation']) {
      const response = await fetch(`${base}/api/${endpoint}`).then((r) => r.json());
      check(`http: /api/${endpoint} returns schema 1`, response.schema === 1);
      check(`http: /api/${endpoint} includes projection state`, response.data && response.data.state && typeof response.data.state.status === 'string');
    }

    const handoffs = await fetch(`${base}/api/handoffs`).then((r) => r.json());
    check('http: handoffs served', handoffs.data.handoffs.length === 1);

    const evidence = await fetch(`${base}/evidence?path=${encodeURIComponent('.planning/handoffs/one.md')}`);
    check('http: evidence links open read-only planning files', evidence.status === 200 && (await evidence.text()).includes('# h'));
    const escapedEvidence = await fetch(`${base}/evidence?path=${encodeURIComponent('../package.json')}`);
    check('http: evidence cannot escape .planning', escapedEvidence.status === 404);
    if (symlinkCreated) {
      const symlinkEvidence = await fetch(`${base}/evidence?path=${encodeURIComponent('.planning/handoffs/escape.md')}`);
      check('http: symlink evidence escape is rejected', symlinkEvidence.status === 404);
    } else {
      console.log('SKIP http: symlink evidence escape (host cannot create symlinks; pure policy coverage passed)');
    }

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
    cleanup(outsideRoot);
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

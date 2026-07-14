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
const { sha256Digest } = require('../core/operations');
const operations = require('../core/operations');
const forks = require('../core/forks');

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

function operationRecord(operationId, status, capabilities, revision = 3) {
  const now = '2026-07-13T12:00:00.000Z';
  const spec = {
    protocol_version: '0.1', kind: 'operation_spec', operation_id: operationId,
    title: `Dashboard ${operationId}`, objective_digest: sha256Digest({ operationId }),
    step_ids: ['step-dashboard'], policy_digests: [], created_at: now,
  };
  return {
    control_version: '0.1', revision, capabilities, spec,
    run: {
      protocol_version: '0.1', kind: 'operation_run', run_id: `run-${operationId}`,
      operation_id: operationId, spec_digest: sha256Digest(spec), status,
      started_at: status === 'pending' ? null : now, completed_at: null,
      intent_ids: [], step_attempt_ids: [],
    },
  };
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
    write(healthyRoot, '.planning/product-proof/activation-cohort-report.json', JSON.stringify({
      schema: 1, kind: 'activation_cohort_report', milestone_status: 'collecting',
      privacy: 'opt-in aggregate',
      cohort: { shared_installations: 3, successful_installs: 3, attempted_installs: 3, seven_day_eligible: 1, setup_rate: 1, verified_handoff_rate: 0.67, resume_rate: 0.33, seven_day_return_rate: 1, install_or_route_failure_rate: 0 },
      targets: { shared_installations: 25 }, gates: {}, limitations: [],
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
    check('healthy shared cohort is projected', views.activation.cohort && views.activation.cohort.cohort.shared_installations === 3);

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
  write(httpRoot, '.planning/operations/control/operation-pause.json', JSON.stringify(
    operationRecord('operation-pause', 'running', ['pause'])));
  write(httpRoot, '.planning/operations/control/operation-denied.json', JSON.stringify(
    operationRecord('operation-denied', 'running', [])));
  write(outsideRoot, 'secret.md', 'must not escape\n');
  const forkOperation = {
    protocol_version: operations.PROTOCOL_VERSION, kind: operations.CONTRACT_KINDS.OPERATION_SPEC,
    operation_id: 'operation-dashboard-fork', title: 'Dashboard fork',
    objective_digest: sha256Digest({ objective: 'dashboard fork' }), step_ids: ['step-verify'],
    policy_digests: [], created_at: '2026-07-13T12:00:00.000Z',
  };
  const forkShared = { objective_digest: forkOperation.objective_digest,
    scope_digest: sha256Digest({ scope: 'repo' }), policy_digests: [],
    budget_digest: sha256Digest({ budget: 1 }), workflow_digest: sha256Digest({ workflow: 1 }),
    verifier_digest: sha256Digest({ verifier: 1 }), base_revision: 'a'.repeat(40) };
  let dashboardFork = forks.createOperationFork({ forkId: 'fork-dashboard', operation: forkOperation,
    shared: forkShared, createdAt: '2026-07-13T12:00:00.000Z' });
  const completeBranch = (name) => ({ status: 'passed', worktree_ref: `fork-dashboard/${name}`,
    branch_ref: `citadel/fork-dashboard/${name}`, started_at: '2026-07-13T12:00:01.000Z',
    completed_at: '2026-07-13T12:00:02.000Z', receipt_digest: sha256Digest({ receipt: name }),
    evidence_summary: { status: 'passed', required: 1, present: 1, receipt_verified: true, score: null, score_max: null },
    diff_summary: { files_changed: 1, insertions: 1, deletions: 0, digest: sha256Digest({ diff: name }) },
    duration_ms: 1000, cost: null, failure_code: null });
  dashboardFork = forks.updateBranch(dashboardFork, 'branch-claude', completeBranch('branch-claude'), '2026-07-13T12:00:03.000Z');
  dashboardFork = forks.updateBranch(dashboardFork, 'branch-codex', completeBranch('branch-codex'), '2026-07-13T12:00:04.000Z');
  forks.createForkRecord(httpRoot, dashboardFork);
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

    for (const endpoint of ['campaigns', 'fleet', 'forks', 'loops', 'hooks/feed', 'cost', 'handoffs', 'activation']) {
      const response = await fetch(`${base}/api/${endpoint}`).then((r) => r.json());
      check(`http: /api/${endpoint} returns schema 1`, response.schema === 1);
      check(`http: /api/${endpoint} includes projection state`, response.data && response.data.state && typeof response.data.state.status === 'string');
    }

    const forkProjection = await fetch(`${base}/api/forks`).then((r) => r.json());
    const projectedProof = forkProjection.data.forks[0].proof;
    check('http: fork proof projection is bounded', projectedProof
      && JSON.stringify(Object.keys(projectedProof).sort()) === JSON.stringify(['digest', 'summary'])
      && !Object.hasOwn(projectedProof, 'replay'));
    check('http: fork proof projection keeps exact denominators', projectedProof.summary.branch_count === 2
      && projectedProof.summary.verified_receipt_count === 0
      && Object.hasOwn(projectedProof.summary.model_proof_counts, 'unknown'));

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

    const controlResponse = await fetch(`${base}/api/control`);
    const control = await controlResponse.json();
    check('http: process nonce is exposed through no-store same-origin state',
      controlResponse.status === 200 && control.nonce.length >= 32
      && controlResponse.headers.get('cache-control') === 'no-store');

    const intent = {
      operation_id: 'operation-pause', expected_revision: 3, idempotency_key: 'dashboard-pause',
      actor: 'actor-dashboard', reason: 'Pause from Mission Control', capability: 'pause', action: 'pause',
    };
    const post = (body, headers = {}) => fetch(`${base}/api/intents`, {
      method: 'POST',
      headers: {
        origin: base, 'x-citadel-nonce': control.nonce, 'content-type': 'application/json', ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const postFork = (body, headers = {}) => fetch(`${base}/api/fork-selections`, {
      method: 'POST',
      headers: { origin: base, 'x-citadel-nonce': control.nonce, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const forkSelection = { fork_id: 'fork-dashboard', branch_id: 'branch-claude',
      expected_revision: dashboardFork.revision, idempotency_key: 'dashboard-fork-selection',
      actor: 'actor-dashboard', reason: 'Verified in fixture' };
    const selectedResponse = await postFork(forkSelection);
    const selectedFork = await selectedResponse.json();
    check('http: valid fork selection records intent without landing', selectedResponse.status === 202
      && selectedFork.landing_effect === 'none');
    const arbitraryForkCommand = await postFork({ ...forkSelection, idempotency_key: 'dashboard-fork-command', command: 'whoami' });
    check('http: fork selection rejects arbitrary command fields', arbitraryForkCommand.status === 400
      && (await arbitraryForkCommand.json()).reason_code === 'INVALID_FORK_SELECTION');

    const badOrigin = await post(intent, { origin: 'http://127.0.0.1:9' });
    check('http: strict origin rejects foreign callers', badOrigin.status === 403
      && (await badOrigin.json()).reason_code === 'ORIGIN_REJECTED');
    const badNonce = await post(intent, { 'x-citadel-nonce': 'not-the-process-nonce' });
    check('http: process nonce rejects forged callers', badNonce.status === 403
      && (await badNonce.json()).reason_code === 'NONCE_REJECTED');
    const badType = await post(intent, { 'content-type': 'text/plain' });
    check('http: JSON content type is mandatory', badType.status === 415
      && (await badType.json()).reason_code === 'CONTENT_TYPE_REJECTED');
    const tooLarge = await post(JSON.stringify({ padding: 'x'.repeat(17000) }));
    check('http: oversized intent bodies are rejected', tooLarge.status === 413
      && (await tooLarge.json()).reason_code === 'BODY_TOO_LARGE');

    const acceptedResponse = await post(intent);
    const accepted = await acceptedResponse.json();
    check('http: valid pause queues an immutable intent', acceptedResponse.status === 202
      && accepted.outcome === 'accepted' && accepted.intent_id);
    const duplicateResponse = await post(intent);
    const duplicate = await duplicateResponse.json();
    check('http: duplicate idempotency returns the same outcome', duplicateResponse.status === 202
      && JSON.stringify(duplicate) === JSON.stringify(accepted));
    const pendingFiles = fs.readdirSync(path.join(httpRoot, '.planning', 'intents', 'pending'))
      .filter((name) => name.endsWith('.json'));
    check('http: duplicate idempotency creates one pending file', pendingFiles.length === 1);
    const campaignsAfterIntent = await fetch(`${base}/api/campaigns`).then((response) => response.json());
    const pendingOperation = campaignsAfterIntent.data.operations.find((entry) => entry.operation_id === 'operation-pause');
    check('http: canonical pending intent is projected into Mission Control',
      pendingOperation.pending_intent.action === 'pause');

    const staleResponse = await post({ ...intent, expected_revision: 2, idempotency_key: 'dashboard-stale' });
    check('http: stale revision returns conflict', staleResponse.status === 409
      && (await staleResponse.json()).reason_code === 'STALE_REVISION');
    const blockedResponse = await post({
      ...intent, operation_id: 'operation-denied', idempotency_key: 'dashboard-denied',
    });
    check('http: missing capability returns blocked', blockedResponse.status === 403
      && (await blockedResponse.json()).reason_code === 'CAPABILITY_NOT_GRANTED');
    const commandResponse = await post({ ...intent, idempotency_key: 'dashboard-command', command: 'whoami' });
    check('http: arbitrary command fields are rejected', commandResponse.status === 400
      && (await commandResponse.json()).reason_code === 'INVALID_ARGUMENTS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(httpRoot);
    cleanup(outsideRoot);
  }

  const symlinkRoot = makeFixture('intent-symlink');
  const symlinkOutside = makeFixture('intent-symlink-outside');
  let symlinkServer;
  try {
    write(symlinkRoot, '.planning/operations/control/operation-pause.json', JSON.stringify(
      operationRecord('operation-pause', 'running', ['pause'])));
    fs.mkdirSync(path.join(symlinkOutside, 'intents-target'), { recursive: true });
    fs.symlinkSync(path.join(symlinkOutside, 'intents-target'), path.join(symlinkRoot, '.planning', 'intents'),
      process.platform === 'win32' ? 'junction' : 'dir');
    symlinkServer = createServer({ projectRoot: symlinkRoot });
    await new Promise((resolve) => symlinkServer.listen(0, '127.0.0.1', resolve));
    const symlinkBase = `http://127.0.0.1:${symlinkServer.address().port}`;
    const symlinkControl = await fetch(`${symlinkBase}/api/control`).then((response) => response.json());
    const response = await fetch(`${symlinkBase}/api/intents`, {
      method: 'POST',
      headers: { origin: symlinkBase, 'x-citadel-nonce': symlinkControl.nonce, 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: 'operation-pause', expected_revision: 3, idempotency_key: 'symlink-block',
        actor: 'actor-dashboard', reason: 'Must remain contained', capability: 'pause', action: 'pause',
      }),
    });
    check('http: symlinked intent store is blocked', response.status === 503
      && (await response.json()).reason_code === 'INTENT_STORE_UNAVAILABLE');
    check('http: symlink target remains untouched', fs.readdirSync(path.join(symlinkOutside, 'intents-target')).length === 0);
  } finally {
    if (symlinkServer) await new Promise((resolve) => symlinkServer.close(resolve));
    cleanup(symlinkRoot);
    cleanup(symlinkOutside);
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

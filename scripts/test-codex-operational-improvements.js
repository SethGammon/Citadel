#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  buildAppServerApprovalResponse,
  buildGitHubReviewFetchCommands,
  checkCodexReadiness,
  createPluginMarketplace,
  ingestCodexReview,
  recordAppArtifact,
  summarizeAppServerEvents,
  verifyAppServerCapture,
  verifyAppArtifacts,
  writeAppServerDashboard,
} = require('../core/codex/native-integrations');

const CITADEL_ROOT = path.resolve(__dirname, '..');

function tempProject(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function stagePluginRoot(targetRoot) {
  const excluded = new Set(['.git', '.planning', 'node_modules']);
  fs.cpSync(CITADEL_ROOT, targetRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(CITADEL_ROOT, source);
      const topLevel = relative.split(path.sep)[0];
      return !excluded.has(topLevel);
    },
  });
}

function snapshotSourcePluginArtifacts() {
  return [
    path.join(CITADEL_ROOT, '.codex', 'config.toml'),
    path.join(CITADEL_ROOT, '.agents', 'plugins', 'marketplace.json'),
  ].map((file) => ({
    file,
    contents: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null,
  }));
}

function testReadinessCheck() {
  const tmp = tempProject('citadel-readiness-');
  try {
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# Test\n\n## Review guidelines\n\n- Focus on P0/P1 issues.\n', 'utf8');
    execFileSync(process.execPath, [path.join(CITADEL_ROOT, 'scripts', 'codex-compat.js'), tmp], {
      cwd: CITADEL_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 20000,
    });

    const report = checkCodexReadiness({ projectRoot: tmp, write: true });
    assert(report.pass, JSON.stringify(report.checks.filter((check) => !check.pass), null, 2));
    assert(fs.existsSync(path.join(tmp, '.planning', 'verification', 'codex-readiness.json')));
    const manifest = fs.readFileSync(path.join(tmp, '.codex-plugin', 'plugin.json'), 'utf8');
    assert.doesNotThrow(() => JSON.parse(manifest), 'target-project plugin manifest must be strict JSON');
    assert(manifest.includes('./.agents/skills/'), 'target-project plugin manifest should point at generated skills');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testPluginMarketplaceSmoke() {
  const tmp = tempProject('citadel-plugin-smoke-');
  try {
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# Test\n\n## Review guidelines\n\n- Focus on P0/P1 issues.\n', 'utf8');
    execFileSync(process.execPath, [path.join(CITADEL_ROOT, 'scripts', 'codex-compat.js'), tmp], {
      cwd: CITADEL_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 20000,
    });

    const report = createPluginMarketplace({ projectRoot: tmp, write: true });
    assert(report.pass, JSON.stringify(report.checks, null, 2));
    assert(fs.existsSync(path.join(tmp, '.agents', 'plugins', 'marketplace.json')));
    const generatedManifest = JSON.parse(fs.readFileSync(path.join(tmp, '.agents', '.codex-plugin', 'plugin.json'), 'utf8'));
    assert.equal(report.marketplace.plugins[0].version, generatedManifest.version);
    assert.equal(report.marketplace.plugins[0].description, generatedManifest.description);
    assert.equal(report.marketplace.plugins[0].repository, generatedManifest.repository);
    assert(report.codexCliCommands.some((command) => command.includes('codex plugin marketplace add')));

    const smoke = execFileSync(process.execPath, [
      path.join(CITADEL_ROOT, 'scripts', 'codex-plugin-smoke.js'),
      '--project-root',
      tmp,
      '--write',
    ], {
      cwd: CITADEL_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 20000,
    });
    const smokeReport = JSON.parse(smoke);
    assert(smokeReport.pass, JSON.stringify(smokeReport, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testCodexInstallScript() {
  const tmp = tempProject('citadel-codex-install-');
  const projectRoot = path.join(tmp, 'project');
  const pluginRoot = path.join(tmp, 'plugin');
  const sourceArtifactsBefore = snapshotSourcePluginArtifacts();
  try {
    fs.mkdirSync(projectRoot, { recursive: true });
    stagePluginRoot(pluginRoot);
    fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Test\n\n## Review guidelines\n\n- Focus on P0/P1 issues.\n', 'utf8');
    const output = execFileSync(process.execPath, [
      path.join(CITADEL_ROOT, 'scripts', 'codex-install.js'),
      '--project-root',
      projectRoot,
      '--plugin-root',
      pluginRoot,
      '--json',
    ], {
      cwd: CITADEL_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 60000,
    });
    const report = JSON.parse(output);
    assert(report.pass, JSON.stringify(report.steps.filter((step) => !step.pass), null, 2));
    assert.equal(report.mode, 'plugin-and-project');
    assert(report.steps.some((step) => step.name === 'Refresh Citadel Codex plugin artifacts'));
    assert(report.steps.some((step) => step.name === 'Write and validate local Codex plugin marketplace'));
    assert(report.steps.some((step) => step.name === 'Verify Codex project readiness'));
    assert.equal(report.pluginRoot, pluginRoot);
    assert(fs.existsSync(path.join(projectRoot, '.codex', 'config.toml')));
    assert(fs.existsSync(path.join(projectRoot, '.planning', 'verification', 'codex-readiness.json')));
    assert(fs.existsSync(path.join(pluginRoot, '.agents', 'plugins', 'marketplace.json')));
    assert(report.nextSteps.codexApp.some((step) => step.includes('Add to Codex')));

    const noRefresh = execFileSync(process.execPath, [
      path.join(CITADEL_ROOT, 'scripts', 'codex-install.js'),
      '--project-root',
      projectRoot,
      '--plugin-root',
      pluginRoot,
      '--plugin-only',
      '--skip-plugin-refresh',
      '--json',
    ], {
      cwd: CITADEL_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 20000,
    });
    const noRefreshReport = JSON.parse(noRefresh);
    assert(noRefreshReport.pass, JSON.stringify(noRefreshReport, null, 2));
    assert.equal(noRefreshReport.mode, 'plugin-only');
    assert(!noRefreshReport.steps.some((step) => step.name === 'Refresh Citadel Codex plugin artifacts'));
    assert(noRefreshReport.steps.some((step) => step.name === 'Write and validate local Codex plugin marketplace'));
    assert.deepEqual(snapshotSourcePluginArtifacts(), sourceArtifactsBefore, 'staged installs must not mutate an immutable source checkout');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testCodexReviewIngestion() {
  const tmp = tempProject('citadel-review-ingest-');
  try {
    const input = [
      {
        id: 1,
        user: { login: 'codex[bot]' },
        body: '[P1] This introduces an auth bypass.',
        path: 'src/auth.ts',
        line: 42,
        html_url: 'https://github.com/owner/repo/pull/7#discussion_r1',
      },
      {
        id: 2,
        user: { login: 'octocat' },
        body: 'Looks good.',
      },
    ];
    const result = ingestCodexReview({
      projectRoot: tmp,
      repo: 'owner/repo',
      prNumber: 7,
      input,
      write: true,
      now: '2026-06-01T00:00:00.000Z',
    });
    assert.equal(result.codexItems, 1);
    assert.equal(result.counts.P1, 1);
    assert(result.nextActions.some((action) => action.includes('verification')));
    const statePath = path.join(tmp, '.planning', 'pr-review', 'owner-repo-7.json');
    assert(fs.existsSync(statePath), 'review state should be written');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.codexReview.findings[0].path, 'src/auth.ts');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testCodexReviewFetchScript() {
  const tmp = tempProject('citadel-review-fetch-');
  try {
    const fixture = path.join(tmp, 'reviews.json');
    fs.writeFileSync(fixture, JSON.stringify([
      {
        id: 100,
        user: { login: 'codex[bot]' },
        body: '[P1] This drops authorization.',
        path: 'api/auth.js',
        line: 12,
      },
    ]), 'utf8');

    const commands = buildGitHubReviewFetchCommands({ repo: 'owner/repo', prNumber: 7 });
    assert.equal(commands.length, 3);
    assert(commands[0][1].includes('repos/owner/repo/issues/7/comments'));

    const output = execFileSync(process.execPath, [
      path.join(CITADEL_ROOT, 'scripts', 'codex-review-fetch.js'),
      '--repo',
      'owner/repo',
      '--pr',
      '7',
      '--file',
      fixture,
      '--project-root',
      tmp,
      '--write',
    ], {
      cwd: CITADEL_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 20000,
    });
    const result = JSON.parse(output);
    assert.equal(result.fetchedItems, 1);
    assert.equal(result.result.codexItems, 1);
    assert(fs.existsSync(path.join(tmp, '.planning', 'pr-review', 'owner-repo-7.json')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testArtifactVerification() {
  const tmp = tempProject('citadel-artifacts-');
  try {
    const screenshot = path.join(tmp, '.planning', 'screenshots', 'qa.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    fs.writeFileSync(screenshot, 'fake-png', 'utf8');
    recordAppArtifact({
      projectRoot: tmp,
      workflow: 'qa',
      kind: 'screenshot',
      path: '.planning/screenshots/qa.png',
      status: 'pass',
    });
    const pass = verifyAppArtifacts({ projectRoot: tmp, requireExistingPaths: true });
    assert(pass.pass, JSON.stringify(pass, null, 2));

    recordAppArtifact({
      projectRoot: tmp,
      workflow: 'qa',
      kind: 'screenshot',
      path: '.planning/screenshots/missing.png',
      status: 'pass',
    });
    const fail = verifyAppArtifacts({ projectRoot: tmp, requireExistingPaths: true });
    assert(!fail.pass, 'missing artifact paths should fail verification');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testAppServerEventSummary() {
  const events = [
    { id: 1, result: { thread: { id: 'thr_1' } } },
    { method: 'turn/started', params: { threadId: 'thr_1', turn: { id: 'turn_1' } } },
    { method: 'item/commandExecution/outputDelta', params: { threadId: 'thr_1', turnId: 'turn_1', delta: 'abc' } },
    { method: 'turn/diff/updated', params: { threadId: 'thr_1', turnId: 'turn_1' } },
    { id: 8, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr_1', turnId: 'turn_1' } },
  ];
  const summary = summarizeAppServerEvents(events);
  assert.equal(summary.messageCount, 5);
  assert.deepEqual(summary.threads, ['thr_1']);
  assert.equal(summary.commandOutputBytes, 3);
  assert.equal(summary.fileChanges, 1);
  assert.equal(summary.approvals, 1);
  assert.equal(summary.usefulForDashboard, true);
}

function testAppServerApprovalResponse() {
  const request = {
    id: 8,
    method: 'item/commandExecution/requestApproval',
    params: {
      itemId: 'item_1',
      availableDecisions: ['accept', 'decline', 'cancel'],
    },
  };
  assert.deepEqual(buildAppServerApprovalResponse({
    ...request,
    method: 'item/commandExecution/requestApproval',
  }), {
    id: 8,
    result: 'decline',
  });
  assert.deepEqual(buildAppServerApprovalResponse({
    ...request,
    method: 'item/fileChange/requestApproval',
  }, { decision: 'accept' }), {
    id: 8,
    result: { decision: 'accept' },
  });
  assert.equal(buildAppServerApprovalResponse({ id: 9, method: 'thread/start' }), null);
}

function testAppServerDashboard() {
  const tmp = tempProject('citadel-app-server-dashboard-');
  try {
    const events = [
      JSON.stringify({ result: { thread: { id: 'thr_1' } } }),
      JSON.stringify({ method: 'turn/started', params: { threadId: 'thr_1', turn: { id: 'turn_1' } } }),
      JSON.stringify({ method: 'item/commandExecution/outputDelta', params: { threadId: 'thr_1', turnId: 'turn_1', delta: 'abc' } }),
    ].join('\n');
    const eventPath = path.join(tmp, 'events.jsonl');
    fs.writeFileSync(eventPath, events, 'utf8');

    const summary = summarizeAppServerEvents(events);
    const dashboard = writeAppServerDashboard({ projectRoot: tmp, summary, source: eventPath });
    assert(fs.existsSync(dashboard.summaryPath));
    assert(fs.existsSync(dashboard.dashboardPath));
    assert(fs.readFileSync(dashboard.dashboardPath, 'utf8').includes('Codex App-Server Event Summary'));

    const output = execFileSync(process.execPath, [
      path.join(CITADEL_ROOT, 'scripts', 'codex-app-server-dashboard.js'),
      '--project-root',
      tmp,
      '--file',
      eventPath,
    ], {
      cwd: CITADEL_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 20000,
    });
    const result = JSON.parse(output);
    assert(fs.existsSync(result.dashboardPath));
    assert.equal(result.summary.commandOutputBytes, 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function testAppServerCaptureVerification() {
  const fixture = [
    { id: 1, result: { userAgent: 'citadel_test/0.1.0', platformFamily: 'windows' } },
    { method: 'remoteControl/status/changed', params: { status: 'disabled' } },
    { id: 2, result: { thread: { id: 'thr_fixture', cwd: 'C:/repo' } } },
    { method: 'thread/started', params: { thread: { id: 'thr_fixture' } } },
    { id: 3, result: {} },
    { method: 'turn/started', params: { threadId: 'thr_fixture', turn: { id: 'turn_fixture' } } },
    { id: 4, method: 'item/fileChange/requestApproval', params: { itemId: 'file_1', threadId: 'thr_fixture', turnId: 'turn_fixture' } },
    { method: 'turn/completed', params: { threadId: 'thr_fixture', turn: { id: 'turn_fixture', status: 'completed' } } },
  ];
  const verification = verifyAppServerCapture(fixture, {
    requireTurn: true,
    requireTurnCompleted: true,
    requireApproval: true,
  });
  assert(verification.pass, JSON.stringify(verification, null, 2));
  assert.equal(verification.summary.threads[0], 'thr_fixture');

  const dryRun = execFileSync(process.execPath, [
    path.join(CITADEL_ROOT, 'scripts', 'codex-app-server-capture.js'),
    '--dry-run',
    '--project-root',
    CITADEL_ROOT,
    '--turn-file',
    path.join(CITADEL_ROOT, 'AGENTS.md'),
    '--expect-approval',
    '--turn-sandbox',
    'readOnly',
  ], {
    cwd: CITADEL_ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 20000,
  });
  const plan = JSON.parse(dryRun);
  assert.equal(plan.command, 'codex');
  assert(plan.outPath.includes(path.join('.planning', 'app-server')));
  assert.equal(plan.approvalDecision, 'decline');
  assert.equal(plan.expectApproval, true);
  assert.equal(plan.turnSandbox, 'readOnly');
}

testReadinessCheck();
testPluginMarketplaceSmoke();
testCodexInstallScript();
testCodexReviewIngestion();
testCodexReviewFetchScript();
testArtifactVerification();
testAppServerEventSummary();
testAppServerApprovalResponse();
testAppServerDashboard();
testAppServerCaptureVerification();

console.log('codex operational improvement tests passed');

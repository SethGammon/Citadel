#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildPreview, keywordMatches, parseArgs, render, selectRoute } = require('./route-preview');

// Hermetic runtime identity: force a single runtime so neither marker-dir
// ambiguity in the checkout nor a caller-exported CITADEL_RUNTIME can leak
// into activation decisions.
process.env.CITADEL_RUNTIME = 'claude-code';

assert.deepEqual(parseArgs(['--json', '--project-root', '.', '--', 'review', 'auth']).input, 'review auth');

{
  const args = parseArgs(['--route', '/test-gen', '--', 'generate', 'tests']);
  assert.equal(args.routeOverride, '/test-gen');
  assert.equal(args.input, 'generate tests');
}

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
  assert.equal(route.selected, null);
  assert.equal(route.suggestedRoute, '/review');
  assert.equal(route.tier, 2);
  assert(route.reason.includes('/review'));
}

{
  const route = selectRoute('review README.md for first-time developer friction');
  assert.equal(route.suggestedRoute, '/review');
  assert.equal(route.tier, 2);
  assert(route.reason.includes('review intent'));
}

{
  const route = selectRoute('document README.md setup steps');
  assert.equal(route.suggestedRoute, '/doc-gen');
  assert.equal(route.tier, 2);
}

{
  const route = selectRoute('research competitors and write implementation phases');
  assert.equal(route.suggestedRoute, '/marshal');
  assert.equal(route.tier, 3);
  assert(route.alternatives.some((item) => item.route === '/research'));
}

{
  // Static preflight reports the generated candidate without running the
  // runtime proportionality classifier.
  const route = selectRoute('use multiple agents at the same time on src/auth-helper.ts');
  assert.equal(route.suggestedRoute, '/fleet --quick');
  assert(route.reason.includes('candidate'));
}

{
  const route = selectRoute('run a campaign');
  assert.equal(route.suggestedRoute, '/archon');
  assert(route.reason.includes('candidate'));
}

{
  const preview = buildPreview('review auth module', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: true,
  });
  assert.equal(preview.canRunNow, false);
  assert.equal(preview.boundary, 'semantic-classification-required');
  assert(preview.approval.includes('full /do protocol'));
}

{
  const matches = keywordMatches('fix ci and watch pr checks');
  assert(matches.some((item) => item.route === '/pr-watch'));
}

{
  const matches = keywordMatches('@citadel inspect this marker');
  assert(matches.some((item) => item.route === '/watch'));
}

{
  const route = selectRoute('use multiple agents in parallel');
  assert.equal(route.suggestedRoute, '/fleet --quick');
  assert(route.candidates.some((item) => item.route === '/fleet --quick'));
}

{
  // Multi-word keywords are word-boundary anchored: setup's "install citadel"
  // must not match inside "uninstall citadel".
  const matches = keywordMatches('uninstall citadel from this project');
  assert(matches.some((item) => item.route === '/unharness'));
  assert(!matches.some((item) => item.route === '/setup'));

  const route = selectRoute('uninstall citadel from this project');
  assert.equal(route.suggestedRoute, '/unharness');
  assert.equal(route.tier, 2);
}

{
  const route = selectRoute('loop until lint passes with max attempts 3');
  assert.equal(route.suggestedRoute, '/loop');
  assert.equal(route.tier, 2);
  assert(route.verification.includes('loop contract'));
}

{
  const route = selectRoute('retry until tests pass with max attempts 3');
  assert.equal(route.suggestedRoute, '/loop');
  assert.equal(route.tier, 2);
}

{
  const route = selectRoute('generate tests for the changed files');
  assert.equal(route.command, null);
  assert.equal(route.selected, null);
  assert.equal(route.suggestedRoute, '/test-gen');
  assert.equal(route.final, false);
  assert.equal(route.canRunNow, false);
  assert.equal(route.boundary, 'semantic-classification-required');
  assert.equal(route.requiresSemanticClassification, true);
  assert(route.candidates.some((item) => item.route === '/test-gen'));
}

{
  const route = selectRoute('build me a recipe app');
  assert.equal(route.command, null);
  assert.equal(route.selected, null);
  assert.equal(route.suggestedRoute, '/create-app');
  assert.equal(route.final, false);
  assert.equal(route.canRunNow, false);
  assert.equal(route.boundary, 'semantic-classification-required');
  assert.equal(route.requiresSemanticClassification, true);
  assert(route.candidates.some((item) => item.route === '/create-app'));
}

{
  const route = selectRoute('status page feature');
  assert.notEqual(route.selected, '/dashboard');
  assert.equal(route.final, false);
  assert.equal(route.command, null);
  assert.equal(route.canRunNow, false);
  assert.equal(route.boundary, 'semantic-classification-required');
  assert.equal(route.requiresSemanticClassification, true);
}

{
  const route = selectRoute('continue implementing auth');
  assert.notEqual(route.selected, '/do continue');
  assert.equal(route.final, false);
  assert.equal(route.command, null);
  assert.equal(route.canRunNow, false);
  assert.equal(route.boundary, 'semantic-classification-required');
  assert.equal(route.requiresSemanticClassification, true);
}

{
  const executionDecision = selectRoute('build me a recipe app');
  const previewDecision = selectRoute('preview build me a recipe app');
  assert.equal(previewDecision.mode, 'preview');
  assert.equal(previewDecision.suggestedRoute, executionDecision.suggestedRoute);
  assert.deepEqual(
    previewDecision.candidates.map((item) => item.route),
    executionDecision.candidates.map((item) => item.route),
  );
  assert.equal(previewDecision.command, null);
  assert(previewDecision.candidates.some((item) => item.route === '/create-app'));
}

{
  const build = buildPreview('build', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: false,
  });
  assert.equal(build.final, false);
  assert.equal(build.command, null);
  assert.equal(build.canRunNow, false);
  assert.equal(build.boundary, 'semantic-classification-required');

  const typecheck = buildPreview('typecheck', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: false,
  });
  assert.equal(typecheck.final, false);
  assert.equal(typecheck.command, null);

  const test = buildPreview('test', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: false,
  });
  assert.equal(test.final, true);
  assert.equal(test.command, 'npm run test');

  const capableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-route-capability-'));
  fs.writeFileSync(path.join(capableRoot, 'package.json'), JSON.stringify({
    scripts: { build: 'node build.js', typecheck: 'tsc --noEmit', test: 'node test.js' },
  }));
  for (const command of ['build', 'typecheck', 'test']) {
    const preview = buildPreview(command, { projectRoot: capableRoot, gitDirty: false });
    assert.equal(preview.final, true);
    assert.equal(preview.command, `npm run ${command}`);
    assert.equal(preview.capability.verified, true);
  }
}

{
  assert.throws(
    () => selectRoute('generate tests', { routeOverride: '/not-a-real-route' }),
    /unknown route override/i,
  );

  const preview = buildPreview('generate tests', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: false,
    routeOverride: '/fleet',
  });
  assert.equal(preview.resolver, 'override');
  assert.equal(preview.final, true);
  assert.equal(preview.selected, '/fleet --quick');
  assert.equal(preview.canRunNow, false);
  assert.equal(preview.boundary, 'product-bundle-activation');
}

{
  const rendered = render(buildPreview('review auth module', {
    projectRoot: path.resolve(__dirname, '..'),
    gitDirty: false,
    now: '2026-06-05T12:00:00.000Z',
  }));
  assert(rendered.includes('Routing Preview'));
  assert(rendered.includes('Suggested route: /review'));
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
  assert.equal(payload.selected, null);
  assert.equal(payload.suggestedRoute, '/review');
  assert.equal(payload.input, 'review auth module');
}

{
  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'route-preview.js'),
    '--json',
    '--route',
    '/test-gen',
    '--',
    'generate tests',
  ], { encoding: 'utf8' });
  const payload = JSON.parse(output);
  assert.equal(payload.resolver, 'override');
  assert.equal(payload.selected, '/test-gen');
  assert.equal(payload.requiresSemanticClassification, false);

  const invalid = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, 'route-preview.js'),
    '--json',
    '--route',
    '/not-a-route',
    '--',
    'generate tests',
  ], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /unknown route override/i);
}

console.log('route preview tests passed');

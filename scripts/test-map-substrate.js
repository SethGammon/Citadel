#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createMapSlice,
  defaultOutputPath,
  detectMapStaleness,
  generateMapIndex,
  loadMapIndex,
  mapStats,
  queryMapIndex,
  writeMapIndex,
} = require('../core/map');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function runCli(rootDir, args) {
  return childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'map-index.js'),
    ...args,
  ], {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-map-test-'));
  writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node test.js',
      typecheck: 'tsc --noEmit',
      start: 'vite',
    },
  }, null, 2));
  writeFile(path.join(root, 'src', 'routes.tsx'), `
    export const routes = [{ path: '/dashboard' }, { path: '/campaigns/:id' }];
    export function CampaignRoute() { return null; }
  `);
  writeFile(path.join(root, 'src', 'fleet', 'steward.ts'), `
    import { routes } from '../routes';
    export class FleetSteward {}
    const internalSymbol = routes;
  `);
  writeFile(path.join(root, 'scripts', 'verify.js'), `
    module.exports = function verify() { return true; };
  `);

  const output = defaultOutputPath(root);
  const index = generateMapIndex(root);
  writeMapIndex(index, output);

  assert.strictEqual(index.version, 2);
  assert.ok(index.fileCount >= 3, 'expected generated source file records');
  assert.ok(index.sourceSignature, 'expected source signature');
  assert.ok(index.files['src/fleet/steward.ts'].hash, 'expected per-file hash');
  assert.ok(index.routes.some((route) => route.path === '/dashboard'), 'expected extracted route');
  assert.ok(index.verificationCommands.includes('npm run test'), 'expected test script command');
  assert.ok(index.verificationCommands.includes('npm run typecheck'), 'expected typecheck command');

  const results = queryMapIndex(index, 'fleet steward', 5);
  assert.strictEqual(results[0].relPath, 'src/fleet/steward.ts');

  const slice = createMapSlice(index, 'campaign route', { maxFiles: 5 });
  assert.ok(slice.includes('=== MAP SLICE: campaign route ==='));
  assert.ok(slice.includes('Verification: npm run test | npm run typecheck'));
  assert.ok(slice.includes('src/routes.tsx'));

  const stats = mapStats(index);
  assert.ok(stats.verificationCommands >= 2);
  assert.ok(stats.routes >= 2);

  let stale = detectMapStaleness(root, loadMapIndex(output));
  assert.strictEqual(stale.stale, false);

  writeFile(path.join(root, 'src', 'fleet', 'steward.ts'), `
    import { routes } from '../routes';
    export class FleetSteward {}
    export function mergeQueue() { return routes; }
  `);
  stale = detectMapStaleness(root, loadMapIndex(output));
  assert.strictEqual(stale.stale, true);
  assert.deepStrictEqual(stale.changed, ['src/fleet/steward.ts']);

  const generateOutput = runCli(root, ['--generate', '--force']);
  assert.ok(generateOutput.includes('verification commands'));

  const queryOutput = runCli(root, ['--query', 'mergeQueue']);
  assert.ok(queryOutput.includes('src/fleet/steward.ts'));

  const sliceOutput = runCli(root, ['--slice', 'dashboard']);
  assert.ok(sliceOutput.includes('=== MAP SLICE: dashboard ==='));

  const staleOutput = runCli(root, ['--stale']);
  assert.ok(staleOutput.includes('Map index is current.'));

  writeFile(path.join(root, 'src', 'new-route.ts'), 'export const path = "/new";\n');
  let staleFailed = false;
  try {
    runCli(root, ['--stale']);
  } catch (err) {
    staleFailed = true;
    assert.strictEqual(err.status, 2);
    assert.ok(String(err.stdout).includes('Map index is stale.'));
    assert.ok(String(err.stdout).includes('src/new-route.ts'));
  }
  assert.strictEqual(staleFailed, true, 'expected stale CLI to exit 2');

  console.log('map substrate tests passed');
}

main();

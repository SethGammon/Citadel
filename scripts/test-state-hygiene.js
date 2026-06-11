#!/usr/bin/env node

/**
 * test-state-hygiene.js -- Tests for scripts/state-hygiene.js
 *
 * Builds a temp plugin-data + .planning fixture containing:
 *   - fresh and expired session-allow consent markers
 *   - fresh and expired one-time approval tokens
 *   - fresh and stale *.lock directories (including a nested one)
 *   - decoys that must never be touched: a regular session-end.lock FILE,
 *     non-marker json, wrong-extension files, and a symlinked .lock entry
 *
 * Asserts:
 *   1. cleanState removes exactly the expired/stale set and counts match
 *   2. dry-run removes nothing but reports the same counts
 *   3. a removal failure mid-sweep does not abort the sweep
 *   4. the CLI entry point works against the fixture via env overrides
 *
 * Run: node scripts/test-state-hygiene.js
 * Exit codes: 0 = all pass, 1 = failures
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { cleanState } = require('./state-hygiene');

const SCRIPT_PATH = path.join(__dirname, 'state-hygiene.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed++;
    const msg = err.message || String(err);
    failures.push({ name, msg });
    console.log(`  FAIL ${name}\n       ${msg}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// -- Fixture builder ------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function writeMarker(filePath, ageMs) {
  const timestamp = new Date(Date.now() - ageMs).toISOString();
  fs.writeFileSync(filePath, JSON.stringify({ category: 'test', timestamp }));
}

function makeLockdir(dirPath, ageMs) {
  fs.mkdirSync(dirPath, { recursive: true });
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(dirPath, t, t);
}

/**
 * Build a complete fixture. Returns paths to everything created.
 */
function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-hygiene-'));
  const pluginDataDir = path.join(root, 'plugin-data');
  const planningDir = path.join(root, '.planning');
  fs.mkdirSync(pluginDataDir, { recursive: true });
  fs.mkdirSync(path.join(planningDir, 'telemetry'), { recursive: true });

  const fx = { root, pluginDataDir, planningDir };

  // Consent markers: one fresh, one expired (6h TTL)
  fx.sessionFresh = path.join(pluginDataDir, 'consent-session-externalActions.json');
  fx.sessionExpired = path.join(pluginDataDir, 'consent-session-daemonSpend.json');
  writeMarker(fx.sessionFresh, 1 * HOUR);
  writeMarker(fx.sessionExpired, 7 * HOUR);

  // One-time tokens: one fresh, one expired (120s TTL)
  fx.onetimeFresh = path.join(pluginDataDir, 'consent-onetime-fleetSpawn.json');
  fx.onetimeExpired = path.join(pluginDataDir, 'consent-onetime-externalActions.json');
  writeMarker(fx.onetimeFresh, 30 * 1000);
  writeMarker(fx.onetimeExpired, 5 * MINUTE);

  // Decoys in plugin data dir: must never be touched
  fx.decoyConfig = path.join(pluginDataDir, 'harness.json');
  fs.writeFileSync(fx.decoyConfig, '{}');
  fx.decoyWrongExt = path.join(pluginDataDir, 'consent-session-externalActions.txt');
  fs.writeFileSync(fx.decoyWrongExt, 'not a marker');

  // Lockdirs: stale top-level, stale nested, fresh top-level (10 min cutoff)
  fx.lockStale = path.join(planningDir, 'watch-state.json.lock');
  fx.lockStaleNested = path.join(planningDir, 'telemetry', 'some-state.json.lock');
  fx.lockFresh = path.join(planningDir, 'fresh-state.json.lock');
  makeLockdir(fx.lockStale, 30 * MINUTE);
  makeLockdir(fx.lockStaleNested, 30 * MINUTE);
  makeLockdir(fx.lockFresh, 0);

  // Decoy: session-end.lock is a regular FILE (idempotency marker written by
  // hooks_src/session-end.js). Stale mtime, but files are never removed.
  fx.lockFileDecoy = path.join(planningDir, 'telemetry', 'session-end.lock');
  fs.writeFileSync(fx.lockFileDecoy, 'session-id-123');
  const old = (Date.now() - 2 * HOUR) / 1000;
  fs.utimesSync(fx.lockFileDecoy, old, old);

  // Decoy: symlinked .lock entry must be skipped, never followed or deleted.
  // Junction type works on Windows without elevation. Best effort.
  fx.symlinkTarget = path.join(root, 'symlink-target');
  fx.lockSymlink = path.join(planningDir, 'evil.lock');
  fx.hasSymlink = false;
  try {
    makeLockdir(fx.symlinkTarget, 30 * MINUTE);
    fs.symlinkSync(fx.symlinkTarget, fx.lockSymlink, 'junction');
    fx.hasSymlink = true;
  } catch { /* symlink unsupported on this system, sub-asserts skipped */ }

  return fx;
}

function destroyFixture(fx) {
  try { fs.rmSync(fx.root, { recursive: true, force: true }); } catch { /* best effort */ }
}

const EXPECTED_REMOVALS = 4; // 1 session marker + 1 token + 2 lockdirs

// -- Tests -----------------------------------------------------------------------

function main() {
  console.log('\nState Hygiene Test Suite\n' + '='.repeat(40));

  // 1. Dry-run: reports the right counts, removes nothing
  console.log('\n> Dry-run');
  {
    const fx = buildFixture();
    const result = cleanState({ dryRun: true, pluginDataDir: fx.pluginDataDir, planningDir: fx.planningDir });

    test('dry-run reports 1 expired session marker', () => {
      assert(result.sessionMarkers === 1, `expected 1, got ${result.sessionMarkers}`);
    });
    test('dry-run reports 1 expired one-time token', () => {
      assert(result.onetimeTokens === 1, `expected 1, got ${result.onetimeTokens}`);
    });
    test('dry-run reports 2 stale lockdirs', () => {
      assert(result.lockdirs === 2, `expected 2, got ${result.lockdirs}`);
    });
    test('dry-run reports no errors', () => {
      assert(result.errors === 0, `expected 0 errors, got ${result.errors}`);
    });
    test('dry-run removes nothing', () => {
      const all = [
        fx.sessionFresh, fx.sessionExpired, fx.onetimeFresh, fx.onetimeExpired,
        fx.decoyConfig, fx.decoyWrongExt, fx.lockStale, fx.lockStaleNested,
        fx.lockFresh, fx.lockFileDecoy,
      ];
      for (const p of all) {
        assert(fs.existsSync(p), `dry-run deleted ${p}`);
      }
    });

    destroyFixture(fx);
  }

  // 2. Real run: removes exactly the expired/stale set
  console.log('\n> Real sweep');
  {
    const fx = buildFixture();
    const result = cleanState({ pluginDataDir: fx.pluginDataDir, planningDir: fx.planningDir });

    test('counts match the expired/stale set', () => {
      assert(result.sessionMarkers === 1, `sessionMarkers: expected 1, got ${result.sessionMarkers}`);
      assert(result.onetimeTokens === 1, `onetimeTokens: expected 1, got ${result.onetimeTokens}`);
      assert(result.lockdirs === 2, `lockdirs: expected 2, got ${result.lockdirs}`);
      assert(result.errors === 0, `errors: expected 0, got ${result.errors}`);
      assert(result.removed.length === EXPECTED_REMOVALS,
        `removed list: expected ${EXPECTED_REMOVALS}, got ${result.removed.length}`);
    });
    test('expired session marker removed', () => assert(!fs.existsSync(fx.sessionExpired), 'still exists'));
    test('expired one-time token removed', () => assert(!fs.existsSync(fx.onetimeExpired), 'still exists'));
    test('stale top-level lockdir removed', () => assert(!fs.existsSync(fx.lockStale), 'still exists'));
    test('stale nested lockdir removed', () => assert(!fs.existsSync(fx.lockStaleNested), 'still exists'));
    test('fresh session marker untouched', () => assert(fs.existsSync(fx.sessionFresh), 'was deleted'));
    test('fresh one-time token untouched', () => assert(fs.existsSync(fx.onetimeFresh), 'was deleted'));
    test('fresh lockdir untouched', () => assert(fs.existsSync(fx.lockFresh), 'was deleted'));
    test('regular session-end.lock FILE untouched', () => assert(fs.existsSync(fx.lockFileDecoy), 'was deleted'));
    test('non-marker json untouched', () => assert(fs.existsSync(fx.decoyConfig), 'was deleted'));
    test('wrong-extension decoy untouched', () => assert(fs.existsSync(fx.decoyWrongExt), 'was deleted'));
    if (fx.hasSymlink) {
      test('symlinked .lock entry untouched', () => assert(fs.existsSync(fx.lockSymlink), 'was deleted'));
      test('symlink target untouched', () => assert(fs.existsSync(fx.symlinkTarget), 'was deleted'));
    }

    destroyFixture(fx);
  }

  // 3. A removal failure mid-sweep does not abort the sweep
  console.log('\n> Failure isolation');
  {
    const fx = buildFixture();
    const realUnlink = fs.unlinkSync;
    fs.unlinkSync = function (target) {
      if (path.resolve(String(target)) === path.resolve(fx.sessionExpired)) {
        throw new Error('EBUSY: simulated locked file');
      }
      return realUnlink.apply(fs, arguments);
    };

    let result;
    try {
      result = cleanState({ pluginDataDir: fx.pluginDataDir, planningDir: fx.planningDir });
    } finally {
      fs.unlinkSync = realUnlink;
    }

    test('sweep does not throw on a locked file', () => {
      assert(result && typeof result === 'object', 'cleanState did not return a result');
    });
    test('failure is counted, not fatal', () => {
      assert(result.errors === 1, `expected 1 error, got ${result.errors}`);
      assert(result.failed.length === 1, `expected 1 failed entry, got ${result.failed.length}`);
      assert(result.sessionMarkers === 0, `failed removal must not be counted, got ${result.sessionMarkers}`);
    });
    test('locked file survives, rest of sweep completes', () => {
      assert(fs.existsSync(fx.sessionExpired), 'locked marker should still exist');
      assert(!fs.existsSync(fx.onetimeExpired), 'token should still be removed');
      assert(!fs.existsSync(fx.lockStale), 'stale lockdir should still be removed');
      assert(!fs.existsSync(fx.lockStaleNested), 'nested stale lockdir should still be removed');
      assert(result.onetimeTokens === 1 && result.lockdirs === 2, 'later sweep phases must still run');
    });

    destroyFixture(fx);
  }

  // 4. CLI entry point with env overrides
  console.log('\n> CLI');
  {
    const fx = buildFixture();
    const env = {
      ...process.env,
      CLAUDE_PROJECT_DIR: fx.root,
      CLAUDE_PLUGIN_DATA: fx.pluginDataDir,
    };

    test('CLI dry-run reports counts as JSON and deletes nothing', () => {
      const r = spawnSync(process.execPath, [SCRIPT_PATH, '--dry-run', '--json'], { env, encoding: 'utf8' });
      assert(r.status === 0, `exit ${r.status}, stderr: ${r.stderr}`);
      const parsed = JSON.parse(r.stdout);
      assert(parsed.dryRun === true, 'dryRun flag not set in output');
      assert(parsed.sessionMarkers === 1 && parsed.onetimeTokens === 1 && parsed.lockdirs === 2,
        `unexpected counts: ${r.stdout}`);
      assert(fs.existsSync(fx.sessionExpired), 'CLI dry-run deleted a marker');
      assert(fs.existsSync(fx.lockStale), 'CLI dry-run deleted a lockdir');
    });

    test('CLI real run removes the expired/stale set', () => {
      const r = spawnSync(process.execPath, [SCRIPT_PATH, '--json'], { env, encoding: 'utf8' });
      assert(r.status === 0, `exit ${r.status}, stderr: ${r.stderr}`);
      const parsed = JSON.parse(r.stdout);
      assert(parsed.sessionMarkers === 1 && parsed.onetimeTokens === 1 && parsed.lockdirs === 2,
        `unexpected counts: ${r.stdout}`);
      assert(!fs.existsSync(fx.sessionExpired), 'expired marker survived CLI run');
      assert(fs.existsSync(fx.sessionFresh), 'fresh marker deleted by CLI run');
      assert(fs.existsSync(fx.lockFileDecoy), 'session-end.lock file deleted by CLI run');
    });

    destroyFixture(fx);
  }

  // -- Summary --
  console.log('\n' + '='.repeat(40));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.msg}`);
    process.exit(1);
  }
  process.exit(0);
}

main();

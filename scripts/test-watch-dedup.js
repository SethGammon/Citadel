#!/usr/bin/env node

/**
 * test-watch-dedup.js -- Offline tests for watch.js intake dedup and locking.
 *
 * Builds a throwaway git repo in the OS temp dir, plants a @citadel marker,
 * and verifies:
 *   (a) two sequential --scan --intake runs produce exactly one intake item
 *   (b) the dedup survives the marker shifting lines
 *   (c) two concurrent scans produce one intake item and valid state JSON
 *   (d) the state lockdir is released afterward
 *
 * Stdlib only. No network, no LLM.
 *
 * Usage: node scripts/test-watch-dedup.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const WATCH_SCRIPT = path.join(__dirname, 'watch.js');

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

function git(repo, args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function runScanSync(repo) {
  return execFileSync(process.execPath, [WATCH_SCRIPT, '--scan', '--intake'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
}

function spawnScan(repo) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [WATCH_SCRIPT, '--scan', '--intake'], {
      cwd: repo,
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('close', (code) => resolve({ code, out, err }));
  });
}

function intakeFiles(repo) {
  const dir = path.join(repo, '.planning', 'intake');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

async function main() {
  console.log('[test-watch-dedup] watch.js intake dedup and locking');

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-dedup-'));
  try {
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.name', 'Watch Test']);
    git(repo, ['config', 'user.email', 'watch-test@example.com']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# test repo\n', 'utf8');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-q', '-m', 'init']);

    // Marker file stays untracked so every scan re-includes it, which is
    // exactly the flood path dedup must defuse.
    const srcPath = path.join(repo, 'app.js');
    fs.writeFileSync(
      srcPath,
      'const x = 1;\n// @citadel: todo tighten validation here\nconsole.log(x);\n',
      'utf8'
    );

    const statePath = path.join(repo, '.planning', 'watch-state.json');

    // (a) Two sequential scans with intake enabled
    runScanSync(repo);
    let items = intakeFiles(repo);
    check('first scan creates exactly one intake item', items.length === 1, `found ${items.length}`);

    const intakeContent = items.length === 1
      ? fs.readFileSync(path.join(repo, '.planning', 'intake', items[0]), 'utf8')
      : '';
    check(
      'intake frontmatter records a 16-char marker_hash',
      /^marker_hash: [0-9a-f]{16}$/m.test(intakeContent)
    );

    runScanSync(repo);
    items = intakeFiles(repo);
    check('second scan does not duplicate the intake item', items.length === 1, `found ${items.length}`);

    const stateAfterA = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const processedKeys = Object.keys(stateAfterA.processedMarkers || {});
    check(
      'processedMarkers holds one entry keyed by 16-char hash',
      processedKeys.length === 1 && /^[0-9a-f]{16}$/.test(processedKeys[0]),
      `keys: ${JSON.stringify(processedKeys)}`
    );
    const pendingKeys = Object.keys(stateAfterA.pendingActions || {});
    check(
      'pendingActions keyed by the same hash',
      pendingKeys.length === 1 && pendingKeys[0] === processedKeys[0],
      `keys: ${JSON.stringify(pendingKeys)}`
    );

    // (b) Insert 3 lines above the marker, rescan
    const shifted = '// pad one\n// pad two\n// pad three\n' + fs.readFileSync(srcPath, 'utf8');
    fs.writeFileSync(srcPath, shifted, 'utf8');
    runScanSync(repo);
    items = intakeFiles(repo);
    check('line shift does not duplicate the intake item', items.length === 1, `found ${items.length}`);

    // (c) Concurrent scans against fresh state
    fs.rmSync(path.join(repo, '.planning'), { recursive: true, force: true });
    const [a, b] = await Promise.all([spawnScan(repo), spawnScan(repo)]);
    check(
      'both concurrent scans exit cleanly',
      a.code === 0 && b.code === 0,
      `codes ${a.code}/${b.code}; stderr: ${(a.err + b.err).trim()}`
    );
    items = intakeFiles(repo);
    check('concurrent scans create exactly one intake item', items.length === 1, `found ${items.length}`);

    let stateOk = false;
    try {
      JSON.parse(fs.readFileSync(statePath, 'utf8'));
      stateOk = true;
    } catch {}
    check('watch-state.json parses cleanly after concurrent scans', stateOk);

    // (d) Lockdir released
    check('lockdir is released after all scans', !fs.existsSync(statePath + '.lock'));
  } finally {
    try {
      fs.rmSync(repo, { recursive: true, force: true });
    } catch {
      // Windows can hold transient handles on temp dirs; leftover temp data is harmless.
    }
  }

  if (failures > 0) {
    console.error(`\n[test-watch-dedup] ${failures} failure(s).`);
    process.exit(1);
  }
  console.log('\n[test-watch-dedup] All checks passed.');
}

main().catch((err) => {
  console.error(`[test-watch-dedup] Unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});

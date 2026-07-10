#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildMatrix,
  median,
  mergeMatrices,
  normalizeResult,
  percentile,
} = require('../core/golden-path/matrix');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(__dirname, 'golden-path-matrix.js');
const PLATFORMS = ['win32', 'linux', 'darwin'];
const RUNTIMES = ['claude', 'codex'];

function rawResult(overrides = {}) {
  const passed = overrides.status !== 'failed';
  return {
    schema: 1,
    mode: 'fixture-automation',
    runtime: 'claude',
    fixture_id: 'fixture-a',
    platform: 'win32',
    status: passed ? 'passed' : 'failed',
    failure: passed ? null : { code: 'VERIFY_FAILED', recovery: 'Inspect fixture verification.' },
    steps: ['install', 'setup', 'verified-handoff'].map((id) => ({
      id,
      status: passed ? 'passed' : (id === 'verified-handoff' ? 'failed' : 'passed'),
      duration_ms: 1,
      evidence: [],
    })),
    metrics: { install_to_route_ms: 100, install_to_verified_handoff_ms: 200, total_ms: 300 },
    artifacts: {},
    resume: { status: passed ? 'passed' : 'failed', command: '/archon continue' },
    rollback: { status: 'exact', before_digest: 'same', after_digest: 'same', workspace_removed: true },
    limitations: ['Synthetic schema fixture used only by the unit test.'],
    ...overrides,
  };
}

function run(platform, runtime, index, overrides = {}) {
  const raw = rawResult({ platform, runtime, ...overrides });
  return normalizeResult(raw, { runId: `${platform}-${runtime}-${index}` });
}

function completeRuns(overrides = {}) {
  const runs = [];
  for (const platform of PLATFORMS) {
    for (const runtime of RUNTIMES) {
      for (let index = 0; index < 5; index += 1) runs.push(run(platform, runtime, index, overrides));
    }
  }
  return runs;
}

function matrix(runs, fixtureId = 'fixture-a') {
  return buildMatrix({ fixtureId, runs, sources: ['synthetic-test'], generatedAt: '2026-01-01T00:00:00.000Z' });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function invoke(args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
}

function main() {
  assert.strictEqual(median([9, 1, 5, 3]), 4);
  assert.strictEqual(median([9, 1, 5]), 5);
  assert.strictEqual(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);

  const complete = matrix(completeRuns());
  assert.strictEqual(complete.runs.length, 30);
  assert.strictEqual(complete.summary.complete_grid, true);
  assert.strictEqual(complete.status, 'passed');
  assert.strictEqual(Object.keys(complete.cells).length, 6);
  for (const cell of Object.values(complete.cells)) {
    assert.strictEqual(cell.total, 5);
    assert.strictEqual(cell.successes, 5);
    assert.strictEqual(cell.success_rate, 1);
  }

  const failedRuns = completeRuns();
  failedRuns[0] = run('win32', 'claude', 0, {
    status: 'failed',
    metrics: { install_to_route_ms: null, install_to_verified_handoff_ms: null, total_ms: 50 },
  });
  failedRuns[1] = run('win32', 'claude', 1, { status: 'failed' });
  const failed = matrix(failedRuns);
  assert.strictEqual(failed.runs.length, 30, 'failed runs must be retained');
  assert.strictEqual(failed.cells['win32/claude'].total, 5);
  assert.strictEqual(failed.cells['win32/claude'].successes, 3);
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.failure.code, 'MATRIX_GATES_FAILED');
  assert.strictEqual(failed.summary.gates.install_setup_success.passed, false);
  assert.strictEqual(failed.runs[0].metrics.install_to_route_ms, null, 'unavailable failed timing stays null');
  assert.notStrictEqual(failed.summary.median_install_to_route_ms, 0, 'unavailable failed timing must not lower the median');

  const slow = matrix(completeRuns({
    metrics: { install_to_route_ms: 600000, install_to_verified_handoff_ms: 900000, total_ms: 900000 },
  }));
  assert.strictEqual(slow.summary.gates.route_median_ms.passed, false, 'threshold is strictly less than');
  assert.strictEqual(slow.summary.gates.handoff_p90_ms.passed, false, 'threshold is strictly less than');

  assert.throws(() => buildMatrix({
    fixtureId: 'fixture-a',
    runs: [run('win32', 'claude', 0), run('win32', 'claude', 0)],
  }), /Duplicate run_id/);
  const mixedFixtureRun = run('win32', 'claude', 99);
  mixedFixtureRun.fixture_id = 'fixture-b';
  assert.throws(() => matrix([mixedFixtureRun]), /fixture_id does not match/);
  assert.throws(() => mergeMatrices([matrix([run('win32', 'claude', 0)]), matrix([], 'fixture-b')]), /different fixture_id/);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-matrix-test-'));
  try {
    const platformFiles = [];
    for (const platform of PLATFORMS) {
      const file = path.join(temp, `${platform}.json`);
      writeJson(file, matrix(completeRuns().filter((item) => item.platform === platform)));
      platformFiles.push(file);
    }
    const output = path.join(temp, 'complete.json');
    const merged = invoke(['--merge', platformFiles.join(','), '--output', output, '--require-complete']);
    assert.strictEqual(merged.status, 0, merged.stderr);
    const mergedJson = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.strictEqual(mergedJson.status, 'passed');
    assert.strictEqual(mergedJson.summary.total_runs, 30);

    const incompleteOutput = path.join(temp, 'incomplete.json');
    const incomplete = invoke(['--merge', platformFiles[0], '--output', incompleteOutput, '--require-complete']);
    assert.notStrictEqual(incomplete.status, 0, 'require-complete must reject a missing grid');
    const incompleteJson = JSON.parse(fs.readFileSync(incompleteOutput, 'utf8'));
    assert.strictEqual(incompleteJson.failure.code, 'MATRIX_INCOMPLETE_GRID');
    assert.strictEqual(incompleteJson.runs.length, 10, 'rejection must preserve evidence');

    const duplicateOutput = path.join(temp, 'duplicate.json');
    const duplicate = invoke(['--merge', `${platformFiles[0]},${platformFiles[0]}`, '--output', duplicateOutput]);
    assert.notStrictEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /Duplicate run_id/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tests.yml'), 'utf8');
  for (const expected of [
    'golden-path-evidence:',
    'os: ubuntu-latest',
    'os: macos-latest',
    'os: windows-latest',
    '--runtime both --repeat 5',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    '--require-complete',
  ]) assert(workflow.includes(expected), `tests workflow must include ${expected}`);

  process.stdout.write('Golden-path matrix tests passed.\n');
}

main();

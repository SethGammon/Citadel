#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  API_VERSION,
  appendSnapshot,
  fetchCombinedResponse,
  normalizeSnapshot,
  parseRepository,
  redactSecrets,
} = require('../core/telemetry/github-traffic');

const raw = {
  repository: {
    full_name: 'SethGammon/Citadel',
    stargazers_count: 654,
    forks_count: 31,
    watchers_count: 654,
    subscribers_count: 19,
  },
  views: {
    count: 240,
    uniques: 112,
    views: [{ timestamp: '2026-07-09T00:00:00Z', count: 40, uniques: 22 }],
  },
  clones: {
    count: 80,
    uniques: 33,
    clones: [{ timestamp: '2026-07-09T00:00:00Z', count: 12, uniques: 7 }],
  },
  referrers: [{ referrer: 'github.com', count: 70, uniques: 40 }],
  popular_paths: [{ path: '/SethGammon/Citadel', title: 'Citadel', count: 99, uniques: 55 }],
  recent_events: [{
    type: 'WatchEvent',
    created_at: '2026-07-10T12:00:00Z',
    actor: { login: 'must-not-survive' },
    repo: { name: 'SethGammon/Citadel' },
    payload: { action: 'started' },
  }],
};

async function run() {
  assert.deepEqual(parseRepository('SethGammon/Citadel'), {
    owner: 'SethGammon', repo: 'Citadel', fullName: 'SethGammon/Citadel',
  });
  for (const invalid of ['', 'Citadel', 'a/b/c', '-owner/repo', 'owner/.']) {
    assert.throws(() => parseRepository(invalid), /Repository/);
  }

  const snapshot = normalizeSnapshot(raw, 'SethGammon/Citadel', '2026-07-10T15:30:00-04:00');
  assert.equal(snapshot.schema, 1);
  assert.equal(snapshot.captured_at, '2026-07-10T19:30:00.000Z');
  assert.equal(snapshot.repository, 'SethGammon/Citadel');
  assert.equal(snapshot.stars, 654);
  assert.equal(snapshot.forks, 31);
  assert.equal(snapshot.watchers, 19, 'watchers must use subscribers_count, not watchers_count');
  assert.deepEqual(snapshot.views, {
    count: 240,
    uniques: 112,
    views: [{ timestamp: '2026-07-09T00:00:00.000Z', count: 40, uniques: 22 }],
  });
  assert.deepEqual(snapshot.clones, {
    count: 80,
    uniques: 33,
    clones: [{ timestamp: '2026-07-09T00:00:00.000Z', count: 12, uniques: 7 }],
  });
  assert.deepEqual(snapshot.recent_events, [{ type: 'WatchEvent', created_at: '2026-07-10T12:00:00.000Z' }]);
  assert(!JSON.stringify(snapshot).includes('must-not-survive'));

  const calls = [];
  const responses = new Map([
    ['/repos/SethGammon/Citadel', raw.repository],
    ['/repos/SethGammon/Citadel/traffic/views', raw.views],
    ['/repos/SethGammon/Citadel/traffic/clones', raw.clones],
    ['/repos/SethGammon/Citadel/traffic/popular/referrers', raw.referrers],
    ['/repos/SethGammon/Citadel/traffic/popular/paths', raw.popular_paths],
    ['/repos/SethGammon/Citadel/events?per_page=100', raw.recent_events],
  ]);
  const token = 'ghp_test_secret_never_persist';
  const combined = await fetchCombinedResponse('SethGammon/Citadel', {
    token,
    requestFn: async request => {
      calls.push(request);
      return responses.get(request.path);
    },
  });
  assert.deepEqual(combined.repository, raw.repository);
  assert.deepEqual(calls.map(call => call.path).sort(), [...responses.keys()].sort());
  for (const call of calls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.headers.Accept, 'application/vnd.github+json');
    assert.equal(call.headers.Authorization, `Bearer ${token}`);
    assert.equal(call.headers['X-GitHub-Api-Version'], API_VERSION);
    assert(call.headers['User-Agent'].includes('Citadel'));
  }
  await assert.rejects(
    fetchCombinedResponse('SethGammon/Citadel', { token, requestFn: async () => { throw new Error(`denied ${token}`); } }),
    error => !error.message.includes(token) && error.message.includes('[REDACTED]'),
  );
  const savedGhToken = process.env.GH_TOKEN;
  const savedGitHubToken = process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  await assert.rejects(fetchCombinedResponse('SethGammon/Citadel'), /requires GH_TOKEN or GITHUB_TOKEN.*write access/);
  assert.equal(
    redactSecrets('requires GH_TOKEN or GITHUB_TOKEN with repository write access'),
    'requires GH_TOKEN or GITHUB_TOKEN with repository write access',
    'credential labels must not corrupt ordinary diagnostics',
  );
  if (savedGhToken !== undefined) process.env.GH_TOKEN = savedGhToken;
  if (savedGitHubToken !== undefined) process.env.GITHUB_TOKEN = savedGitHubToken;

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-github-traffic-'));
  try {
    const first = appendSnapshot(snapshot, temp);
    assert.equal(first.history.snapshots.length, 1);
    const secondSnapshot = normalizeSnapshot(raw, 'SethGammon/Citadel', '2026-07-10T20:00:00Z');
    const second = appendSnapshot(secondSnapshot, temp);
    assert.equal(second.filePath, first.filePath);
    assert.equal(second.history.snapshots.length, 2, 'same-day captures must append');
    assert.equal(JSON.parse(fs.readFileSync(first.filePath, 'utf8')).snapshots.length, 2);
    assert(!fs.readFileSync(first.filePath, 'utf8').includes(token));

    const nextDay = appendSnapshot(normalizeSnapshot(raw, 'SethGammon/Citadel', '2026-07-11T00:00:00Z'), temp);
    assert.notEqual(nextDay.filePath, first.filePath);
    assert(fs.existsSync(nextDay.filePath));

    const fixture = path.join(temp, 'combined.json');
    fs.writeFileSync(fixture, JSON.stringify(raw), 'utf8');
    const cliRoot = path.join(temp, 'fixture-mode');
    const cli = JSON.parse(execFileSync(process.execPath, [
      path.resolve(__dirname, 'github-traffic-snapshot.js'),
      '--repo', 'SethGammon/Citadel',
      '--fixture', fixture,
      '--output-root', cliRoot,
      '--captured-at', '2026-07-12T05:00:00Z',
      '--json',
    ], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } }));
    assert.equal(cli.snapshot_count, 1);
    assert.equal(cli.snapshot.captured_at, '2026-07-12T05:00:00.000Z');
    assert(fs.existsSync(path.join(cliRoot, '.planning', 'acquisition', '2026-07-12.json')));

    const corruptRoot = path.join(temp, 'corrupt');
    const corruptDir = path.join(corruptRoot, '.planning', 'acquisition');
    fs.mkdirSync(corruptDir, { recursive: true });
    fs.writeFileSync(path.join(corruptDir, '2026-07-10.json'), '{broken', 'utf8');
    assert.throws(() => appendSnapshot(snapshot, corruptRoot), /history is corrupt/);

    const mismatchRoot = path.join(temp, 'mismatch');
    const mismatchDir = path.join(mismatchRoot, '.planning', 'acquisition');
    fs.mkdirSync(mismatchDir, { recursive: true });
    fs.writeFileSync(path.join(mismatchDir, '2026-07-10.json'), JSON.stringify({
      schema: 1, date: '2026-07-10', repository: 'Other/Repo', snapshots: [],
    }), 'utf8');
    assert.throws(() => appendSnapshot(snapshot, mismatchRoot), /history mismatch/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().then(() => console.log('GitHub traffic snapshot tests passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

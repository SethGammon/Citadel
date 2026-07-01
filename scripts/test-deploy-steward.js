#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  acquireLease,
  parseGitHubPr,
  readQueue,
  releaseLease,
  runDeploySteward,
  scanReadinessCandidates,
} = require('../core/deploy-steward/steward');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function tempProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `citadel-deploy-steward-${name}-`));
  fs.mkdirSync(path.join(dir, '.planning', 'pr-readiness'), { recursive: true });
  return dir;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readinessReport({
  status = 'ready',
  branch = 'codex/feature-a',
  pr = 'https://github.com/acme/app/pull/12',
  head = 'abc1234',
  verification = 'pass',
  generatedAt = '2026-06-20T00:00:00.000Z',
} = {}) {
  return [
    'Citadel PR Readiness',
    '='.repeat(40),
    `Generated: ${generatedAt}`,
    `Status: ${status}`,
    `PR: ${pr}`,
    `Branch: ${branch}`,
    `Head: ${head}`,
    '',
    '| Gate | Status | Detail |',
    '|---|---|---|',
    '| Pull request URL | pass | present |',
    '| Git worktree | pass | clean |',
    '| Dashboard repairs | pass | none |',
    `| Verification | ${verification} | npm test |`,
    '',
  ].join('\n');
}

function fakeProvider(refreshes, calls = {}) {
  return {
    calls,
    refresh(item) {
      calls.refresh = [...(calls.refresh || []), item.id];
      const detail = typeof refreshes === 'function' ? refreshes(item) : refreshes[item.id];
      if (detail instanceof Error) throw detail;
      assert(detail, `missing fake refresh detail for ${item.id}`);
      return detail;
    },
    updateBranch(item) {
      calls.updateBranch = [...(calls.updateBranch || []), item.id];
    },
    merge(item) {
      calls.merge = [...(calls.merge || []), item.id];
    },
    enqueueMergeQueue(item) {
      calls.enqueueMergeQueue = [...(calls.enqueueMergeQueue || []), item.id];
    },
    deploy(item) {
      calls.deploy = [...(calls.deploy || []), item.id];
    },
  };
}

function passingPr(overrides = {}) {
  return {
    state: 'open',
    url: 'https://github.com/acme/app/pull/12',
    head: 'abc1234',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    checks: [{ name: 'ci', status: 'pass' }],
    ...overrides,
  };
}

function writeBermanReadinessReport(root, number, generatedAt) {
  writeFile(path.join(root, '.planning', 'pr-readiness', `agent-${String(number).padStart(2, '0')}.md`), readinessReport({
    branch: `agent/${number}`,
    pr: `https://github.com/acme/app/pull/${number}`,
    head: `agent-${number}-v0`,
    generatedAt,
  }));
}

function runTest(label, fn) {
  try {
    fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    console.error(`FAIL ${label}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

runTest('parseGitHubPr extracts owner/repo/number', () => {
  assert.deepEqual(parseGitHubPr('https://github.com/acme/app/pull/12?foo=bar'), {
    owner: 'acme',
    repo: 'app',
    number: 12,
    repoSlug: 'acme/app',
    url: 'https://github.com/acme/app/pull/12',
  });
  assert.equal(parseGitHubPr('not-a-url'), null);
});

runTest('scan queues ready and blocked readiness reports without duplicates', () => {
  const root = tempProject('scan');
  writeFile(path.join(root, '.planning', 'pr-readiness', 'ready.md'), readinessReport());
  writeFile(path.join(root, '.planning', 'pr-readiness', 'blocked.md'), readinessReport({
    status: 'blocked',
    branch: 'codex/feature-b',
    pr: 'https://github.com/acme/app/pull/13',
    head: 'def5678',
    verification: 'fail',
  }));

  const candidates = scanReadinessCandidates(root, '2026-06-20T00:00:00.000Z');
  assert.equal(candidates.length, 2);
  assert.equal(candidates.find((item) => item.branch === 'codex/feature-a').status, 'ready');
  assert.equal(candidates.find((item) => item.branch === 'codex/feature-b').status, 'blocked');

  runDeploySteward(root, { scan: true, write: true, now: '2026-06-20T00:00:00.000Z' });
  runDeploySteward(root, { scan: true, write: true, now: '2026-06-20T00:01:00.000Z' });
  assert.equal(readQueue(root).length, 2);
});

runTest('lease blocks concurrent steward runs and can be force-replaced', () => {
  const root = tempProject('lease');
  const first = acquireLease(root, {
    holder: 'first',
    now: '2026-06-20T00:00:00.000Z',
    ttlMs: 60 * 1000,
  });
  assert.throws(() => acquireLease(root, {
    holder: 'second',
    now: '2026-06-20T00:00:10.000Z',
    ttlMs: 60 * 1000,
  }), /lease is active/);
  const second = acquireLease(root, {
    holder: 'second',
    force: true,
    now: '2026-06-20T00:00:20.000Z',
    ttlMs: 60 * 1000,
  });
  assert.equal(second.holder, 'second');
  assert.equal(releaseLease(root, first), false);
  assert.equal(releaseLease(root, second), true);
});

runTest('passing PR is merged, deployed, marked landed, and reported', () => {
  const root = tempProject('happy');
  writeFile(path.join(root, '.planning', 'pr-readiness', 'ready.md'), readinessReport());
  const calls = {};
  const result = runDeploySteward(root, {
    scan: true,
    run: true,
    write: true,
    deployCommand: 'echo deployed',
    provider: fakeProvider({ 'pr-acme-app-12': passingPr() }, calls),
    now: '2026-06-20T00:00:00.000Z',
  });

  assert.deepEqual(calls.merge, ['pr-acme-app-12']);
  assert.deepEqual(calls.deploy, ['pr-acme-app-12']);
  assert.equal(readQueue(root)[0].status, 'landed');
  assert(fs.existsSync(path.join(root, '.planning', 'deploy-steward', 'runs', 'latest.md')));
  assert(result.events.some((event) => event.action === 'merged'));
});

runTest('behind branch is updated and run stops for fresh checks', () => {
  const root = tempProject('behind');
  writeFile(path.join(root, '.planning', 'pr-readiness', 'ready.md'), readinessReport());
  const calls = {};
  runDeploySteward(root, {
    scan: true,
    run: true,
    write: true,
    provider: fakeProvider({ 'pr-acme-app-12': passingPr({ behindBase: true }) }, calls),
    now: '2026-06-20T00:00:00.000Z',
  });

  const item = readQueue(root)[0];
  assert.deepEqual(calls.updateBranch, ['pr-acme-app-12']);
  assert.equal(item.status, 'queued');
  assert.match(item.blockedReason, /waiting for checks/);
  assert.equal(calls.merge, undefined);
});

runTest('failing checks create a repair intake task and block merge', () => {
  const root = tempProject('repair');
  writeFile(path.join(root, '.planning', 'pr-readiness', 'ready.md'), readinessReport());
  const calls = {};
  runDeploySteward(root, {
    scan: true,
    run: true,
    write: true,
    provider: fakeProvider({
      'pr-acme-app-12': passingPr({
        checks: [{ name: 'ci', status: 'fail' }],
      }),
    }, calls),
    now: '2026-06-20T00:00:00.000Z',
  });

  const item = readQueue(root)[0];
  assert.equal(item.status, 'repair-needed');
  assert.match(item.repairTask, /\.planning\/intake\/.*deploy-steward.*\.md/);
  assert(fs.existsSync(path.join(root, item.repairTask)));
  assert.equal(calls.merge, undefined);
});

runTest('Berman 15-agent deploy stampede is serialized without racing main', () => {
  const root = tempProject('berman-15-agents');
  const totalAgents = 15;
  const firstReadyAgents = 3;
  const prs = new Map();
  for (let number = 1; number <= totalAgents; number++) {
    prs.set(`pr-acme-app-${number}`, {
      number,
      url: `https://github.com/acme/app/pull/${number}`,
      branch: `agent/${number}`,
      baseVersion: 0,
      head: `agent-${number}-v0`,
      merged: false,
      pendingChecks: 0,
      updateCount: 0,
    });
  }

  for (let number = 1; number <= firstReadyAgents; number++) {
    writeBermanReadinessReport(root, number, `2026-06-20T00:00:0${number}.000Z`);
  }

  let cycle = 0;
  let mainVersion = 0;
  let mergeInCycle = false;
  const calls = {
    cycles: [],
    deploy: [],
    merge: [],
    refresh: [],
    updateBranch: [],
  };
  const provider = {
    refresh(item) {
      const pr = prs.get(item.id);
      assert(pr, `unknown PR ${item.id}`);
      calls.refresh.push({
        cycle,
        id: item.id,
        mainVersion,
        baseVersion: pr.baseVersion,
      });
      if (pr.merged) {
        return passingPr({
          state: 'merged',
          url: pr.url,
          branch: pr.branch,
          head: pr.head,
          checks: [{ name: 'ci', status: 'pass' }],
        });
      }
      if (pr.baseVersion < mainVersion) {
        return passingPr({
          url: pr.url,
          branch: pr.branch,
          head: pr.head,
          behindBase: true,
          checks: [{ name: 'ci', status: 'pass' }],
        });
      }
      if (pr.pendingChecks > 0) {
        pr.pendingChecks -= 1;
        return passingPr({
          url: pr.url,
          branch: pr.branch,
          head: pr.head,
          checks: [{ name: 'ci', status: 'pending' }],
        });
      }
      return passingPr({
        url: pr.url,
        branch: pr.branch,
        head: pr.head,
        checks: [{ name: 'ci', status: 'pass' }],
      });
    },
    updateBranch(item) {
      const pr = prs.get(item.id);
      pr.updateCount += 1;
      pr.baseVersion = mainVersion;
      pr.head = `agent-${pr.number}-rebased-main-${mainVersion}`;
      pr.pendingChecks = 1;
      calls.updateBranch.push({
        cycle,
        number: pr.number,
        baseVersion: pr.baseVersion,
        head: pr.head,
      });
    },
    merge(item, detail) {
      const pr = prs.get(item.id);
      assert.equal(mergeInCycle, false, 'steward merged more than one PR in a cycle');
      assert.equal(pr.baseVersion, mainVersion, `PR #${pr.number} merged without being current with main`);
      assert.equal(detail.head, pr.head, `PR #${pr.number} merged a stale head`);
      mergeInCycle = true;
      pr.merged = true;
      calls.merge.push({
        cycle,
        number: pr.number,
        head: pr.head,
        mainVersionBefore: mainVersion,
      });
      mainVersion += 1;
    },
    enqueueMergeQueue() {
      throw new Error('Berman serial deploy test must not use merge queue mode');
    },
    deploy(item) {
      const pr = prs.get(item.id);
      calls.deploy.push({ cycle, number: pr.number });
    },
  };

  for (cycle = 1; cycle <= 80; cycle++) {
    mergeInCycle = false;
    if (cycle === 3) {
      for (let number = firstReadyAgents + 1; number <= totalAgents; number++) {
        writeBermanReadinessReport(root, number, `2026-06-20T00:00:${String(number).padStart(2, '0')}.000Z`);
      }
    }

    const result = runDeploySteward(root, {
      scan: true,
      run: true,
      write: true,
      deployCommand: 'fake-deploy',
      provider,
      now: `2026-06-20T00:${String(cycle).padStart(2, '0')}:00.000Z`,
    });
    calls.cycles.push({
      cycle,
      events: result.events.map((event) => event.action),
      merges: calls.merge.filter((entry) => entry.cycle === cycle).length,
    });

    const queue = readQueue(root);
    if (queue.length === totalAgents && queue.every((item) => item.status === 'landed')) break;
  }

  const queue = readQueue(root);
  assert.equal(queue.length, totalAgents);
  assert.equal(queue.filter((item) => item.status === 'landed').length, totalAgents);
  assert.equal(calls.merge.length, totalAgents);
  assert.equal(calls.deploy.length, totalAgents);
  assert.equal(Math.max(...calls.cycles.map((entry) => entry.merges)), 1);
  assert(calls.cycles.some((entry) => entry.events.includes('updated-branch')), 'expected stale branches to be updated');
  assert(calls.cycles.some((entry) => entry.events.includes('waiting-for-checks')), 'expected CI wait cycles after branch updates');
  assert(calls.updateBranch.length >= totalAgents - 1, 'expected every post-first PR to be refreshed against main');
  assert(calls.updateBranch.some((entry) => entry.number === 2), 'expected early ready PR #2 to become stale after PR #1 landed');
  assert(calls.updateBranch.some((entry) => entry.number === 15), 'expected late PR #15 to be updated before landing');
  assert.deepEqual(calls.merge.map((entry) => entry.number), Array.from({ length: totalAgents }, (_value, index) => index + 1));
  assert(cycle < 80, 'scenario did not converge within the bounded steward cycles');
});

runTest('CLI can scan readiness reports as JSON', () => {
  const root = tempProject('cli');
  writeFile(path.join(root, '.planning', 'pr-readiness', 'ready.md'), readinessReport());
  const result = childProcess.spawnSync(process.execPath, [
    path.join(PROJECT_ROOT, 'scripts', 'deploy-steward.js'),
    '--project-root',
    root,
    '--scan',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.queue.length, 1);
  assert.equal(parsed.queue[0].status, 'ready');
});

if (process.exitCode) process.exit(process.exitCode);
console.log('\nall deploy-steward tests passed');

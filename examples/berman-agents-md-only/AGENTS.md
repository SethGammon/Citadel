# AGENTS.md - Parallel Agent Deploy Steward

This repository allows many agents to work in parallel, but only one deploy
steward may land changes on the protected branch.

This file is self-contained. If the repo does not already have a deploy steward,
create `.agent-steward/deploy-steward.cjs` by copying the exact script from the
`BEGIN_STEWARD_SCRIPT` block below, then run it with Node.

## Operating Model

- 15 agents may implement work at the same time.
- Each implementation agent owns one branch and one pull request.
- Implementation agents never merge their own PRs.
- Implementation agents never deploy directly.
- A single deploy steward owns the merge/deploy lane.

The answer is not 15 agents racing to `main`. The answer is parallel PR
production plus one serialized merge/deploy steward.

## Implementation Agent Contract

When an implementation agent finishes its work:

1. Push the branch.
2. Open or update the pull request.
3. Run the repo's verification command.
4. Write a readiness record:

   `.agent-steward/ready/pr-<number>.json`

   ```json
   {
     "id": "pr-123",
     "pr": "https://github.com/OWNER/REPO/pull/123",
     "branch": "agent/my-branch",
     "head": "current-head-sha",
     "ready": true,
     "verification": "npm test",
     "createdAt": "2026-06-20T00:00:00.000Z"
   }
   ```

5. Stop. Do not merge. Do not deploy.

If verification fails, do not write a ready record. Fix the branch first.

## Deploy Steward Contract

The deploy steward runs:

```bash
node .agent-steward/deploy-steward.cjs --scan --run --deploy "npm run deploy"
```

For one cycle only, run the same command once. For continuous unattended
stewarding, run it from a scheduler every minute or wrap it in the repo's normal
automation runner.

The steward must:

- create and own `.agent-steward/lease.lock`
- scan `.agent-steward/ready/*.json`
- maintain `.agent-steward/queue.json`
- refresh each PR with live GitHub state before acting
- update a PR branch when it is behind base
- stop and wait when checks are pending
- create `.agent-steward/repair/*.json` when checks fail, conflicts exist, PRs
  are closed, GitHub is unreadable, or deploy fails
- merge at most one serial PR per run cycle
- deploy only after a successful serial merge

## Safety Rules

- Never run two deploy stewards against the same protected branch.
- Never merge a PR with pending checks.
- Never merge a PR with failing checks.
- Never merge a PR that is behind base.
- Never merge a conflicted PR.
- Treat GitHub `mergeStateStatus: UNKNOWN` as a transient state to wait on, not
  as a conflict.
- Never force-push from the steward.
- Never treat an old readiness record as proof that the live PR head is safe.
- Never skip the queue because a PR looks simple.

## Expected 15-Agent Behavior

If 15 agents are running and the first 3 finish with PRs ready:

1. The steward queues the first 3 PRs.
2. It refreshes PR #1, merges it if checks pass, then deploys.
3. PR #2 is now stale because `main` moved, so the steward updates its branch
   and waits for checks.
4. While this is happening, the other 12 agents may finish and write readiness
   records.
5. The steward continues from the queue, one PR at a time.
6. Each later PR is refreshed against current `main`, updated when stale, waited
   on for CI, then merged and deployed.
7. Failures become repair records instead of blocking every other agent.

## Bootstrap

If `.agent-steward/deploy-steward.cjs` does not exist:

1. Create `.agent-steward/`.
2. Copy the JavaScript between `BEGIN_STEWARD_SCRIPT` and `END_STEWARD_SCRIPT`
   into `.agent-steward/deploy-steward.cjs`.
3. Run:

   ```bash
   node .agent-steward/deploy-steward.cjs --help
   ```

<!-- BEGIN_STEWARD_SCRIPT -->
```js
#!/usr/bin/env node
'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    provider: 'gh',
    mergeMethod: 'squash',
    deleteBranch: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--root') { args.root = path.resolve(next || '.'); index += 1; }
    else if (arg === '--provider') { args.provider = next || 'gh'; index += 1; }
    else if (arg === '--deploy') { args.deploy = next || ''; index += 1; }
    else if (arg === '--merge-method') { args.mergeMethod = next || 'squash'; index += 1; }
    else if (arg === '--keep-branch') args.deleteBranch = false;
    else if (arg === '--scan') args.scan = true;
    else if (arg === '--run') args.run = true;
    else if (arg === '--allow-no-checks') args.allowNoChecks = true;
    else if (arg === '--cycle') { args.cycle = next || ''; index += 1; }
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node .agent-steward/deploy-steward.cjs --scan',
    '  node .agent-steward/deploy-steward.cjs --scan --run --deploy "npm run deploy"',
    '',
    'Reads .agent-steward/ready/*.json, serializes PR merge/deploy, and writes',
    '.agent-steward/queue.json, report.md, events.jsonl, and repair records.',
  ].join('\n');
}

function statePaths(root) {
  const dir = path.join(root, '.agent-steward');
  return {
    dir,
    readyDir: path.join(dir, 'ready'),
    repairDir: path.join(dir, 'repair'),
    queuePath: path.join(dir, 'queue.json'),
    reportPath: path.join(dir, 'report.md'),
    eventsPath: path.join(dir, 'events.jsonl'),
    leaseDir: path.join(dir, 'lease.lock'),
    leasePath: path.join(dir, 'lease.json'),
    fixturePath: path.join(dir, 'fixture-prs.json'),
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendEvent(root, args, type, data) {
  const p = statePaths(root);
  ensureDir(p.dir);
  fs.appendFileSync(p.eventsPath, `${JSON.stringify({
    ts: new Date().toISOString(),
    cycle: args.cycle || null,
    type,
    ...data,
  })}\n`, 'utf8');
}

function parsePr(url) {
  const match = String(url || '').match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
    repoSlug: `${match[1]}/${match[2]}`,
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  };
}

function idFor(record) {
  const parsed = parsePr(record.pr);
  if (parsed) return `pr-${parsed.number}`;
  return String(record.id || record.branch || record.pr).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function prNumber(item) {
  const parsed = parsePr(item.pr);
  return parsed ? parsed.number : Number.MAX_SAFE_INTEGER;
}

function readQueue(root) {
  return readJson(statePaths(root).queuePath, []);
}

function writeQueue(root, queue) {
  writeJson(statePaths(root).queuePath, queue);
}

function scanReady(root, queue) {
  const p = statePaths(root);
  ensureDir(p.readyDir);
  const byId = new Map(queue.map((item) => [item.id, item]));
  for (const file of fs.readdirSync(p.readyDir).filter((name) => name.endsWith('.json')).sort()) {
    const record = readJson(path.join(p.readyDir, file), null);
    if (!record || record.ready !== true || !record.pr) continue;
    const id = idFor(record);
    const previous = byId.get(id);
    if (previous && previous.status === 'landed') continue;
    byId.set(id, {
      ...(previous || {}),
      id,
      pr: record.pr,
      branch: record.branch || (previous && previous.branch) || null,
      head: record.head || (previous && previous.head) || null,
      status: previous && previous.status ? previous.status : 'queued',
      readyPath: `.agent-steward/ready/${file}`,
      verification: record.verification || null,
      createdAt: record.createdAt || (previous && previous.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return Array.from(byId.values()).sort((left, right) => {
    const byNumber = prNumber(left) - prNumber(right);
    if (byNumber !== 0) return byNumber;
    return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
  });
}

function acquireLease(root) {
  const p = statePaths(root);
  ensureDir(p.dir);
  const lease = {
    holder: `${os.hostname()}:${process.pid}`,
    acquiredAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(p.leaseDir);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('another deploy steward is already running');
    throw error;
  }
  writeJson(p.leasePath, lease);
  return lease;
}

function releaseLease(root) {
  const p = statePaths(root);
  fs.rmSync(p.leaseDir, { recursive: true, force: true });
  fs.rmSync(p.leasePath, { force: true });
}

function splitCommand(command) {
  const input = String(command || '').trim();
  if (!input) return [];
  const args = [];
  let current = '';
  let quote = null;
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (quote) throw new Error('unterminated quote in command');
  if (current) args.push(current);
  return args;
}

function runCommand(command, cwd) {
  const parts = Array.isArray(command) ? command : splitCommand(command);
  if (!parts.length) return '';
  const result = cp.spawnSync(parts[0], parts.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || '').trim() || `${parts[0]} failed`);
  return result.stdout || '';
}

function normalizeChecks(checks) {
  const normalized = (checks || []).map((check) => {
    const name = check.name || check.context || check.workflowName || 'check';
    const status = String(check.status || check.state || '').toUpperCase();
    const conclusion = String(check.conclusion || '').toUpperCase();
    if (['FAIL', 'FAILED', 'FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(status)
      || ['FAIL', 'FAILED', 'FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(conclusion)) {
      return { name, status: 'fail' };
    }
    if (['PASS', 'PASSED', 'SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(status)
      || ['PASS', 'PASSED', 'SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion)) {
      return { name, status: 'pass' };
    }
    return { name, status: 'pending' };
  });
  return {
    all: normalized,
    failing: normalized.filter((check) => check.status === 'fail'),
    pending: normalized.filter((check) => check.status === 'pending'),
    passing: normalized.filter((check) => check.status === 'pass'),
  };
}

function gh(args, root) {
  return runCommand(['gh', ...args], root);
}

function ghProvider(root, args) {
  return {
    refresh(item) {
      const fields = 'number,url,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus,state,statusCheckRollup';
      const raw = JSON.parse(gh(['pr', 'view', item.pr, '--json', fields], root));
      return {
        state: String(raw.state || 'OPEN').toLowerCase(),
        url: raw.url,
        branch: raw.headRefName,
        base: raw.baseRefName,
        head: raw.headRefOid,
        mergeStateStatus: raw.mergeStateStatus,
        mergeable: raw.mergeable,
        behindBase: raw.mergeStateStatus === 'BEHIND',
        checks: raw.statusCheckRollup || [],
      };
    },
    updateBranch(item, detail) {
      const parsed = parsePr(detail.url || item.pr);
      const apiArgs = ['api', '-X', 'PUT', `repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}/update-branch`];
      if (detail.head || item.head) apiArgs.push('-f', `expected_head_sha=${detail.head || item.head}`);
      gh(apiArgs, root);
    },
    merge(item, detail) {
      const mergeArgs = ['pr', 'merge', detail.url || item.pr, `--${args.mergeMethod}`];
      if (args.deleteBranch) mergeArgs.push('--delete-branch');
      if (detail.head || item.head) mergeArgs.push('--match-head-commit', detail.head || item.head);
      gh(mergeArgs, root);
    },
    deploy() {
      if (args.deploy) runCommand(args.deploy, root);
    },
  };
}

function fixtureProvider(root, args) {
  const p = statePaths(root);
  const load = () => readJson(p.fixturePath, { mainVersion: 0, prs: {}, merges: [], deploys: [] });
  const save = (state) => writeJson(p.fixturePath, state);
  return {
    refresh(item) {
      const state = load();
      const pr = state.prs[item.id];
      if (!pr) throw new Error(`fixture missing ${item.id}`);
      if (pr.merged) {
        return { state: 'merged', url: pr.url, branch: pr.branch, head: pr.head, checks: [{ name: 'ci', status: 'pass' }] };
      }
      if (pr.baseVersion < state.mainVersion) {
        if (!pr.sawUnknownMergeability) {
          pr.sawUnknownMergeability = true;
          save(state);
          return { state: 'open', url: pr.url, branch: pr.branch, head: pr.head, mergeStateStatus: 'UNKNOWN', mergeable: 'UNKNOWN', checks: [{ name: 'ci', status: 'pass' }] };
        }
        return { state: 'open', url: pr.url, branch: pr.branch, head: pr.head, behindBase: true, checks: [{ name: 'ci', status: 'pass' }] };
      }
      if (pr.pendingChecks > 0) {
        pr.pendingChecks -= 1;
        save(state);
        return { state: 'open', url: pr.url, branch: pr.branch, head: pr.head, checks: [{ name: 'ci', status: 'pending' }] };
      }
      return { state: 'open', url: pr.url, branch: pr.branch, head: pr.head, checks: [{ name: 'ci', status: 'pass' }] };
    },
    updateBranch(item) {
      const state = load();
      const pr = state.prs[item.id];
      pr.baseVersion = state.mainVersion;
      pr.head = `${item.id}-rebased-main-${state.mainVersion}`;
      pr.pendingChecks = 1;
      pr.updateCount = (pr.updateCount || 0) + 1;
      state.updates = [...(state.updates || []), { cycle: args.cycle || null, id: item.id, mainVersion: state.mainVersion }];
      save(state);
    },
    merge(item, detail) {
      const state = load();
      const pr = state.prs[item.id];
      if (pr.baseVersion !== state.mainVersion) throw new Error(`${item.id} is stale`);
      if (detail.head !== pr.head) throw new Error(`${item.id} head mismatch`);
      pr.merged = true;
      state.merges = [...(state.merges || []), { cycle: args.cycle || null, id: item.id, head: pr.head }];
      state.mainVersion += 1;
      save(state);
    },
    deploy(item) {
      const state = load();
      state.deploys = [...(state.deploys || []), { cycle: args.cycle || null, id: item.id }];
      save(state);
    },
  };
}

function createRepair(root, item, reason) {
  const p = statePaths(root);
  ensureDir(p.repairDir);
  const file = path.join(p.repairDir, `${item.id}.json`);
  writeJson(file, {
    id: item.id,
    pr: item.pr,
    branch: item.branch,
    reason,
    createdAt: new Date().toISOString(),
  });
  return `.agent-steward/repair/${item.id}.json`;
}

function processOne(root, args, queue, provider) {
  const item = queue.find((candidate) => !['landed', 'repair-needed'].includes(candidate.status));
  if (!item) return { action: 'idle' };
  let detail;
  try {
    detail = provider.refresh(item);
  } catch (error) {
    item.status = 'repair-needed';
    item.reason = `refresh failed: ${error.message}`;
    item.repair = createRepair(root, item, item.reason);
    return { action: 'repair-needed', item: item.id, reason: item.reason };
  }
  item.remoteHead = detail.head || null;
  if (detail.head) item.head = detail.head;
  item.updatedAt = new Date().toISOString();
  if (detail.state === 'merged') {
    item.status = 'landed';
    item.reason = null;
    return { action: 'already-merged', item: item.id };
  }
  if (detail.state === 'closed') {
    item.status = 'repair-needed';
    item.reason = 'PR is closed without merge';
    item.repair = createRepair(root, item, item.reason);
    return { action: 'repair-needed', item: item.id, reason: item.reason };
  }
  const mergeState = String(detail.mergeStateStatus || '').toUpperCase();
  const mergeable = String(detail.mergeable || '').toUpperCase();
  if (mergeState === 'UNKNOWN') {
    item.status = 'queued';
    item.reason = 'waiting for GitHub mergeability calculation';
    return { action: 'waiting-for-mergeability', item: item.id };
  }
  if (mergeState === 'DIRTY' || mergeable === 'CONFLICTING') {
    item.status = 'repair-needed';
    item.reason = 'PR has merge conflicts or dirty merge state';
    item.repair = createRepair(root, item, item.reason);
    return { action: 'repair-needed', item: item.id, reason: item.reason };
  }
  if (detail.behindBase) {
    provider.updateBranch(item, detail);
    item.status = 'queued';
    item.reason = 'branch updated; waiting for checks';
    return { action: 'updated-branch', item: item.id };
  }
  const checks = normalizeChecks(detail.checks);
  if (checks.all.length === 0 && !args.allowNoChecks) {
    item.status = 'queued';
    item.reason = 'no visible checks';
    return { action: 'waiting-for-checks', item: item.id };
  }
  if (checks.failing.length) {
    item.status = 'repair-needed';
    item.reason = `failing checks: ${checks.failing.map((check) => check.name).join(', ')}`;
    item.repair = createRepair(root, item, item.reason);
    return { action: 'repair-needed', item: item.id, reason: item.reason };
  }
  if (checks.pending.length) {
    item.status = 'queued';
    item.reason = `waiting for checks: ${checks.pending.map((check) => check.name).join(', ')}`;
    return { action: 'waiting-for-checks', item: item.id };
  }
  provider.merge(item, detail);
  provider.deploy(item, detail);
  item.status = 'landed';
  item.reason = null;
  item.landedAt = new Date().toISOString();
  return { action: 'merged-and-deployed', item: item.id };
}

function writeReport(root, queue, outcome) {
  const p = statePaths(root);
  const lines = [
    '# Deploy Steward Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Outcome: ${outcome.action}`,
    '',
    '## Queue',
    ...queue.map((item) => `- ${item.status}: ${item.pr} ${item.reason ? `- ${item.reason}` : ''}`),
    '',
  ];
  ensureDir(p.dir);
  fs.writeFileSync(p.reportPath, lines.join('\n'), 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const root = path.resolve(args.root);
  const p = statePaths(root);
  ensureDir(p.dir);
  let queue = readQueue(root);
  if (args.scan) queue = scanReady(root, queue);
  let outcome = { action: 'scanned' };
  if (args.run) {
    acquireLease(root);
    try {
      const provider = args.provider === 'fixture' ? fixtureProvider(root, args) : ghProvider(root, args);
      outcome = processOne(root, args, queue, provider);
      appendEvent(root, args, outcome.action, outcome);
    } finally {
      releaseLease(root);
    }
  }
  writeQueue(root, queue);
  writeReport(root, queue, outcome);
  console.log(JSON.stringify({ outcome, queue }, null, 2));
}

main();
```
<!-- END_STEWARD_SCRIPT -->

## Evidence Required Before Sending This File

The acceptance scenario is:

- start a fresh project with only this `AGENTS.md`
- materialize `.agent-steward/deploy-steward.cjs` from this file
- simulate 15 agent PRs
- make only the first 3 PRs ready at the start
- add the other 12 readiness records while the steward is already running
- advance `main` after every merge
- force every stale PR to update and wait for checks
- prove no cycle merges more than one PR
- prove every PR deploys after merge
- prove all 15 eventually land

If that scenario fails, this file is not sufficient.

## Handoff Format

```text
---HANDOFF---
- Queue: <N> PRs in .agent-steward/queue.json
- Last action: merged-and-deployed | updated-branch | waiting-for-checks | repair-needed | idle
- Report: .agent-steward/report.md
- Repair: <path or none>
---
```

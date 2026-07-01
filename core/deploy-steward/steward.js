'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const QUEUE_STATUSES = new Set([
  'queued',
  'ready',
  'blocked',
  'stale',
  'landing',
  'landed',
  'repair-needed',
]);

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function timestampForFile(iso) {
  return String(iso || new Date().toISOString())
    .replace(/[:.]/g, '-')
    .replace(/Z$/, 'Z');
}

function slug(value) {
  return String(value || 'item')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    || 'item';
}

function paths(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const baseDir = path.join(root, '.planning', 'deploy-steward');
  return {
    projectRoot: root,
    baseDir,
    queuePath: path.join(baseDir, 'queue.jsonl'),
    leasePath: path.join(baseDir, 'lease.json'),
    leaseLockDir: path.join(baseDir, 'lease.lock'),
    runsDir: path.join(baseDir, 'runs'),
    latestReportPath: path.join(baseDir, 'runs', 'latest.md'),
    intakeDir: path.join(root, '.planning', 'intake'),
    readinessDir: path.join(root, '.planning', 'pr-readiness'),
  };
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function lineValue(content, label) {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, 'm');
  const match = String(content || '').match(pattern);
  return match ? match[1].trim() : null;
}

function gateStatus(content, gateLabel) {
  const escaped = gateLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*([^|]+?)\\s*\\|`, 'm');
  const match = String(content || '').match(pattern);
  if (!match) return { pass: false, detail: 'missing gate' };
  return {
    pass: match[1].trim() === 'pass',
    detail: match[2].trim(),
  };
}

function parseReadinessReport(projectRoot, filePath) {
  const content = readText(filePath);
  if (!content) return null;
  const status = lineValue(content, 'Status') || 'unknown';
  const gates = {
    prUrl: gateStatus(content, 'Pull request URL'),
    git: gateStatus(content, 'Git worktree'),
    dashboard: gateStatus(content, 'Dashboard repairs'),
    verification: gateStatus(content, 'Verification'),
  };
  const blockers = [];
  if (status !== 'ready') blockers.push(`readiness status is ${status}`);
  for (const [name, gate] of Object.entries(gates)) {
    if (!gate.pass) blockers.push(`${name} gate failed: ${gate.detail}`);
  }
  return {
    path: normalizePath(path.relative(projectRoot, filePath)),
    generatedAt: lineValue(content, 'Generated') || null,
    status,
    ready: status === 'ready' && blockers.length === 0,
    pr: lineValue(content, 'PR') || null,
    branch: lineValue(content, 'Branch') || path.basename(filePath, path.extname(filePath)),
    head: lineValue(content, 'Head') || null,
    gates,
    blockers,
  };
}

function readReadinessReports(projectRoot) {
  const { readinessDir } = paths(projectRoot);
  if (!fs.existsSync(readinessDir)) return [];
  return fs.readdirSync(readinessDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => parseReadinessReport(path.resolve(projectRoot), path.join(readinessDir, name)))
    .filter(Boolean);
}

function parseGitHubPr(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
    repoSlug: `${match[1]}/${match[2]}`,
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  };
}

function itemId(candidate) {
  const pr = parseGitHubPr(candidate.pr || candidate.url);
  if (pr) return `pr-${slug(`${pr.owner}-${pr.repo}-${pr.number}`)}`;
  if (candidate.branch) return `branch-${slug(candidate.branch)}`;
  if (candidate.id) return slug(candidate.id);
  return `item-${slug(candidate.head || candidate.title || 'unknown')}`;
}

function normalizeStatus(status, fallback = 'queued') {
  const value = String(status || fallback).trim();
  return QUEUE_STATUSES.has(value) ? value : fallback;
}

function readQueue(projectRoot) {
  const { queuePath } = paths(projectRoot);
  const content = readText(queuePath);
  if (!content) return [];
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((item) => ({
      ...item,
      status: normalizeStatus(item.status),
    }));
}

function writeQueue(projectRoot, items) {
  const { baseDir, queuePath } = paths(projectRoot);
  ensureDir(baseDir);
  const body = items.map((item) => JSON.stringify(item)).join('\n');
  fs.writeFileSync(queuePath, body ? `${body}\n` : '', 'utf8');
  return normalizePath(path.relative(path.resolve(projectRoot), queuePath));
}

function scanReadinessCandidates(projectRoot, now = new Date().toISOString()) {
  return readReadinessReports(projectRoot).map((report) => {
    const ready = report.ready === true;
    const id = itemId(report);
    return {
      schema: 1,
      id,
      source: 'pr-readiness',
      pr: report.pr,
      branch: report.branch,
      head: report.head,
      readinessReport: report.path,
      readinessGeneratedAt: report.generatedAt,
      status: ready ? 'ready' : 'blocked',
      blockedReason: ready ? null : report.blockers.join('; '),
      attempts: 0,
      enqueuedAt: now,
      updatedAt: now,
    };
  });
}

function normalizeCandidate(candidate, now = new Date().toISOString()) {
  const id = itemId(candidate);
  return {
    schema: 1,
    id,
    source: candidate.source || 'manual',
    pr: candidate.pr || candidate.url || null,
    branch: candidate.branch || null,
    head: candidate.head || null,
    readinessReport: candidate.readinessReport || null,
    readinessGeneratedAt: candidate.readinessGeneratedAt || null,
    status: normalizeStatus(candidate.status, 'queued'),
    blockedReason: candidate.blockedReason || null,
    attempts: Number.isInteger(candidate.attempts) ? candidate.attempts : 0,
    enqueuedAt: candidate.enqueuedAt || now,
    updatedAt: now,
  };
}

function upsertQueueItems(existing, candidates, now = new Date().toISOString()) {
  const byId = new Map(existing.map((item) => [item.id, { ...item }]));
  const changes = [];

  for (const rawCandidate of candidates) {
    const candidate = normalizeCandidate(rawCandidate, now);
    const previous = byId.get(candidate.id);
    if (!previous) {
      byId.set(candidate.id, candidate);
      changes.push({ type: 'added', id: candidate.id });
      continue;
    }

    const terminal = previous.status === 'landed';
    const merged = {
      ...previous,
      ...candidate,
      attempts: previous.attempts || 0,
      enqueuedAt: previous.enqueuedAt || candidate.enqueuedAt,
      updatedAt: now,
    };
    if (terminal) {
      merged.status = previous.status;
      merged.blockedReason = previous.blockedReason || null;
      merged.head = previous.head || candidate.head;
      merged.landedAt = previous.landedAt || null;
    }
    if (previous.head && candidate.head && previous.head !== candidate.head && previous.status !== 'landed') {
      merged.attempts = 0;
      merged.status = candidate.status;
      changes.push({ type: 'refreshed', id: candidate.id });
    } else if (JSON.stringify(previous) !== JSON.stringify(merged)) {
      changes.push({ type: 'updated', id: candidate.id });
    }
    byId.set(candidate.id, merged);
  }

  const items = Array.from(byId.values()).sort((left, right) => {
    const leftTime = String(left.readinessGeneratedAt || left.enqueuedAt || '');
    const rightTime = String(right.readinessGeneratedAt || right.enqueuedAt || '');
    const generated = leftTime.localeCompare(rightTime);
    if (generated !== 0) return generated;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  return { items, changes };
}

function readLease(projectRoot) {
  const { leasePath } = paths(projectRoot);
  const content = readText(leasePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function activeLease(lease, now = new Date()) {
  if (!lease || !lease.expiresAt) return false;
  return new Date(lease.expiresAt).getTime() > now.getTime();
}

function writeLease(projectRoot, lease) {
  const { baseDir, leasePath, leaseLockDir } = paths(projectRoot);
  ensureDir(baseDir);
  fs.writeFileSync(leasePath, `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
  ensureDir(leaseLockDir);
  fs.writeFileSync(path.join(leaseLockDir, 'lease.json'), `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
}

function acquireLease(projectRoot, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const holder = options.holder || `${os.hostname()}:${process.pid}`;
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 15 * 60 * 1000;
  const lease = {
    schema: 1,
    holder,
    pid: process.pid,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    command: options.command || process.argv.join(' '),
  };
  const { baseDir, leaseLockDir } = paths(projectRoot);
  ensureDir(baseDir);

  try {
    fs.mkdirSync(leaseLockDir);
    writeLease(projectRoot, lease);
    return lease;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = readLease(projectRoot);
    if (activeLease(existing, now) && !options.force) {
      const detail = existing?.holder ? ` held by ${existing.holder} until ${existing.expiresAt}` : '';
      throw new Error(`deploy steward lease is active${detail}`);
    }
    fs.rmSync(leaseLockDir, { recursive: true, force: true });
    fs.mkdirSync(leaseLockDir);
    writeLease(projectRoot, lease);
    return lease;
  }
}

function releaseLease(projectRoot, lease, options = {}) {
  const { leasePath, leaseLockDir } = paths(projectRoot);
  const current = readLease(projectRoot);
  if (!options.force && current && lease && current.holder !== lease.holder) return false;
  fs.rmSync(leaseLockDir, { recursive: true, force: true });
  if (fs.existsSync(leasePath)) fs.rmSync(leasePath, { force: true });
  return true;
}

function splitCommand(command) {
  const input = String(command || '').trim();
  if (!input) return [];
  const args = [];
  let current = '';
  let quote = null;
  let escaping = false;
  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaping) current += '\\';
  if (quote) throw new Error('deploy command has an unterminated quote');
  if (current) args.push(current);
  return args;
}

function runCommand(command, options = {}) {
  const args = Array.isArray(command) ? command : splitCommand(command);
  if (args.length === 0) return { status: 0, stdout: '', stderr: '', skipped: true };
  const result = childProcess.spawnSync(args[0], args.slice(1), {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`${args.join(' ')} failed with exit ${result.status}${stderr ? `: ${stderr}` : ''}`);
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function normalizeCheck(entry) {
  const name = entry.name || entry.context || entry.workflowName || entry.checkName || 'unnamed check';
  const rawStatus = String(entry.status || entry.state || '').toUpperCase();
  const rawConclusion = String(entry.conclusion || '').toUpperCase();
  if (['FAILURE', 'FAILED', 'FAIL', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(rawConclusion)
    || ['FAILURE', 'FAILED', 'FAIL', 'ERROR'].includes(rawStatus)) {
    return { name, status: 'fail', detail: entry.detailsUrl || entry.url || rawConclusion || rawStatus };
  }
  if (['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(rawConclusion)
    || ['PASS', 'PASSED', 'SUCCESS'].includes(rawStatus)) {
    return { name, status: 'pass', detail: entry.detailsUrl || entry.url || rawConclusion || rawStatus };
  }
  return { name, status: 'pending', detail: entry.detailsUrl || entry.url || rawConclusion || rawStatus || 'pending' };
}

function summarizeChecks(checks) {
  const normalized = (checks || []).map(normalizeCheck);
  const passing = normalized.filter((check) => check.status === 'pass');
  const pending = normalized.filter((check) => check.status === 'pending');
  const failing = normalized.filter((check) => check.status === 'fail');
  let conclusion = 'none';
  if (failing.length > 0) conclusion = 'fail';
  else if (pending.length > 0) conclusion = 'pending';
  else if (passing.length > 0) conclusion = 'pass';
  return {
    total: normalized.length,
    passing,
    pending,
    failing,
    conclusion,
  };
}

function normalizePrDetails(raw) {
  const mergeStateStatus = raw.mergeStateStatus || raw.merge_state_status || raw.mergeState || null;
  const head = raw.headRefOid || raw.head || raw.headSha || null;
  return {
    number: raw.number || null,
    url: raw.url || raw.pr || null,
    state: String(raw.state || 'OPEN').toLowerCase(),
    branch: raw.headRefName || raw.branch || null,
    base: raw.baseRefName || raw.base || null,
    head,
    mergeable: raw.mergeable,
    mergeStateStatus,
    behindBase: raw.behindBase === true || mergeStateStatus === 'BEHIND',
    checks: (raw.statusCheckRollup || raw.checks || []).map(normalizeCheck),
  };
}

function runGh(gh, args, options = {}) {
  const result = childProcess.spawnSync(gh, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`gh ${args.join(' ')} failed with exit ${result.status}${stderr ? `: ${stderr}` : ''}`);
  }
  return result.stdout || '';
}

function createGhProvider(options = {}) {
  const gh = options.gh || 'gh';
  const cwd = options.cwd || process.cwd();
  const mergeMethod = options.mergeMethod || 'squash';
  const deleteBranch = options.deleteBranch !== false;
  return {
    refresh(item) {
      const ref = item.pr || item.branch || item.id;
      const fields = [
        'number',
        'url',
        'headRefName',
        'headRefOid',
        'baseRefName',
        'mergeable',
        'mergeStateStatus',
        'state',
        'statusCheckRollup',
      ].join(',');
      const output = runGh(gh, ['pr', 'view', ref, '--json', fields], { cwd });
      return normalizePrDetails(JSON.parse(output));
    },
    updateBranch(item, detail) {
      const pr = parseGitHubPr(detail.url || item.pr);
      if (!pr) throw new Error(`cannot update branch without a GitHub PR URL for ${item.id}`);
      const args = ['api', '-X', 'PUT', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/update-branch`];
      const head = detail.head || item.head;
      if (head) args.push('-f', `expected_head_sha=${head}`);
      return runGh(gh, args, { cwd });
    },
    merge(item, detail) {
      const ref = detail.url || item.pr || item.branch || item.id;
      const args = ['pr', 'merge', ref, `--${mergeMethod}`];
      if (deleteBranch) args.push('--delete-branch');
      const head = detail.head || item.head;
      if (head) args.push('--match-head-commit', head);
      return runGh(gh, args, { cwd });
    },
    enqueueMergeQueue(item, detail) {
      const ref = detail.url || item.pr || item.branch || item.id;
      const args = ['pr', 'merge', ref, '--auto'];
      if (deleteBranch) args.push('--delete-branch');
      return runGh(gh, args, { cwd });
    },
    deploy(item, detail, command) {
      if (!command) return { skipped: true };
      return runCommand(command, {
        cwd,
        env: {
          CITADEL_DEPLOY_PR: detail.url || item.pr || '',
          CITADEL_DEPLOY_BRANCH: detail.branch || item.branch || '',
          CITADEL_DEPLOY_HEAD: detail.head || item.head || '',
        },
      });
    },
  };
}

function createRepairTask(projectRoot, item, reason, now = new Date().toISOString()) {
  const { intakeDir } = paths(projectRoot);
  ensureDir(intakeDir);
  const fileName = `${timestampForFile(now)}-deploy-steward-${slug(item.id)}.md`;
  const filePath = path.join(intakeDir, fileName);
  const title = `Repair deploy steward candidate ${item.pr || item.branch || item.id}`;
  const body = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    'status: pending',
    'priority: high',
    `target: ${item.branch || item.pr || item.id}`,
    '---',
    '',
    '## Description',
    '',
    `Deploy steward could not land ${item.pr || item.branch || item.id}.`,
    '',
    `Reason: ${reason || 'unknown failure'}`,
    '',
    '## Acceptance Criteria',
    '- The PR branch is updated against the latest base branch.',
    '- Required checks pass on the current head commit.',
    '- The deploy steward queue item can be retried without manual cleanup.',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, body, 'utf8');
  return normalizePath(path.relative(path.resolve(projectRoot), filePath));
}

function shouldProcess(item) {
  return ['queued', 'ready', 'blocked', 'stale', 'landing'].includes(item.status);
}

function detailIndicatesConflict(detail) {
  const mergeState = String(detail.mergeStateStatus || '').toUpperCase();
  const mergeable = String(detail.mergeable || '').toUpperCase();
  return mergeState === 'DIRTY' || mergeState === 'UNKNOWN' && mergeable === 'CONFLICTING' || mergeable === 'CONFLICTING';
}

function markRepair(projectRoot, item, reason, now, events, options) {
  const repairTask = options.write === false || options.dryRun
    ? null
    : createRepairTask(projectRoot, item, reason, now);
  item.status = 'repair-needed';
  item.blockedReason = reason;
  item.repairTask = repairTask;
  item.updatedAt = now;
  events.push({ item: item.id, action: 'repair-needed', reason, repairTask });
  return { stop: true, status: item.status };
}

function processQueueItem(projectRoot, item, provider, options, now) {
  const events = [];
  item.attempts = (item.attempts || 0) + 1;
  item.updatedAt = now;

  if (!item.pr) {
    item.status = 'blocked';
    item.blockedReason = 'missing pull request URL';
    events.push({ item: item.id, action: 'blocked', reason: item.blockedReason });
    return { item, events, stop: true };
  }

  let detail;
  try {
    detail = normalizePrDetails(provider.refresh(item));
  } catch (error) {
    markRepair(projectRoot, item, `failed to refresh PR: ${error.message}`, now, events, options);
    return { item, events, stop: true };
  }

  item.remote = {
    state: detail.state,
    branch: detail.branch,
    base: detail.base,
    head: detail.head,
    mergeStateStatus: detail.mergeStateStatus,
    mergeable: detail.mergeable,
    checkedAt: now,
  };

  if (detail.state === 'merged') {
    item.status = 'landed';
    item.blockedReason = null;
    events.push({ item: item.id, action: 'already-merged' });
    return { item, events, stop: false };
  }
  if (detail.state === 'closed') {
    markRepair(projectRoot, item, 'pull request is closed without being merged', now, events, options);
    return { item, events, stop: true };
  }

  if (options.requireFreshReadiness && item.head && detail.head && item.head !== detail.head) {
    item.status = 'stale';
    item.blockedReason = `readiness head ${item.head} does not match PR head ${detail.head}`;
    events.push({ item: item.id, action: 'stale', reason: item.blockedReason });
    return { item, events, stop: true };
  }

  if (detail.head) item.head = detail.head;

  if (detailIndicatesConflict(detail)) {
    markRepair(projectRoot, item, `merge conflict or dirty merge state (${detail.mergeStateStatus || detail.mergeable || 'unknown'})`, now, events, options);
    return { item, events, stop: true };
  }

  if (detail.behindBase) {
    if (!options.dryRun) provider.updateBranch(item, detail);
    item.status = 'queued';
    item.blockedReason = 'branch updated against base; waiting for checks on refreshed head';
    events.push({ item: item.id, action: options.dryRun ? 'would-update-branch' : 'updated-branch', reason: item.blockedReason });
    return { item, events, stop: true };
  }

  const checks = summarizeChecks(detail.checks);
  item.checks = {
    total: checks.total,
    passing: checks.passing.length,
    pending: checks.pending.length,
    failing: checks.failing.length,
    conclusion: checks.conclusion,
  };

  if (checks.conclusion === 'none' && !options.allowNoChecks) {
    item.status = 'blocked';
    item.blockedReason = 'no required checks were visible; pass --allow-no-checks only for repos without CI';
    events.push({ item: item.id, action: 'blocked', reason: item.blockedReason });
    return { item, events, stop: true };
  }

  if (checks.failing.length > 0) {
    const reason = `failing checks: ${checks.failing.map((check) => check.name).join(', ')}`;
    markRepair(projectRoot, item, reason, now, events, options);
    return { item, events, stop: true };
  }

  if (checks.pending.length > 0) {
    item.status = 'queued';
    item.blockedReason = `waiting for checks: ${checks.pending.map((check) => check.name).join(', ')}`;
    events.push({ item: item.id, action: 'waiting-for-checks', reason: item.blockedReason });
    return { item, events, stop: true };
  }

  try {
    if (options.mergeMode === 'merge-queue') {
      if (!options.dryRun) provider.enqueueMergeQueue(item, detail);
      item.status = 'landing';
      item.blockedReason = 'queued in GitHub merge queue; rerun steward after it merges';
      events.push({ item: item.id, action: options.dryRun ? 'would-enqueue-merge-queue' : 'enqueued-merge-queue' });
      return { item, events, stop: true };
    }

    if (!options.dryRun) provider.merge(item, detail);
    events.push({ item: item.id, action: options.dryRun ? 'would-merge' : 'merged' });

    if (options.deployCommand) {
      if (!options.dryRun) provider.deploy(item, detail, options.deployCommand);
      events.push({ item: item.id, action: options.dryRun ? 'would-deploy' : 'deployed' });
    }

    item.status = options.dryRun ? 'ready' : 'landed';
    item.blockedReason = options.dryRun ? 'dry run: merge/deploy not executed' : null;
    item.landedAt = options.dryRun ? null : now;
    return { item, events, stop: false };
  } catch (error) {
    markRepair(projectRoot, item, error.message, now, events, options);
    return { item, events, stop: true };
  }
}

function renderReport(result) {
  const lines = [
    'Citadel Deploy Steward',
    '='.repeat(40),
    `Generated: ${result.generatedAt}`,
    `Project: ${result.projectRoot}`,
    `Mode: ${result.mode}`,
    `Dry run: ${result.dryRun ? 'yes' : 'no'}`,
    `Queue: ${result.queuePath || '(not written)'}`,
    '',
    'Lease',
  ];
  if (result.lease) {
    lines.push(`  Holder: ${result.lease.holder}`);
    lines.push(`  Expires: ${result.lease.expiresAt}`);
  } else {
    lines.push('  (not acquired)');
  }

  lines.push('');
  lines.push('Events');
  if (!result.events.length) {
    lines.push('  (none)');
  } else {
    for (const event of result.events) {
      const detail = event.reason ? ` - ${event.reason}` : '';
      const repair = event.repairTask ? ` (${event.repairTask})` : '';
      lines.push(`  - ${event.item}: ${event.action}${detail}${repair}`);
    }
  }

  lines.push('');
  lines.push('Queue');
  if (!result.queue.length) {
    lines.push('  (empty)');
  } else {
    for (const item of result.queue) {
      const target = item.pr || item.branch || item.id;
      const reason = item.blockedReason ? ` - ${item.blockedReason}` : '';
      lines.push(`  - ${item.status}: ${target}${reason}`);
    }
  }

  lines.push('');
  lines.push('Next');
  if (result.events.some((event) => event.action === 'repair-needed')) {
    lines.push('  Repair the generated intake item, then rerun deploy steward.');
  } else if (result.queue.some((item) => ['queued', 'landing'].includes(item.status))) {
    lines.push('  Rerun after checks or the merge queue advance.');
  } else if (result.queue.some((item) => ['ready', 'blocked', 'stale'].includes(item.status))) {
    lines.push('  Resolve blocked queue items, then rerun deploy steward.');
  } else {
    lines.push('  Queue is landed or empty.');
  }

  return `${lines.join('\n')}\n`;
}

function writeRunReport(projectRoot, result) {
  const { runsDir, latestReportPath } = paths(projectRoot);
  ensureDir(runsDir);
  const rendered = renderReport(result);
  fs.writeFileSync(latestReportPath, rendered, 'utf8');
  const timestampPath = path.join(runsDir, `${timestampForFile(result.generatedAt)}.md`);
  fs.writeFileSync(timestampPath, rendered, 'utf8');
  return {
    latest: normalizePath(path.relative(path.resolve(projectRoot), latestReportPath)),
    timestamped: normalizePath(path.relative(path.resolve(projectRoot), timestampPath)),
  };
}

function buildManualCandidates(options, now) {
  return (options.enqueue || []).map((entry) => normalizeCandidate({
    source: 'manual',
    pr: entry.pr || entry.url || entry,
    branch: entry.branch || options.branch || null,
    head: entry.head || options.head || null,
    status: entry.status || 'queued',
  }, now));
}

function runDeploySteward(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const generatedAt = (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString();
  const stewardPaths = paths(root);
  let queue = readQueue(root);
  const events = [];
  const mode = options.run ? 'run' : (options.scan ? 'scan' : 'inspect');

  const candidates = [];
  if (options.scan) candidates.push(...scanReadinessCandidates(root, generatedAt));
  if (options.enqueue) candidates.push(...buildManualCandidates(options, generatedAt));
  if (candidates.length > 0) {
    const updated = upsertQueueItems(queue, candidates, generatedAt);
    queue = updated.items;
    for (const change of updated.changes) {
      events.push({ item: change.id, action: `queue-${change.type}` });
    }
    if (options.write !== false && !options.dryRun) writeQueue(root, queue);
  }

  let lease = null;
  const provider = options.provider || createGhProvider({
    cwd: root,
    gh: options.gh,
    mergeMethod: options.mergeMethod,
    deleteBranch: options.deleteBranch,
  });

  if (options.run) {
    lease = acquireLease(root, {
      holder: options.holder,
      force: options.forceLease,
      now: generatedAt,
      ttlMs: options.leaseTtlMs,
      command: options.command,
    });
    try {
      const maxItems = Number.isFinite(options.maxItems) ? options.maxItems : queue.length;
      let processed = 0;
      for (const item of queue) {
        if (processed >= maxItems) break;
        if (!shouldProcess(item)) continue;
        const outcome = processQueueItem(root, item, provider, {
          allowNoChecks: options.allowNoChecks,
          deployCommand: options.deployCommand,
          dryRun: options.dryRun,
          mergeMode: options.mergeMode || 'serial',
          requireFreshReadiness: options.requireFreshReadiness,
          write: options.write,
        }, generatedAt);
        events.push(...outcome.events);
        processed += 1;
        if (outcome.stop) break;
      }
    } finally {
      releaseLease(root, lease);
    }
  }

  if (options.write !== false && !options.dryRun) writeQueue(root, queue);
  const result = {
    generatedAt,
    projectRoot: root,
    mode,
    dryRun: options.dryRun === true,
    queuePath: normalizePath(path.relative(root, stewardPaths.queuePath)),
    queue,
    events,
    lease,
    reportPath: null,
  };
  if (options.write !== false && !options.dryRun) {
    result.reportPath = writeRunReport(root, result);
  }
  return result;
}

module.exports = {
  acquireLease,
  activeLease,
  createGhProvider,
  createRepairTask,
  gateStatus,
  itemId,
  normalizeCandidate,
  normalizeCheck,
  normalizePath,
  normalizePrDetails,
  parseGitHubPr,
  parseReadinessReport,
  paths,
  processQueueItem,
  readLease,
  readQueue,
  readReadinessReports,
  releaseLease,
  renderReport,
  runDeploySteward,
  scanReadinessCandidates,
  splitCommand,
  summarizeChecks,
  upsertQueueItems,
  writeQueue,
  writeRunReport,
};

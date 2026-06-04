'use strict';

const { scopesOverlap } = require('../coordination/claims');

const SUCCESS_STATUSES = new Set(['complete', 'completed', 'done', 'success', 'validated', 'merge-ready', 'merged']);
const MERGED_STATUSES = new Set(['merged']);
const RUNNABLE_STATUSES = new Set(['pending', 'queued', 'ready']);
const MERGE_CANDIDATE_STATUSES = new Set(['complete', 'completed', 'done', 'success', 'validated', 'merge-ready']);

function normalizeHeader(value) {
  const clean = String(value || '').toLowerCase().replace(/[^a-z0-9#]/g, '');
  if (clean === '#' || clean === 'id' || clean === 'number') return 'id';
  if (clean === 'campaign' || clean === 'campaignname' || clean === 'name') return 'campaign';
  if (clean === 'scope' || clean === 'scopes') return 'scope';
  if (clean === 'deps' || clean === 'dependencies' || clean === 'dependency') return 'deps';
  if (clean === 'status' || clean === 'state') return 'status';
  if (clean === 'wave') return 'wave';
  if (clean === 'agent' || clean === 'agenttype') return 'agent';
  if (clean === 'branch') return 'branch';
  if (clean === 'evidence' || clean === 'notes' || clean === 'note') return 'evidence';
  return clean;
}

function splitCells(row) {
  return String(row || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparatorRow(row) {
  return splitCells(row).every((cell) => /^:?-{2,}:?$/.test(cell));
}

function normalizeStatus(status) {
  return String(status || 'pending').trim().toLowerCase() || 'pending';
}

function parseList(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(-|none|n\/a)$/i.test(raw)) return [];
  return raw.split(/[,;]+/).map((item) => item.trim()).filter(Boolean);
}

function parseDeps(value) {
  return parseList(value).map((dep) => dep.replace(/^#/, '').trim()).filter(Boolean);
}

function parseWave(value) {
  const number = Number.parseInt(String(value || '').replace(/^wave\s*/i, ''), 10);
  return Number.isFinite(number) ? number : null;
}

function taskId(task) {
  return String(task.id || '').replace(/^#/, '').trim();
}

function parseWorkQueue(content) {
  const lines = String(content || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Work Queue\s*$/i.test(line.trim()));
  if (start === -1) return [];

  const tableLines = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line.trim())) break;
    if (line.trim().startsWith('|')) tableLines.push(line);
  }

  const headerLine = tableLines.find((line) => !isSeparatorRow(line));
  if (!headerLine) return [];

  const headers = splitCells(headerLine).map(normalizeHeader);
  return tableLines
    .slice(tableLines.indexOf(headerLine) + 1)
    .filter((line) => !isSeparatorRow(line))
    .map((line) => {
      const cells = splitCells(line);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] || '';
      });

      return {
        id: taskId({ id: row.id }),
        campaign: row.campaign || '',
        scope: parseList(row.scope),
        deps: parseDeps(row.deps),
        status: normalizeStatus(row.status),
        wave: parseWave(row.wave),
        agent: row.agent || '',
        branch: row.branch || '',
        evidence: row.evidence || '',
      };
    })
    .filter((task) => task.id);
}

function formatList(items) {
  return items && items.length ? items.join(', ') : 'none';
}

function formatWave(wave) {
  return wave === null || wave === undefined ? '-' : String(wave);
}

function serializeWorkQueue(tasks) {
  const rows = [
    '| # | Campaign | Scope | Deps | Status | Wave | Agent | Branch | Evidence |',
    '|---|----------|-------|------|--------|------|-------|--------|----------|',
  ];

  for (const task of tasks) {
    rows.push([
      task.id || '',
      task.campaign || '',
      formatList(task.scope),
      formatList(task.deps),
      normalizeStatus(task.status),
      formatWave(task.wave),
      task.agent || '-',
      task.branch || '-',
      task.evidence || '-',
    ].map((cell) => String(cell).replace(/\|/g, '/')).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  return rows.join('\n');
}

function updateWorkQueue(content, tasks) {
  const lines = String(content || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Work Queue\s*$/i.test(line.trim()));
  const replacement = ['## Work Queue', serializeWorkQueue(tasks)];
  if (start === -1) {
    return `${String(content || '').replace(/\s*$/, '')}\n\n${replacement.join('\n')}\n`;
  }

  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end].trim())) end++;
  return [
    ...lines.slice(0, start),
    ...replacement,
    ...lines.slice(end),
  ].join('\n');
}

function buildTaskMap(tasks) {
  const map = new Map();
  for (const task of tasks) map.set(taskId(task), task);
  return map;
}

function dependencyStatus(task, taskMap) {
  const blockers = [];
  for (const dep of task.deps || []) {
    const target = taskMap.get(String(dep));
    if (!target) {
      blockers.push({ dep: String(dep), status: 'missing', reason: 'dependency is not in the work queue' });
      continue;
    }

    const status = normalizeStatus(target.status);
    if (!SUCCESS_STATUSES.has(status)) {
      blockers.push({ dep: String(dep), status, reason: 'dependency is not complete' });
    }
  }
  return blockers;
}

function isRunnable(task, taskMap = null) {
  const status = normalizeStatus(task.status);
  if (!RUNNABLE_STATUSES.has(status)) return false;
  return dependencyStatus(task, taskMap || new Map()).length === 0;
}

function getReadyTasks(tasks) {
  const taskMap = buildTaskMap(tasks);
  return tasks.filter((task) => isRunnable(task, taskMap));
}

function getBlockedTasks(tasks) {
  const taskMap = buildTaskMap(tasks);
  return tasks
    .filter((task) => RUNNABLE_STATUSES.has(normalizeStatus(task.status)))
    .map((task) => ({ task, blockers: dependencyStatus(task, taskMap) }))
    .filter((entry) => entry.blockers.length > 0);
}

function validateMergeOrder(task, tasks, options = {}) {
  const taskMap = buildTaskMap(tasks);
  const candidate = typeof task === 'object' ? task : taskMap.get(String(task));
  if (!candidate) {
    return { ok: false, blockers: [{ dep: String(task), status: 'missing', reason: 'candidate is not in the work queue' }] };
  }

  const blockers = [];
  for (const dep of candidate.deps || []) {
    const target = taskMap.get(String(dep));
    if (!target) {
      blockers.push({ dep: String(dep), status: 'missing', reason: 'dependency is not in the work queue' });
      continue;
    }

    const status = normalizeStatus(target.status);
    const accepted = options.allowCompletedDependencies
      ? SUCCESS_STATUSES.has(status)
      : MERGED_STATUSES.has(status);
    if (!accepted) {
      blockers.push({
        dep: String(dep),
        status,
        reason: options.allowCompletedDependencies ? 'dependency is not complete' : 'dependency has not been merged',
      });
    }
  }

  return { ok: blockers.length === 0, blockers };
}

function getMergeCandidates(tasks) {
  return tasks
    .filter((task) => MERGE_CANDIDATE_STATUSES.has(normalizeStatus(task.status)))
    .map((task) => ({ task, merge: validateMergeOrder(task, tasks) }))
    .filter((entry) => entry.merge.ok)
    .map((entry) => entry.task);
}

function getScopeConflicts(tasks) {
  const conflicts = [];
  const byWave = new Map();
  for (const task of tasks) {
    if (task.wave === null || task.wave === undefined) continue;
    const entries = byWave.get(task.wave) || [];
    entries.push(task);
    byWave.set(task.wave, entries);
  }

  for (const [wave, entries] of byWave.entries()) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (scopesOverlap(entries[i].scope || [], entries[j].scope || [])) {
          conflicts.push({ wave, left: entries[i], right: entries[j] });
        }
      }
    }
  }

  return conflicts;
}

function nextTaskId(tasks) {
  const max = tasks.reduce((highest, task) => {
    const id = Number.parseInt(taskId(task), 10);
    return Number.isFinite(id) ? Math.max(highest, id) : highest;
  }, 0);
  return String(max + 1);
}

function createRepairTask(tasks, failedTask, reason) {
  const wave = Number.isFinite(failedTask.wave) ? failedTask.wave + 1 : null;
  const inheritedDeps = (failedTask.deps || []).slice();
  return {
    id: nextTaskId(tasks),
    campaign: `${failedTask.campaign || `Task ${taskId(failedTask)}`} repair`,
    scope: (failedTask.scope || []).slice(),
    deps: inheritedDeps,
    status: 'pending',
    wave,
    agent: failedTask.agent || 'repair',
    branch: '',
    evidence: `Repairs #${taskId(failedTask)}${reason ? `: ${reason}` : ''}`,
  };
}

function summarizeSession(content) {
  const tasks = parseWorkQueue(content);
  return {
    tasks,
    ready: getReadyTasks(tasks),
    blocked: getBlockedTasks(tasks),
    mergeCandidates: getMergeCandidates(tasks),
    scopeConflicts: getScopeConflicts(tasks),
  };
}

module.exports = {
  createRepairTask,
  dependencyStatus,
  getBlockedTasks,
  getMergeCandidates,
  getReadyTasks,
  getScopeConflicts,
  isRunnable,
  normalizeStatus,
  parseWorkQueue,
  serializeWorkQueue,
  summarizeSession,
  updateWorkQueue,
  validateMergeOrder,
};

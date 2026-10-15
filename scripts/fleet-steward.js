#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  createRepairTask,
  evaluateMergeCandidates,
  getBlockedTasks,
  getReadyTasks,
  getScopeConflicts,
  parseWorkQueue,
  serializeWorkQueue,
  updateWorkQueue,
} = require('../core/fleet/session');
const { authorizeDecision } = require('../core/governance');
const { listReadinessReports, matchReadiness } = require('../core/worktree/readiness');
const { buildIntegrationPlan } = require('../core/fleet/integration-queue');

function parseArgs(argv) {
  const unknown = [];
  const args = {
    projectRoot: process.cwd(),
    recent: 10,
    json: false,
    plan: argv.slice(2).includes('--plan'),
    write: false,
    overrideReadiness: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--project-root' || key === '--session') {
      if (!value || value.startsWith('--')) args.planError = `${key} requires a value.`;
      else { args[key === '--session' ? 'session' : 'projectRoot'] = key === '--session' ? value : path.resolve(value); i++; }
    }
    else if (key === '--recent') { args.recent = Number.parseInt(value, 10); i++; }
    else if (key === '--mark-failed') { args.markFailed = String(value || '').replace(/^#/, ''); i++; }
    else if (key === '--reason') { args.reason = value || ''; i++; }
    else if (key === '--json') args.json = true;
    else if (key === '--write') args.write = true;
    else if (key === '--override-readiness') args.overrideReadiness = true;
    else if (key === '--plan') args.plan = true;
    else if (key === '--base') {
      if (!value || value.startsWith('--')) args.planError = '--base requires a local ref or full commit OID.';
      else { args.base = value; i++; }
    }
    else if (key === '--help' || key === '-h') args.help = true;
    else unknown.push(key);
  }

  if (args.plan && unknown.length) args.planError = `Unknown plan argument: ${unknown[0]}`;

  return args;
}

function usage() {
  return [
    'Usage: node scripts/fleet-steward.js [--session path] [--json]',
    '       node scripts/fleet-steward.js --session path --mark-failed 2 --reason "why" --write',
    '       node scripts/fleet-steward.js --session path --plan --base refs/heads/main [--json]',
    '',
    'Reads a Fleet session markdown work queue and reports runnable tasks,',
    'blocked tasks, readiness blockers, merge candidates, and same-wave scope conflicts.',
    '',
    'Writes only when --write is paired with --mark-failed.',
    'Plan mode reads local Git refs and existing governance evidence only; no fetch or merge.',
    'It rejects repair/write/override flags. Recompute after every base or candidate change.',
    'Each required gate observation must include the plan entry requiredEvidenceDigest',
    'in artifact_digests to bind its proof to the exact base and candidate commits.',
  ].join('\n');
}

function latestSession(projectRoot) {
  const dir = path.join(projectRoot, '.planning', 'fleet');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((file) => /^session-.*\.md$/i.test(file))
    .map((file) => {
      const fullPath = path.join(dir, file);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files.length ? files[0].fullPath : null;
}

function resolveSessionPath(args) {
  if (args.session) {
    return path.resolve(args.projectRoot, args.session);
  }
  return latestSession(args.projectRoot);
}

function taskLabel(task) {
  return `#${task.id} ${task.campaign || '(unnamed)'} [${task.status}]`;
}

function renderList(title, rows, emptyText) {
  const output = [title];
  if (!rows.length) {
    output.push(`  ${emptyText}`);
    return output.join('\n');
  }
  for (const row of rows) output.push(`  - ${row}`);
  return output.join('\n');
}

function analyzeTasks(tasks, options = {}) {
  const readinessReports = options.readinessReports || [];
  const readyWithReadiness = [];
  const readinessBlocked = [];
  for (const task of getReadyTasks(tasks)) {
    const readiness = matchReadiness(task, readinessReports);
    if (readiness && readiness.blockFleet && !options.overrideReadiness) {
      readinessBlocked.push({ task, readiness });
    } else {
      readyWithReadiness.push({ ...task, readiness });
    }
  }

  const blocked = getBlockedTasks(tasks);
  const authorize = options.authorize || (options.projectRoot
    ? (_task, authority, disposition) => authorizeDecision(
      options.projectRoot,
      authority,
      disposition,
    )
    : null);
  const mergeAssessments = evaluateMergeCandidates(tasks, {
    authorize,
    sessionId: options.sessionId,
  });
  const mergeBlocked = mergeAssessments.filter((entry) => !entry.merge.ok);
  const governanceBlocked = mergeAssessments
    .filter((entry) => entry.merge.ok && entry.governance?.authorized !== true);

  return {
    count: tasks.length,
    ready: readyWithReadiness,
    blocked,
    readinessBlocked,
    mergeCandidates: mergeAssessments
      .filter((entry) => entry.merge.ok && entry.governance?.authorized === true)
      .map((entry) => entry.task),
    mergeBlocked,
    governanceBlocked,
    scopeConflicts: getScopeConflicts(tasks),
  };
}

function renderReport(snapshot) {
  const lines = [];
  lines.push('Fleet Steward');
  lines.push('='.repeat(40));
  lines.push(`Session: ${snapshot.sessionPath || '(none found)'}`);
  lines.push(`Tasks:   ${snapshot.analysis.count}`);
  lines.push('');

  lines.push(renderList(
    'READY TO RUN',
    snapshot.analysis.ready.map((task) => `${taskLabel(task)} - wave ${task.wave || '-'} - scope ${task.scope.join(', ') || 'none'}`),
    'No runnable pending tasks.'
  ));
  lines.push('');

  lines.push(renderList(
    'READINESS BLOCKED',
    snapshot.analysis.readinessBlocked.map((entry) => {
      const reason = (entry.readiness.checks || [])
        .filter((check) => check.status === 'fail')
        .map((check) => check.detail)
        .join('; ');
      return `${taskLabel(entry.task)} blocked by ${entry.readiness.status} worktree readiness${reason ? ` - ${reason}` : ''}`;
    }),
    'No readiness-blocked ready tasks.'
  ));
  lines.push('');

  lines.push(renderList(
    'BLOCKED',
    snapshot.analysis.blocked.map((entry) => {
      const blockers = entry.blockers.map((blocker) => `#${blocker.dep} ${blocker.status}`).join(', ');
      return `${taskLabel(entry.task)} waits for ${blockers}`;
    }),
    'No dependency-blocked tasks.'
  ));
  lines.push('');

  lines.push(renderList(
    'MERGE NEXT',
    snapshot.analysis.mergeCandidates.map((task) => `${taskLabel(task)} - branch ${task.branch || '-'}`),
    'No merge-ready tasks with satisfied merge order.'
  ));
  lines.push('');

  lines.push(renderList(
    'MERGE BLOCKED',
    snapshot.analysis.mergeBlocked.map((entry) => {
      const blockers = entry.merge.blockers.map((blocker) => `#${blocker.dep} ${blocker.status}`).join(', ');
      return `${taskLabel(entry.task)} waits for merged dependencies: ${blockers}`;
    }),
    'No merge-order blockers.'
  ));
  lines.push('');

  lines.push(renderList(
    'GOVERNANCE BLOCKED',
    snapshot.analysis.governanceBlocked.map((entry) => {
      const code = entry.governance?.authorization_code || 'GOVERNANCE_AUTHORITY_INVALID';
      return `${taskLabel(entry.task)} - ${code} - subject ${entry.authority.id}`;
    }),
    'No governance-blocked merge candidates.'
  ));
  lines.push('');

  lines.push(renderList(
    'SCOPE CONFLICTS',
    snapshot.analysis.scopeConflicts.map((conflict) => {
      return `Wave ${conflict.wave}: #${conflict.left.id} overlaps #${conflict.right.id}`;
    }),
    'No same-wave write-scope conflicts.'
  ));

  if (snapshot.repair) {
    lines.push('');
    lines.push('REPAIR TASK');
    lines.push(`  ${snapshot.wrote ? 'Wrote' : 'Preview'} #${snapshot.repair.id}: ${snapshot.repair.campaign}`);
  }

  lines.push('');
  lines.push('QUICK COMMANDS');
  lines.push('  node scripts/fleet-steward.js --session <file> --json');
  lines.push('  node scripts/fleet-steward.js --session <file> --mark-failed <id> --reason "<why>" --write');

  return lines.join('\n');
}

function collect(args) {
  // Keep this branch before the legacy repair path: --plan must never write,
  // including when accidentally combined with mutation or override flags.
  if (args.plan) return collectPlan(args);
  const sessionPath = resolveSessionPath(args);
  const sessionId = sessionPath
    ? path.basename(sessionPath, path.extname(sessionPath))
    : 'fleet-session';
  if (!sessionPath || !fs.existsSync(sessionPath)) {
    return {
      sessionPath,
      tasks: [],
      analysis: analyzeTasks([], { projectRoot: args.projectRoot, sessionId }),
      readinessReports: [],
      repair: null,
      wrote: false,
      error: 'No fleet session file found.',
    };
  }

  const original = fs.readFileSync(sessionPath, 'utf8');
  const tasks = parseWorkQueue(original);
  const readinessReports = listReadinessReports(args.projectRoot);
  let repair = null;
  let wrote = false;

  if (args.markFailed) {
    const failed = tasks.find((task) => task.id === args.markFailed);
    if (!failed) {
      return {
        sessionPath,
        tasks,
        analysis: analyzeTasks(tasks, {
          readinessReports,
          overrideReadiness: args.overrideReadiness,
          projectRoot: args.projectRoot,
          sessionId,
        }),
        readinessReports,
        repair,
        wrote,
        error: `Task #${args.markFailed} was not found.`,
      };
    }

    failed.status = 'failed';
    failed.evidence = args.reason ? `${failed.evidence && failed.evidence !== '-' ? `${failed.evidence}; ` : ''}${args.reason}` : failed.evidence;
    repair = createRepairTask(tasks, failed, args.reason || '');
    tasks.push(repair);

    if (args.write) {
      fs.writeFileSync(sessionPath, updateWorkQueue(original, tasks));
      wrote = true;
    }
  }

  return {
    sessionPath,
    tasks,
    analysis: analyzeTasks(tasks, {
      readinessReports,
      overrideReadiness: args.overrideReadiness,
      projectRoot: args.projectRoot,
      sessionId,
    }),
    readinessReports,
    repair,
    wrote,
    table: serializeWorkQueue(tasks),
  };
}

function resolveCommit(projectRoot, ref) {
  // Accept only a plain named ref or a full OID, never revision expressions,
  // options or shell syntax. execFileSync also avoids invoking a shell.
  if (typeof ref !== 'string' || !ref || ref === '-' || ref.length > 1024
    || /[\x00-\x20\x7f]/.test(ref)
    || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(ref)
    || ref.includes('..') || ref.includes('//') || ref.endsWith('/') || ref.endsWith('.lock')) return null;
  try {
    const oid = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
      cwd: projectRoot, encoding: 'utf8', timeout: 10000,
      maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
    }).trim();
    return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid) ? { ref, oid } : null;
  } catch {
    return null;
  }
}

function collectPlan(args) {
  const failure = (message) => ({ kind: 'fleet-integration-plan', readOnly: true, error: message, next: null, entries: [] });
  if (args.planError) return failure(args.planError);
  if (args.write || args.markFailed !== undefined || args.reason !== undefined || args.overrideReadiness) {
    return failure('--plan cannot be combined with --write, --mark-failed, --reason or --override-readiness.');
  }
  if (!args.base) return failure('--plan requires an explicit --base local ref or full commit OID.');
  try {
    const sessionPath = resolveSessionPath(args);
    if (!sessionPath || !fs.existsSync(sessionPath)) return failure('No fleet session file found.');
    const tasks = parseWorkQueue(fs.readFileSync(sessionPath, 'utf8'));
    const refs = new Map();
    const resolve = (ref) => {
      if (!refs.has(ref)) refs.set(ref, resolveCommit(args.projectRoot, ref));
      return refs.get(ref);
    };
    const base = resolve(args.base);
    const candidates = tasks.map((task) => ({ taskId: task.id, ...(resolve(task.branch) || { ref: task.branch, oid: null }) }));
    const plan = buildIntegrationPlan(tasks, {
      projectRoot: args.projectRoot,
      sessionId: path.basename(sessionPath, path.extname(sessionPath)),
      base, candidates,
    });
    // Detect movement during collection too. A saved plan is still only a
    // snapshot; it must be recomputed immediately before any separate action.
    if ([...refs].some(([ref, initial]) => resolveCommit(args.projectRoot, ref)?.oid !== initial?.oid)) {
      return failure('Local Git refs changed while planning; rerun --plan.');
    }
    if (!base) return { ...plan, error: 'Base ref could not be resolved to a local commit.' };
    return plan;
  } catch (error) {
    return failure(`Cannot build integration plan: ${error.message}`);
  }
}

function renderPlan(plan) {
  const lines = ['Fleet Integration Plan (read-only)', `Base: ${plan.base ? `${plan.base.ref} ${plan.base.oid}` : '(unresolved)'}`];
  if (plan.error) lines.push(`Error: ${plan.error}`);
  lines.push(`Next eligible: ${plan.next ? `#${plan.next}` : 'none'}`);
  for (const entry of plan.entries) {
    lines.push(`  #${entry.taskId} ${entry.status}: ${entry.candidate?.oid || '(unresolved)'}`);
    for (const blocker of entry.blockers) lines.push(`    ${blocker.code}${blocker.taskId ? ` #${blocker.taskId}` : ''}`);
    if (entry.requiredEvidenceDigest) lines.push(`    Required evidence binding: ${entry.requiredEvidenceDigest}`);
  }
  if (plan.revalidation) lines.push(plan.revalidation);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help && !args.planError) {
    console.log(usage());
    return;
  }

  const snapshot = collect(args);
  if (args.plan) {
    console.log(args.json ? JSON.stringify(snapshot, null, 2) : renderPlan(snapshot));
    if (snapshot.error) process.exitCode = 1;
    return;
  }
  if (args.json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(renderReport(snapshot));
    if (snapshot.error && args.session) process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeTasks,
  collect,
  collectPlan,
  parseArgs,
  renderReport,
  renderPlan,
  resolveCommit,
  usage,
};

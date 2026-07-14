#!/usr/bin/env node

'use strict';

/**
 * dashboard-server.js -- Citadel local Mission Control dashboard.
 *
 * Serves the project's .planning state and telemetry as normalized JSON
 * endpoints plus a static single-page UI, with SSE invalidation driven by
 * file watching. The files stay canonical: this server is a view, never a
 * second source of truth. Design contract lives in docs/DASHBOARD_SPEC.md.
 *
 * Usage:
 *   node scripts/dashboard-server.js [--port 4180] [--project-root <path>] [--open]
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { collectDashboard } = require('./dashboard');
const { listLoops } = require('../core/loops/registry');
const { report: activationReport } = require('../core/telemetry/activation');
const {
  fixedProjectRoot,
  listOperations,
  readOperation,
  submitIntent,
  validateControlResult,
} = require('../core/operations/intents');
const {
  applySelection,
  buildProofReport,
  compareFork,
  executorStates,
  forkEvidence,
  listForks,
  loadFork,
  readEvents,
} = require('../core/forks');

const DEFAULT_PORT = 4180;
const BIND_HOST = '127.0.0.1';
const SNAPSHOT_TTL_MS = 5000;
const WATCH_DEBOUNCE_MS = 300;
const WATCH_POLL_FALLBACK_MS = 2000;
const SSE_HEARTBEAT_MS = 25000;
const RECENT_LIMIT = 25;
const INTENT_BODY_LIMIT = 16 * 1024;
const STATIC_DIR = path.join(__dirname, '..', 'dashboard');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const options = {
    projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    port: DEFAULT_PORT,
    open: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') {
      const parsed = Number(argv[++i]);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) options.port = parsed;
    } else if (arg === '--project-root') {
      options.projectRoot = path.resolve(argv[++i]);
    } else if (arg === '--open') {
      options.open = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/dashboard-server.js [--port 4180] [--project-root <path>] [--open]',
    '',
    'Serves local Mission Control over canonical .planning/ state.',
    'Binds to 127.0.0.1 only. See docs/DASHBOARD_SPEC.md.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Data collection (cached, invalidated by watcher or TTL)
// ---------------------------------------------------------------------------

function createDataSource(projectRoot) {
  const state = { cache: null, collectedAt: 0, dirty: true };

  function readHandoffs() {
    const dir = path.join(projectRoot, '.planning', 'handoffs');
    try {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith('.md'))
        .filter((name) => {
          try {
            const stat = fs.lstatSync(path.join(dir, name));
            return stat.isFile() && !stat.isSymbolicLink();
          } catch { return false; }
        })
        .sort((a, b) => b.localeCompare(a))
        .slice(0, 50)
        .map((name) => {
          const filePath = path.join(dir, name);
          let modifiedAt = null;
          try { modifiedAt = fs.statSync(filePath).mtime.toISOString(); } catch { /* render as unknown */ }
          return { name, path: `.planning/handoffs/${name}`, modifiedAt };
        })
        .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)) || b.name.localeCompare(a.name));
    } catch {
      return [];
    }
  }

  function readDaemon() {
    try {
      const raw = fs.readFileSync(path.join(projectRoot, '.planning', 'daemon.json'), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function collect(options = {}) {
    let snapshot;
    let collectError = null;
    try {
      snapshot = collectDashboard({
        projectRoot,
        recentLimit: RECENT_LIMIT,
        gitStatus: options.reuseGitStatus && state.cache && state.cache.snapshot
          ? state.cache.snapshot.gitStatus : undefined,
      });
    } catch (error) {
      collectError = String(error && error.message ? error.message : error);
      snapshot = null;
    }
    let loops = [];
    try {
      loops = listLoops(projectRoot) || [];
    } catch { /* loops panel renders empty with a note */ }
    const collected = {
      snapshot,
      collectError,
      loops,
      daemon: readDaemon(),
      handoffs: readHandoffs(),
      operations: readOperationControls(projectRoot),
      forks: readOperationForks(projectRoot),
    };
    collected.sources = inspectSources(projectRoot, collected);
    collected.activation = readActivation(projectRoot, collected.sources.activation);
    return collected;
  }

  return {
    get() {
      const now = Date.now();
      if (state.dirty || !state.cache || now - state.collectedAt > SNAPSHOT_TTL_MS) {
        state.cache = collect({ reuseGitStatus: state.dirty && Boolean(state.cache) });
        state.collectedAt = now;
        state.dirty = false;
      }
      return state.cache;
    },
    invalidate() {
      state.dirty = true;
    },
  };
}

function readOperationForks(projectRoot) {
  try {
    return listForks(projectRoot).map((summary) => {
      const unreadable = { ...summary, executors: [], proof: null, comparison: {
        outcome: 'insufficient-evidence', recommendation: null, comparable_count: 0, branches: [],
      } };
      if (summary.status === 'unknown') return unreadable;
      try {
        // Mission Control never trusts the stored record: every wrapper and
        // binding is reloaded and verified before a fact is displayed.
        const fork = loadFork(projectRoot, summary.fork_id);
        const evidence = forkEvidence(projectRoot, fork);
        const proof = buildProofReport(fork, readEvents(projectRoot, fork.fork_id), { evidence });
        return { ...summary, comparison: compareFork(fork, { evidence }),
          executors: executorStates(projectRoot, fork),
          proof: { digest: proof.digest, summary: proof.report.summary } };
      } catch (error) {
        return { ...unreadable, status: 'unknown', reason_code: error.code || 'FORK_EVIDENCE_UNVERIFIABLE' };
      }
    });
  } catch {
    return [];
  }
}

function readOperationControls(projectRoot) {
  try {
    const pending = readPendingIntents(projectRoot);
    const listed = listOperations(projectRoot);
    return listed.operations.map((summary) => {
      if (summary.status === 'unknown') return summary;
      const state = readOperation(projectRoot, summary.operation_id);
      return state.operation ? {
        operation_id: state.operation.spec.operation_id,
        title: state.operation.spec.title,
        revision: state.operation.revision,
        status: state.operation.run.status,
        capabilities: [...state.operation.capabilities],
        pending_intent: pending.get(state.operation.spec.operation_id) || null,
      } : { ...summary, title: summary.operation_id };
    });
  } catch {
    return [];
  }
}

function readPendingIntents(projectRoot) {
  const intents = new Map();
  const directory = path.join(projectRoot, '.planning', 'intents', 'pending');
  try {
    if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) return intents;
    const realRoot = fs.realpathSync(projectRoot);
    const realDirectory = fs.realpathSync(directory);
    if (escapesRoot(realRoot, realDirectory)) return intents;
    for (const name of fs.readdirSync(realDirectory).filter((entry) => entry.endsWith('.json')).sort()) {
      const file = path.join(realDirectory, name);
      if (fs.lstatSync(file).isSymbolicLink()) continue;
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      const intent = record.protocol_intent;
      if (!intent || record.result?.outcome !== 'accepted' || typeof record.capability !== 'string') continue;
      intents.set(intent.operation_id, { intent_id: intent.intent_id, action: record.capability });
    }
  } catch {
    return new Map();
  }
  return intents;
}

function source(pathname, status, detail, count = null, unreadable = []) {
  return { path: pathname.replace(/\\/g, '/'), status, detail, count, unreadable };
}

function inspectDirectory(projectRoot, relativeDir, options = {}) {
  const absolute = path.join(projectRoot, relativeDir);
  if (!fs.existsSync(absolute)) return source(relativeDir, 'unknown', 'source is absent');
  let names;
  try {
    names = fs.readdirSync(absolute).filter((name) => !options.filter || options.filter(name));
  } catch (error) {
    return source(relativeDir, 'unreadable', error.message, null, [relativeDir]);
  }
  if (names.length === 0) return source(relativeDir, 'empty', 'source exists and is empty', 0);
  const unreadable = [];
  if (options.json) {
    for (const name of names) {
      try { JSON.parse(fs.readFileSync(path.join(absolute, name), 'utf8')); }
      catch { unreadable.push(`${relativeDir}/${name}`.replace(/\\/g, '/')); }
    }
  }
  if (options.jsonl) {
    for (const name of names) {
      let lines;
      try { lines = fs.readFileSync(path.join(absolute, name), 'utf8').split(/\r?\n/).filter(Boolean); }
      catch { unreadable.push(`${relativeDir}/${name}`.replace(/\\/g, '/')); continue; }
      if (lines.some((line) => { try { JSON.parse(line); return false; } catch { return true; } })) {
        unreadable.push(`${relativeDir}/${name}`.replace(/\\/g, '/'));
      }
    }
  }
  if (unreadable.length) return source(relativeDir, 'unreadable', `${unreadable.length} file(s) could not be parsed`, names.length, unreadable);
  return source(relativeDir, options.midRun ? 'mid-run' : 'healthy', options.midRun ? 'work is active' : 'source is readable', names.length);
}

function inspectFile(projectRoot, relativePath, options = {}) {
  const absolute = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolute)) return source(relativePath, 'unknown', 'source is absent');
  try {
    const raw = fs.readFileSync(absolute, 'utf8');
    if (!raw.trim()) return source(relativePath, 'empty', 'source exists and is empty', 0);
    if (options.json) {
      const value = JSON.parse(raw);
      if (options.schema && value.schema !== options.schema) throw new Error(`expected schema ${options.schema}`);
    }
    return source(relativePath, 'healthy', 'source is readable', 1);
  } catch (error) {
    return source(relativePath, 'unreadable', error.message, null, [relativePath]);
  }
}

function inspectSources(projectRoot, data) {
  const planningExists = fs.existsSync(path.join(projectRoot, '.planning'));
  if (!planningExists) {
    const missing = (name, pathname) => [name, source(pathname, 'unknown', '.planning is absent')];
    return Object.fromEntries([
      missing('campaigns', '.planning/campaigns'), missing('fleet', '.planning/fleet'),
      missing('forks', '.planning/operation-forks'),
      missing('loops', '.planning/loops'), missing('hooks', '.planning/telemetry'),
      missing('handoffs', '.planning/handoffs'), missing('cost', '.planning/telemetry'),
      missing('activation', '.planning/product-proof/activation-report.json'),
    ]);
  }

  const campaignState = inspectDirectory(projectRoot, '.planning/campaigns', {
    filter: (name) => name.endsWith('.md'), midRun: Boolean(data.snapshot && data.snapshot.campaigns && data.snapshot.campaigns.length),
  });
  if (data.snapshot && data.snapshot.skippedCampaigns && data.snapshot.skippedCampaigns.length) {
    campaignState.status = 'unreadable';
    campaignState.detail = `${data.snapshot.skippedCampaigns.length} campaign file(s) could not be parsed`;
    campaignState.unreadable = data.snapshot.skippedCampaigns.map((item) => path.relative(projectRoot, item.filePath).replace(/\\/g, '/'));
  }
  const fleetState = inspectDirectory(projectRoot, '.planning/fleet', {
    filter: (name) => /^session-.*\.md$/i.test(name), midRun: Boolean(data.snapshot && data.snapshot.fleetSessions && data.snapshot.fleetSessions.length),
  });
  const forksState = inspectDirectory(projectRoot, '.planning/operation-forks', {
    filter: (name) => !name.startsWith('.'), midRun: (data.forks || []).some((fork) => ['pending', 'running'].includes(fork.status)),
  });
  const loopsState = inspectDirectory(projectRoot, '.planning/loops', {
    filter: (name) => name.endsWith('.json'), json: true,
    midRun: (data.loops || []).some((loop) => !['done', 'stopped', 'verifier-passed'].includes(loop.status || (loop.state && loop.state.status))),
  });
  const hooksState = inspectDirectory(projectRoot, '.planning/telemetry', {
    filter: (name) => /^(hook-timing|hook-errors|audit|agent-runs|task-events)\.jsonl$/.test(name), jsonl: true,
  });
  const handoffsState = inspectDirectory(projectRoot, '.planning/handoffs', { filter: (name) => name.endsWith('.md') });
  const cost = data.snapshot && data.snapshot.cost;
  const costFileState = inspectDirectory(projectRoot, '.planning/telemetry', {
    filter: (name) => name === 'session-costs.jsonl', jsonl: true,
  });
  const costState = costFileState.status === 'unreadable' ? costFileState
    : cost && (cost.session_count > 0 || cost.real_sessions > 0)
      ? source('.planning/telemetry/session-costs.jsonl', 'healthy', cost.data_source || 'telemetry available', cost.session_count || cost.real_sessions)
      : source('.planning/telemetry/session-costs.jsonl', 'unknown', 'no cost telemetry is available');
  let activationState = inspectFile(projectRoot, '.planning/product-proof/activation-report.json', { json: true, schema: 1 });
  if (activationState.status === 'unknown') {
    activationState = inspectFile(projectRoot, '.planning/product-proof/activation-cohort-report.json', { json: true, schema: 1 });
  }
  if (activationState.status === 'unknown') {
    activationState = inspectDirectory(projectRoot, '.planning/telemetry', {
      filter: (name) => name === 'activation.jsonl', jsonl: true,
    });
    if (activationState.status === 'empty') activationState = source('.planning/telemetry/activation.jsonl', 'unknown', 'source is absent');
  }
  return { campaigns: campaignState, fleet: fleetState, forks: forksState, loops: loopsState, hooks: hooksState, handoffs: handoffsState, cost: costState, activation: activationState };
}

function readActivation(projectRoot, state) {
  let cohort = null;
  let cohortNote = 'No shared cohort has been ingested yet.';
  const cohortPath = path.join(projectRoot, '.planning', 'product-proof', 'activation-cohort-report.json');
  if (fs.existsSync(cohortPath)) {
    try {
      cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
      if (cohort.schema !== 1 || cohort.kind !== 'activation_cohort_report') throw new Error('cohort report is not schema 1');
      cohortNote = 'Explicit, redacted submissions from the public product-proof cohort.';
    } catch (error) {
      cohortNote = `Shared cohort report is unreadable: ${error.message}`;
    }
  }
  if (!state || state.status === 'unknown') return { mode: cohort ? 'cohort_only' : 'unknown', note: 'No local activation report has been recorded.', report: null, cohort, cohort_note: cohortNote };
  if (state.status === 'unreadable') return { mode: 'unreadable', note: state.detail, report: null, cohort, cohort_note: cohortNote };
  try {
    const reportPath = path.join(projectRoot, '.planning', 'product-proof', 'activation-report.json');
    const value = fs.existsSync(reportPath)
      ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
      : activationReport(projectRoot);
    if (value.schema !== 1) throw new Error('activation report is not schema 1');
    return { mode: value.total_events > 0 ? 'healthy' : 'empty', note: value.total_events > 0 ? 'local, redacted activation evidence' : 'Activation telemetry is enabled but no events are recorded.', report: value, cohort, cohort_note: cohortNote };
  } catch (error) {
    state.status = 'unreadable';
    state.detail = error.message;
    return { mode: 'unreadable', note: error.message, report: null, cohort, cohort_note: cohortNote };
  }
}

// ---------------------------------------------------------------------------
// View derivations (snapshot -> per-endpoint payloads)
// ---------------------------------------------------------------------------

function deriveNeedsYou(data) {
  const items = [];
  const snapshot = data.snapshot;
  if (!snapshot) {
    items.push({
      kind: 'state', severity: 'danger', title: 'Dashboard state is unreadable',
      detail: data.collectError || 'collector returned no snapshot', age: 'now', evidence: null,
    });
    return items;
  }

  for (const state of Object.values(data.sources || {})) {
    if (state.status !== 'unreadable') continue;
    items.push({
      kind: 'source', severity: 'danger', title: `Unreadable: ${state.path}`,
      detail: state.detail, age: 'now', evidence: state.path,
    });
  }

  for (const problem of snapshot.problems || []) {
    if (problem.actionable) {
      items.push({
        kind: 'problem',
        severity: problem.severity || 'warn',
        title: problem.description || problem.category,
        detail: `${problem.hook || 'harness'} · ${problem.category}`,
        age: problem.relative || 'unknown',
        evidence: null,
      });
    }
  }

  const capsule = snapshot.operatorArtifacts && snapshot.operatorArtifacts.approvalCapsule;
  if (capsule && capsule.path && capsule.stale === false) {
    items.push({
      kind: 'approval',
      severity: 'action',
      title: capsule.request || 'Approval requested',
      detail: `risk: ${capsule.risk || 'unstated'} · boundary: ${capsule.boundary || 'unstated'}`,
      age: capsule.freshness || 'unknown',
      evidence: capsule.path,
    });
  }

  const pending = snapshot.pending || {};
  if (pending.mergeReviews > 0) {
    items.push({
      kind: 'merge-review',
      severity: 'action',
      title: `${pending.mergeReviews} fleet merge review${pending.mergeReviews === 1 ? '' : 's'} waiting`,
      detail: 'fleet merge queue',
      age: 'now',
      evidence: '.planning/fleet/',
    });
  }
  if (pending.intakeItems > 0) {
    items.push({
      kind: 'intake',
      severity: 'info',
      title: `${pending.intakeItems} intake item${pending.intakeItems === 1 ? '' : 's'} to triage`,
      detail: 'watch intake',
      age: 'now',
      evidence: '.planning/intake/',
    });
  }
  if (pending.docSync > 0) {
    items.push({
      kind: 'doc-sync',
      severity: 'info',
      title: `${pending.docSync} doc-sync item${pending.docSync === 1 ? '' : 's'} pending`,
      detail: 'doc drift queue',
      age: 'now',
      evidence: '.planning/doc-sync/',
    });
  }

  for (const loop of data.loops || []) {
    const status = loop.status || (loop.state && loop.state.status);
    if (status === 'needs-human-review' || status === 'blocked') {
      items.push({
        kind: 'loop',
        severity: 'action',
        title: `Loop ${loop.id || 'unknown'} is ${status}`,
        detail: loop.type || 'loop',
        age: 'now',
        evidence: `.planning/loops/${loop.id || ''}.json`,
      });
    }
  }

  return items;
}

function projectedCount(state, value) {
  return state && !['unknown', 'unreadable'].includes(state.status) ? value : null;
}

function projectionState(sources) {
  const values = Object.values(sources || {});
  if (values.some((item) => item.status === 'unreadable')) return 'unreadable';
  if (values.some((item) => item.status === 'mid-run')) return 'mid-run';
  if (values.length === 0 || values.every((item) => item.status === 'unknown')) return 'unknown';
  if (values.every((item) => ['empty', 'unknown'].includes(item.status))) return 'empty';
  return 'healthy';
}

function deriveViews(data) {
  const snapshot = data.snapshot || {};
  const sources = data.sources || {};
  const needsYou = deriveNeedsYou(data);
  const cost = snapshot.cost || null;
  const costUnavailable = !sources.cost || ['unknown', 'unreadable'].includes(sources.cost.status);
  const costMode = cost && !costUnavailable ? (cost.data_source || 'estimated') : 'unavailable';

  return {
    overview: {
      state: projectionState(sources),
      sources,
      project_root: snapshot.projectRoot || null,
      planning_exists: Boolean(snapshot.planningExists),
      collect_error: data.collectError,
      needs_you: needsYou,
      active: {
        campaigns: projectedCount(sources.campaigns, (snapshot.campaigns || []).length),
        fleet_sessions: projectedCount(sources.fleet, (snapshot.fleetSessions || []).length),
        forks: projectedCount(sources.forks, (data.forks || []).filter((fork) => !['landed', 'failed'].includes(fork.status)).length),
        loops: projectedCount(sources.loops, (data.loops || []).filter((loop) => {
          const status = loop.status || (loop.state && loop.state.status);
          return status && !['done', 'stopped', 'verifier-passed'].includes(status);
        }).length),
      },
      cost: cost ? { real: cost.real_total, estimated: cost.estimated_total, mode: costMode } : null,
      health: snapshot.health || null,
      next_action: snapshot.nextAction || null,
      problem_summary: snapshot.problemSummary || null,
    },
    campaigns: {
      state: sources.campaigns || source('.planning/campaigns', 'unknown', 'source state unavailable'),
      active: snapshot.campaigns || [],
      skipped: snapshot.skippedCampaigns || [],
      ledger: snapshot.outcomeLedger || [],
      operations: data.operations || [],
    },
    fleet: {
      state: sources.fleet || source('.planning/fleet', 'unknown', 'source state unavailable'),
      sessions: snapshot.fleetSessions || [],
      worktrees: snapshot.worktrees || [],
      coordination: snapshot.coordination || { instances: [], claims: [] },
      readiness: snapshot.worktreeReadiness || [],
    },
    forks: {
      state: sources.forks || source('.planning/operation-forks', 'unknown', 'source state unavailable'),
      forks: data.forks || [],
    },
    loops: {
      state: sources.loops || source('.planning/loops', 'unknown', 'source state unavailable'),
      loops: data.loops || [],
      daemon: data.daemon,
    },
    hooks: {
      state: sources.hooks || source('.planning/telemetry', 'unknown', 'source state unavailable'),
      feed: snapshot.hookActivity || [],
      value: snapshot.hookValue || null,
      overhead: snapshot.hookOverhead || [],
      blocks: (snapshot.problems || []).filter((problem) => problem.category === 'safety-block'),
    },
    cost: cost
      ? { ...cost, mode: costMode, state: sources.cost || source('.planning/telemetry', 'unknown', 'source state unavailable'), note: costUnavailable ? 'No cost telemetry is available; spend is unknown, not zero.' : null }
      : { mode: 'unavailable', state: sources.cost || source('.planning/telemetry', 'unknown', 'source state unavailable'), note: 'No telemetry found. Costs appear once sessions run with telemetry enabled.' },
    handoffs: {
      state: sources.handoffs || source('.planning/handoffs', 'unknown', 'source state unavailable'),
      handoffs: data.handoffs || [],
      recent_activity: snapshot.recentActivity || [],
    },
    activation: {
      state: sources.activation || source('.planning/product-proof/activation-report.json', 'unknown', 'source state unavailable'),
      ...(data.activation || { mode: 'unknown', note: 'Activation report is unavailable.', report: null }),
    },
  };
}

function envelope(data, sourceFiles = []) {
  return JSON.stringify({ schema: 1, generated_at: new Date().toISOString(), source_files: sourceFiles, data });
}

// ---------------------------------------------------------------------------
// Watching + SSE
// ---------------------------------------------------------------------------

function planningSignature(planningDir) {
  const entries = [];
  const visit = (directory) => {
    let children = [];
    try { children = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(planningDir, absolute).replace(/\\/g, '/');
      try {
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) {
          entries.push(`${relative}:symlink`);
        } else if (stat.isDirectory()) {
          entries.push(`${relative}:directory`);
          visit(absolute);
        } else if (stat.isFile()) {
          entries.push(`${relative}:file:${stat.size}:${stat.mtimeMs}`);
        }
      } catch { /* entry changed during scan; the next poll will settle it */ }
    }
  };
  visit(planningDir);
  return entries.join(';');
}

function startWatcher(projectRoot, onChange, options = {}) {
  const planningDir = path.join(projectRoot, '.planning');
  const watchImpl = options.watchImpl || fs.watch.bind(fs);
  const pollMs = options.pollMs || WATCH_POLL_FALLBACK_MS;
  const debounceMs = options.debounceMs || WATCH_DEBOUNCE_MS;
  let timer = null;
  let watcher = null;
  let interval = null;
  let stopped = false;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  const startPolling = () => {
    if (stopped || interval) return;
    let lastSignature = planningSignature(planningDir);
    interval = setInterval(() => {
      const signature = planningSignature(planningDir);
      if (signature !== lastSignature) {
        lastSignature = signature;
        fire();
      }
    }, pollMs);
    interval.unref?.();
  };
  try {
    watcher = watchImpl(planningDir, { recursive: true }, fire);
    watcher.on('error', () => {
      watcher?.close();
      watcher = null;
      startPolling();
    });
  } catch {
    // Recursive watch unsupported (notably Node 18 on Linux): poll the full tree.
    startPolling();
  }
  return () => {
    stopped = true;
    watcher?.close();
    if (interval) clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function safeStaticPath(urlPath) {
  const clean = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.normalize(path.join(STATIC_DIR, clean));
  const relative = path.relative(STATIC_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function escapesRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

function resolveEvidencePath(projectRoot, requested, fileSystem = fs) {
  try {
    const normalizedRequest = String(requested || '').replace(/\\/g, '/');
    if (!normalizedRequest.startsWith('.planning/')) return null;

    const planningRoot = path.resolve(projectRoot, '.planning');
    const target = path.resolve(projectRoot, normalizedRequest);
    if (escapesRoot(planningRoot, target)) return null;

    const rootStat = fileSystem.lstatSync(planningRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;

    const relativeParts = path.relative(planningRoot, target).split(path.sep).filter(Boolean);
    let cursor = planningRoot;
    for (const part of relativeParts) {
      cursor = path.join(cursor, part);
      const entryStat = fileSystem.lstatSync(cursor);
      if (entryStat.isSymbolicLink()) return null;
    }
    if (!fileSystem.lstatSync(target).isFile()) return null;

    const realPlanningRoot = fileSystem.realpathSync(planningRoot);
    const realTarget = fileSystem.realpathSync(target);
    if (escapesRoot(realPlanningRoot, realTarget)) return null;
    return realTarget;
  } catch {
    return null;
  }
}

function createServer(options) {
  const projectRoot = fixedProjectRoot(options.projectRoot);
  const source = createDataSource(projectRoot);
  const sseClients = new Set();
  const processNonce = crypto.randomBytes(32).toString('base64url');

  const stopWatcher = startWatcher(projectRoot, () => {
    source.invalidate();
    for (const client of sseClients) {
      client.write('data: {"changed":"planning"}\n\n');
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of sseClients) client.write(': keepalive\n\n');
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref();

  function json(res, status, value) {
    res.writeHead(status, {
      'content-type': MIME['.json'],
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(value));
  }

  function expectedOrigin() {
    const address = server.address();
    return address && typeof address === 'object' ? `http://${BIND_HOST}:${address.port}` : null;
  }

  function readIntentBody(req, res, callback) {
    let size = 0;
    let body = '';
    let complete = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (complete) return;
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > INTENT_BODY_LIMIT) {
        complete = true;
        json(res, 413, { outcome: 'rejected', reason_code: 'BODY_TOO_LARGE' });
        req.resume();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (complete) return;
      complete = true;
      try { callback(JSON.parse(body)); }
      catch { json(res, 400, { outcome: 'rejected', reason_code: 'INVALID_JSON' }); }
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${BIND_HOST}`);
    const route = url.pathname;

    if (req.method === 'POST' && (route === '/api/intents' || route === '/api/fork-selections')) {
      if (req.headers.origin !== expectedOrigin()) {
        json(res, 403, { outcome: 'rejected', reason_code: 'ORIGIN_REJECTED' });
        return;
      }
      const nonce = req.headers['x-citadel-nonce'];
      if (typeof nonce !== 'string' || nonce.length !== processNonce.length
        || !crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(processNonce))) {
        json(res, 403, { outcome: 'rejected', reason_code: 'NONCE_REJECTED' });
        return;
      }
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
        json(res, 415, { outcome: 'rejected', reason_code: 'CONTENT_TYPE_REJECTED' });
        return;
      }
      readIntentBody(req, res, (body) => {
        if (route === '/api/fork-selections') {
          const fields = ['actor', 'branch_id', 'expected_revision', 'fork_id', 'idempotency_key', 'reason'];
          if (!body || JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(fields)
            || typeof body.fork_id !== 'string' || typeof body.branch_id !== 'string'
            || !Number.isInteger(body.expected_revision) || typeof body.idempotency_key !== 'string'
            || typeof body.actor !== 'string' || typeof body.reason !== 'string') {
            json(res, 400, { outcome: 'rejected', reason_code: 'INVALID_FORK_SELECTION' });
            return;
          }
          try {
            const selected = applySelection({ projectRoot, forkId: body.fork_id,
              branchId: body.branch_id, expectedRevision: body.expected_revision,
              actorId: body.actor, idempotencyKey: body.idempotency_key, reason: body.reason });
            source.invalidate();
            json(res, 202, { outcome: 'accepted', reason_code: 'FORK_SELECTION_RECORDED',
              fork_id: selected.fork_id, branch_id: selected.selection.branch_id,
              current_revision: selected.revision, landing_effect: 'none' });
          } catch (error) {
            const conflict = error.code === 'FORK_REVISION_CONFLICT';
            json(res, conflict ? 409 : 400, { outcome: conflict ? 'conflict' : 'rejected',
              reason_code: error.code || 'FORK_SELECTION_REJECTED' });
          }
          return;
        }
        let result;
        try {
          result = submitIntent(projectRoot, body);
        } catch {
          result = {
            outcome: 'unknown', operation_id: typeof body?.operation_id === 'string' ? body.operation_id : 'invalid-operation',
            action: ['pause', 'resume', 'stop', 'retry'].includes(body?.action) ? body.action : 'pause',
            intent_id: null,
            expected_revision: Number.isInteger(body?.expected_revision) && body.expected_revision >= 0 ? body.expected_revision : 0,
            current_revision: null, reason_code: 'INTENT_STORE_UNAVAILABLE',
          };
        }
        if (validateControlResult(result).length) {
          json(res, 500, { outcome: 'unknown', reason_code: 'INVALID_CONTROL_RESULT' });
          return;
        }
        source.invalidate();
        const status = result.outcome === 'accepted' ? 202
          : result.outcome === 'conflict' ? 409
            : result.outcome === 'blocked' ? 403
              : result.outcome === 'unknown' ? 503 : 400;
        json(res, status, result);
      });
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
      return;
    }

    if (route === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (route.startsWith('/api/')) {
      if (route === '/api/control') {
        json(res, 200, {
          schema: 1,
          nonce: processNonce,
          actions: ['pause', 'resume', 'stop', 'retry'],
          writes: 'immutable-intents-only',
          fork_actions: ['select'],
        });
        return;
      }
      const data = source.get();
      const views = deriveViews(data);
      const routes = {
        '/api/overview': views.overview,
        '/api/campaigns': views.campaigns,
        '/api/fleet': views.fleet,
        '/api/forks': views.forks,
        '/api/loops': views.loops,
        '/api/hooks/feed': views.hooks,
        '/api/cost': views.cost,
        '/api/handoffs': views.handoffs,
        '/api/activation': views.activation,
        '/api/snapshot': data.snapshot,
      };
      if (route in routes) {
        res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
        const view = routes[route];
        const viewSources = route === '/api/overview'
          ? Object.values(data.sources || {}).map((item) => item.path)
          : [view && view.state && view.state.path].filter(Boolean);
        res.end(envelope(view, viewSources));
      } else {
        res.writeHead(404, { 'content-type': MIME['.json'] }).end(envelope({ error: 'unknown endpoint' }, []));
      }
      return;
    }

    if (route === '/evidence') {
      const requested = url.searchParams.get('path') || '';
      const target = resolveEvidencePath(projectRoot, requested);
      if (!target) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('evidence not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(target).pipe(res);
      return;
    }

    const staticPath = safeStaticPath(route);
    if (!staticPath || !fs.existsSync(staticPath) || !fs.statSync(staticPath).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(staticPath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(staticPath).pipe(res);
  });

  server.on('close', () => {
    stopWatcher();
    clearInterval(heartbeat);
  });

  return server;
}

function openBrowser(urlString) {
  const platform = process.platform;
  if (platform === 'win32') spawn('cmd', ['/c', 'start', '', urlString], { detached: true, stdio: 'ignore' }).unref();
  else if (platform === 'darwin') spawn('open', [urlString], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [urlString], { detached: true, stdio: 'ignore' }).unref();
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const server = createServer(options);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${options.port} is in use. Try: node scripts/dashboard-server.js --port ${options.port + 1}`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(options.port, BIND_HOST, () => {
    const urlString = `http://${BIND_HOST}:${options.port}/`;
    console.log(`Citadel dashboard: ${urlString} (project: ${options.projectRoot})`);
    console.log('Read-only. Binds to localhost only. Ctrl+C to stop.');
    if (options.open) openBrowser(urlString);
  });
}

if (require.main === module) {
  main();
}

module.exports = { createServer, createDataSource, deriveViews, deriveNeedsYou, inspectSources, parseArgs, planningSignature, projectionState, readOperationControls, readPendingIntents, resolveEvidencePath, startWatcher };

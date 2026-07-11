#!/usr/bin/env node

'use strict';

/**
 * dashboard-server.js -- Citadel local web dashboard (v0.1, read-only).
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
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { collectDashboard } = require('./dashboard');
const { listLoops } = require('../core/loops/registry');
const { report: activationReport } = require('../core/telemetry/activation');

const DEFAULT_PORT = 4180;
const BIND_HOST = '127.0.0.1';
const SNAPSHOT_TTL_MS = 5000;
const WATCH_DEBOUNCE_MS = 300;
const WATCH_POLL_FALLBACK_MS = 2000;
const SSE_HEARTBEAT_MS = 25000;
const RECENT_LIMIT = 25;
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
    'Serves a read-only local dashboard over .planning/ state and telemetry.',
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
    activationState = inspectDirectory(projectRoot, '.planning/telemetry', {
      filter: (name) => name === 'activation.jsonl', jsonl: true,
    });
    if (activationState.status === 'empty') activationState = source('.planning/telemetry/activation.jsonl', 'unknown', 'source is absent');
  }
  return { campaigns: campaignState, fleet: fleetState, loops: loopsState, hooks: hooksState, handoffs: handoffsState, cost: costState, activation: activationState };
}

function readActivation(projectRoot, state) {
  if (!state || state.status === 'unknown') return { mode: 'unknown', note: 'No activation report has been recorded.', report: null };
  if (state.status === 'unreadable') return { mode: 'unreadable', note: state.detail, report: null };
  try {
    const reportPath = path.join(projectRoot, '.planning', 'product-proof', 'activation-report.json');
    const value = fs.existsSync(reportPath)
      ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
      : activationReport(projectRoot);
    if (value.schema !== 1) throw new Error('activation report is not schema 1');
    return { mode: value.total_events > 0 ? 'healthy' : 'empty', note: value.total_events > 0 ? 'local, redacted activation evidence' : 'Activation telemetry is enabled but no events are recorded.', report: value };
  } catch (error) {
    state.status = 'unreadable';
    state.detail = error.message;
    return { mode: 'unreadable', note: error.message, report: null };
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
    },
    fleet: {
      state: sources.fleet || source('.planning/fleet', 'unknown', 'source state unavailable'),
      sessions: snapshot.fleetSessions || [],
      worktrees: snapshot.worktrees || [],
      coordination: snapshot.coordination || { instances: [], claims: [] },
      readiness: snapshot.worktreeReadiness || [],
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
  const source = createDataSource(options.projectRoot);
  const sseClients = new Set();

  const stopWatcher = startWatcher(options.projectRoot, () => {
    source.invalidate();
    for (const client of sseClients) {
      client.write('data: {"changed":"planning"}\n\n');
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of sseClients) client.write(': keepalive\n\n');
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${BIND_HOST}`);
    const route = url.pathname;

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
      const data = source.get();
      const views = deriveViews(data);
      const routes = {
        '/api/overview': views.overview,
        '/api/campaigns': views.campaigns,
        '/api/fleet': views.fleet,
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
      const target = resolveEvidencePath(options.projectRoot, requested);
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

module.exports = { createServer, createDataSource, deriveViews, deriveNeedsYou, inspectSources, parseArgs, planningSignature, projectionState, resolveEvidencePath, startWatcher };

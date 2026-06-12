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
        .map((name) => {
          const filePath = path.join(dir, name);
          let modifiedAt = null;
          try { modifiedAt = fs.statSync(filePath).mtime.toISOString(); } catch { /* render as unknown */ }
          return { name, path: `.planning/handoffs/${name}`, modifiedAt };
        })
        .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)))
        .slice(0, 50);
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

  function collect() {
    let snapshot;
    let collectError = null;
    try {
      snapshot = collectDashboard({ projectRoot, recentLimit: RECENT_LIMIT });
    } catch (error) {
      collectError = String(error && error.message ? error.message : error);
      snapshot = null;
    }
    let loops = [];
    try {
      loops = listLoops(projectRoot) || [];
    } catch { /* loops panel renders empty with a note */ }
    return {
      snapshot,
      collectError,
      loops,
      daemon: readDaemon(),
      handoffs: readHandoffs(),
    };
  }

  return {
    get() {
      const now = Date.now();
      if (state.dirty || !state.cache || now - state.collectedAt > SNAPSHOT_TTL_MS) {
        state.cache = collect();
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

// ---------------------------------------------------------------------------
// View derivations (snapshot -> per-endpoint payloads)
// ---------------------------------------------------------------------------

function deriveNeedsYou(data) {
  const items = [];
  const snapshot = data.snapshot;
  if (!snapshot) return items;

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

function deriveViews(data) {
  const snapshot = data.snapshot || {};
  const needsYou = deriveNeedsYou(data);
  const cost = snapshot.cost || null;
  const costMode = cost ? (cost.data_source || 'estimated') : 'unavailable';

  return {
    overview: {
      project_root: snapshot.projectRoot || null,
      planning_exists: Boolean(snapshot.planningExists),
      collect_error: data.collectError,
      needs_you: needsYou,
      active: {
        campaigns: (snapshot.campaigns || []).length,
        fleet_sessions: (snapshot.fleetSessions || []).length,
        loops: (data.loops || []).filter((loop) => {
          const status = loop.status || (loop.state && loop.state.status);
          return status && !['done', 'stopped', 'verifier-passed'].includes(status);
        }).length,
      },
      cost: cost ? { real: cost.real_total, estimated: cost.estimated_total, mode: costMode } : null,
      health: snapshot.health || null,
      next_action: snapshot.nextAction || null,
      problem_summary: snapshot.problemSummary || null,
    },
    campaigns: {
      active: snapshot.campaigns || [],
      skipped: snapshot.skippedCampaigns || [],
      ledger: snapshot.outcomeLedger || [],
    },
    fleet: {
      sessions: snapshot.fleetSessions || [],
      worktrees: snapshot.worktrees || [],
      coordination: snapshot.coordination || { instances: [], claims: [] },
      readiness: snapshot.worktreeReadiness || [],
    },
    loops: {
      loops: data.loops || [],
      daemon: data.daemon,
    },
    hooks: {
      feed: snapshot.hookActivity || [],
      value: snapshot.hookValue || null,
      overhead: snapshot.hookOverhead || [],
      blocks: (snapshot.problems || []).filter((problem) => problem.category === 'safety-block'),
    },
    cost: cost
      ? { ...cost, mode: costMode }
      : { mode: 'unavailable', note: 'No telemetry found. Costs appear once sessions run with telemetry enabled.' },
    handoffs: {
      handoffs: data.handoffs || [],
      recent_activity: snapshot.recentActivity || [],
    },
  };
}

function envelope(data) {
  return JSON.stringify({ schema: 1, generated_at: new Date().toISOString(), data });
}

// ---------------------------------------------------------------------------
// Watching + SSE
// ---------------------------------------------------------------------------

function startWatcher(projectRoot, onChange) {
  const planningDir = path.join(projectRoot, '.planning');
  let timer = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
  };
  try {
    const watcher = fs.watch(planningDir, { recursive: true }, fire);
    watcher.on('error', () => { /* fall back below on next tick */ });
    return () => watcher.close();
  } catch {
    // Recursive watch unsupported (some Linux): poll top-level mtimes.
    let lastSignature = '';
    const interval = setInterval(() => {
      let signature = '';
      try {
        for (const entry of fs.readdirSync(planningDir)) {
          try { signature += `${entry}:${fs.statSync(path.join(planningDir, entry)).mtimeMs};`; } catch { /* skip */ }
        }
      } catch { /* planning dir missing; nothing to signal */ }
      if (signature !== lastSignature) {
        lastSignature = signature;
        fire();
      }
    }, WATCH_POLL_FALLBACK_MS);
    return () => clearInterval(interval);
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function safeStaticPath(urlPath) {
  const clean = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.normalize(path.join(STATIC_DIR, clean));
  if (!resolved.startsWith(STATIC_DIR)) return null;
  return resolved;
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
        '/api/snapshot': data.snapshot,
      };
      if (route in routes) {
        res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
        res.end(envelope(routes[route]));
      } else {
        res.writeHead(404, { 'content-type': MIME['.json'] }).end(envelope({ error: 'unknown endpoint' }));
      }
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

module.exports = { createServer, createDataSource, deriveViews, deriveNeedsYou, parseArgs };

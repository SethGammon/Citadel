#!/usr/bin/env node

'use strict';

/**
 * codebase-memory MCP server.
 *
 * An optional, read-only, repo-agnostic orientation layer. It reuses Citadel's
 * existing `core/map` index generator (tree-walked exports/imports/symbols/roles
 * + a forward dependency graph) and adds the query surface core/map doesn't
 * expose: reverse edges (who-imports / dependents), path tracing, and git-diff
 * change-impact with fan-in risk. The point is to let an agent answer structural
 * questions on a cold repo without grepping and reading file chains.
 *
 * Pure Node, no dependencies, MCP 2024-11-05 JSON-RPC over stdio — same shape as
 * mcp-servers/citadel-state. The index is a derived artifact at
 * .planning/map/index.json; nothing leaves the machine.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const map = require('../../core/map');

const PROJECT_ROOT = path.resolve(process.env.CITADEL_PROJECT_ROOT || process.cwd());
const OUTPUT_PATH = map.defaultOutputPath(PROJECT_ROOT);

// Fan-in thresholds + the file roles whose changes ripple widely. Named so the
// risk policy is data, not magic numbers. Roles come from core/map's inferRole.
const HIGH_FANIN = 10;
const MED_FANIN = 3;
const RIPPLE_ROLES = new Set(['types', 'kernel', 'store', 'config']);

const toPosix = (p) => String(p || '').replace(/\\/g, '/');

// ---- index lifecycle -------------------------------------------------------

function ensureIndex(forceRebuild = false) {
  if (!forceRebuild && fs.existsSync(OUTPUT_PATH)) {
    try {
      return map.loadMapIndex(OUTPUT_PATH);
    } catch (_) {
      /* corrupt cache — fall through to regenerate */
    }
  }
  const index = map.generateMapIndex(PROJECT_ROOT);
  try {
    map.writeMapIndex(index, OUTPUT_PATH);
  } catch (_) {
    /* read-only fs is fine; the in-memory index still answers queries */
  }
  return index;
}

function reverseGraph(index) {
  const reverse = {};
  for (const [file, deps] of Object.entries(index.graph || {})) {
    for (const dep of deps) {
      (reverse[dep] = reverse[dep] || []).push(file);
    }
  }
  for (const key of Object.keys(reverse)) reverse[key].sort();
  return reverse;
}

function resolveFile(index, arg) {
  const want = toPosix(arg);
  if (index.files && index.files[want]) return want;
  // tolerate a partial/suffix path the agent typed by hand
  const matches = Object.keys(index.files || {}).filter((f) => f === want || f.endsWith('/' + want) || f.endsWith(want));
  return matches.length === 1 ? matches[0] : matches.length ? matches : null;
}

function riskFor(fanIn, role) {
  if (fanIn >= HIGH_FANIN) return 'high';
  if (RIPPLE_ROLES.has(role) && fanIn >= MED_FANIN) return 'high';
  if (fanIn >= MED_FANIN) return 'medium';
  return 'low';
}

// ---- tool implementations --------------------------------------------------

function getArchitecture() {
  const index = ensureIndex();
  const reverse = reverseGraph(index);
  const topDependedOn = Object.entries(reverse)
    .map(([file, importers]) => ({ file, fanIn: importers.length, role: index.files[file] ? index.files[file].role : null }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 15);
  return {
    stats: map.mapStats(index),
    generatedAt: index.generatedAt || index.generated,
    topDependedOn,
    routes: (index.routes || []).slice(0, 40),
    verificationCommands: index.verificationCommands || [],
  };
}

function searchSymbols(query, limit) {
  const index = ensureIndex();
  return map.queryMapIndex(index, query, limit || 20).map((r) => ({
    file: r.relPath,
    role: r.role,
    exports: r.exports,
    routes: r.routes,
    lines: r.lines,
    score: r.score,
  }));
}

function whoImports(file) {
  const index = ensureIndex();
  const resolved = resolveFile(index, file);
  if (!resolved) return { file, importers: [], note: 'file not found in index' };
  if (Array.isArray(resolved)) return { file, ambiguous: resolved };
  return { file: resolved, importers: reverseGraph(index)[resolved] || [] };
}

function dependenciesOf(file) {
  const index = ensureIndex();
  const resolved = resolveFile(index, file);
  if (!resolved || Array.isArray(resolved)) return { file, dependencies: [], note: resolved ? 'ambiguous' : 'not found' };
  return { file: resolved, dependencies: (index.graph && index.graph[resolved]) || [] };
}

function tracePath(from, to) {
  const index = ensureIndex();
  const a = resolveFile(index, from);
  const b = resolveFile(index, to);
  if (!a || Array.isArray(a) || !b || Array.isArray(b)) return { path: null, note: 'from/to not uniquely resolved' };
  const graph = index.graph || {};
  const queue = [[a]];
  const seen = new Set([a]);
  while (queue.length) {
    const trail = queue.shift();
    const head = trail[trail.length - 1];
    if (head === b) return { path: trail };
    for (const dep of graph[head] || []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      queue.push(trail.concat(dep));
    }
  }
  return { path: null, note: 'no dependency path' };
}

function impactOfChange(base) {
  const index = ensureIndex();
  let changed;
  try {
    const raw = execFileSync('git', ['diff', '--name-only', base || 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
    changed = raw.split(/\r?\n/).map((s) => toPosix(s.trim())).filter(Boolean);
  } catch (err) {
    return { error: `git diff failed (not a repo, or bad base "${base}"): ${err.message}` };
  }
  const reverse = reverseGraph(index);
  const affected = changed
    .filter((f) => index.files && index.files[f])
    .map((f) => {
      const importers = reverse[f] || [];
      const role = index.files[f].role;
      return { file: f, role, fanIn: importers.length, dependents: importers, risk: riskFor(importers.length, role) };
    });
  const rank = { high: 0, medium: 1, low: 2 };
  affected.sort((x, y) => rank[x.risk] - rank[y.risk] || y.fanIn - x.fanIn || x.file.localeCompare(y.file));
  return {
    base: base || 'HEAD',
    changedFiles: changed.length,
    indexedChangedFiles: affected.length,
    note: 'File-level impact (core/map is file-granular). Dependents are direct (1-hop) importers.',
    affected,
  };
}

function indexStatus() {
  const exists = fs.existsSync(OUTPUT_PATH);
  const index = ensureIndex();
  const staleness = map.detectMapStaleness(PROJECT_ROOT, index);
  return {
    indexPath: toPosix(path.relative(PROJECT_ROOT, OUTPUT_PATH)),
    existedOnDisk: exists,
    fileCount: index.fileCount,
    generatedAt: index.generatedAt || index.generated,
    stale: staleness.stale,
    added: staleness.added.length,
    removed: staleness.removed.length,
    changed: staleness.changed.length,
  };
}

function reindex() {
  const index = ensureIndex(true);
  return { reindexed: true, fileCount: index.fileCount, generatedAt: index.generatedAt || index.generated };
}

// ---- MCP wiring ------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: 'get_architecture',
    description: 'High-level codebase orientation: language/role stats, the most depended-on files (top fan-in), routes, and verification commands. Start here on a cold repo.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_symbols',
    description: 'Find files by symbol/export/route/path terms (where is X defined or handled). Returns ranked file pointers, not file contents.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Space-separated terms, e.g. "auth login route".' },
        limit: { type: 'number', description: 'Max files to return (default 20).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'who_imports',
    description: 'Reverse dependency lookup: which files import the given file. The structural question grep is worst at.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'Repo-relative file path.' } },
      required: ['file'],
    },
  },
  {
    name: 'dependencies_of',
    description: 'Forward dependencies: which internal files the given file imports.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'Repo-relative file path.' } },
      required: ['file'],
    },
  },
  {
    name: 'trace_path',
    description: 'Shortest dependency path between two files (BFS over the import graph).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start file (repo-relative).' },
        to: { type: 'string', description: 'Target file (repo-relative).' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'impact_of_change',
    description: 'Blast radius of the working diff: maps changed files (vs a git base ref) to their direct importers and ranks each by fan-in risk. Run before a commit/PR.',
    inputSchema: {
      type: 'object',
      properties: { base: { type: 'string', description: 'Git base ref to diff against (default HEAD).' } },
    },
  },
  {
    name: 'index_status',
    description: 'Report the codebase index location, file count, and whether it is stale (files added/removed/changed since it was built).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reindex',
    description: 'Force a rebuild of the codebase index. Run after a large pull or branch switch.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const HANDLERS = {
  get_architecture: () => getArchitecture(),
  search_symbols: (a) => searchSymbols(a.query, a.limit),
  who_imports: (a) => whoImports(a.file),
  dependencies_of: (a) => dependenciesOf(a.file),
  trace_path: (a) => tracePath(a.from, a.to),
  impact_of_change: (a) => impactOfChange(a.base),
  index_status: () => indexStatus(),
  reindex: () => reindex(),
};

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'codebase-memory', version: '1.0.0' },
      instructions: 'Call get_architecture to orient on a cold repo, then who_imports / dependencies_of / trace_path / impact_of_change for structural questions instead of grepping. Index is read-only and derived; reindex after large pulls.',
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    respond(id, { tools: TOOL_DEFS });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    const handler = HANDLERS[name];
    if (!handler) {
      respondError(id, -32601, `Unknown tool: ${name}`);
      return;
    }
    try {
      respond(id, { content: [{ type: 'text', text: JSON.stringify(handler(args), null, 2) }] });
    } catch (err) {
      respond(id, { isError: true, content: [{ type: 'text', text: `Tool ${name} failed: ${err.message}` }] });
    }
    return;
  }

  if (method === 'resources/list') {
    respond(id, { resources: [{ uri: 'codebase://architecture', name: 'Codebase Architecture', mimeType: 'application/json' }] });
    return;
  }

  if (method === 'resources/read' && params && params.uri === 'codebase://architecture') {
    respond(id, {
      contents: [{ uri: 'codebase://architecture', mimeType: 'application/json', text: JSON.stringify(getArchitecture(), null, 2) }],
    });
    return;
  }

  if (id !== undefined) respondError(id, -32601, `Unknown method: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleRequest(JSON.parse(trimmed));
    } catch (err) {
      respondError(null, -32700, `Parse error: ${err.message}`);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

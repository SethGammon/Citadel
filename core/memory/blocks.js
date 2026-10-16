'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const COMPILER = 'citadel-source-excerpts-v1';
const sourceDigest = (content) => createHash('sha256').update(content).digest('hex');

const BLOCK_TYPES = [
  'project-rules',
  'architecture-decisions',
  'verification-recipes',
  'failure-patterns',
  'user-preferences',
];

function slug(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'unknown';
}

function today(options = {}) {
  return (options.now || new Date()).toISOString().slice(0, 10);
}

function memoryRoot(projectRoot) {
  return path.join(projectRoot, '.planning', 'memory');
}

function blocksDir(projectRoot) {
  return path.join(memoryRoot(projectRoot), 'blocks');
}

function rel(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function exists(projectRoot, relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function listFiles(root, predicate = () => true, limit = 50) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (predicate(full)) out.push(full);
      if (out.length >= limit) break;
    }
  }
  return out.sort();
}

function source(projectRoot, relativePath, reason) {
  return { path: relativePath.replace(/\\/g, '/'), reason };
}

function availableSources(projectRoot, candidates) {
  return candidates.filter((entry) => exists(projectRoot, entry.path))
    .slice(0, 4)
    .map((entry) => {
      const content = fs.readFileSync(path.join(projectRoot, entry.path));
      return { ...entry, sha256: sourceDigest(content), excerpt: content.toString('utf8').slice(0, 600) };
    });
}

function block(id, type, scope, sources, body, confidence = 'medium', options = {}) {
  const record = {
    id,
    type,
    scope,
    owner: options.owner || 'citadel',
    confidence,
    generated_by: COMPILER,
    last_verified: today(options),
    sources,
    body,
  };
  return { ...record, generated_sha256: sourceDigest(JSON.stringify(record)) };
}

function buildBlocks(projectRoot, options = {}) {
  const fleetOutputs = listFiles(path.join(projectRoot, '.planning', 'fleet'), (file) => /\.(md|json|jsonl)$/.test(file), 10)
    .map((file) => source(projectRoot, rel(projectRoot, file), 'fleet output or session evidence'));
  const postmortems = listFiles(path.join(projectRoot, '.planning', 'postmortems'), (file) => file.endsWith('.md'), 10)
    .map((file) => source(projectRoot, rel(projectRoot, file), 'postmortem evidence'));

  // This compiler retrieves bounded source excerpts. It does not infer project
  // identity, user preferences, approval, current architecture or test commands.
  const fromSources = (id, type, scope, candidates) => {
    const snapshots = availableSources(projectRoot, candidates);
    if (!snapshots.length) return null;
    const sources = snapshots.map(({ excerpt, ...entry }) => entry);
    const excerpts = snapshots.map((entry) => {
      return `### ${entry.path}\n${entry.excerpt.split(/\r?\n/).map((line) => `> ${line}`).join('\n')}`;
    });
    return block(id, type, scope, sources,
      ['Source excerpts for context; current instructions and approval must be checked at the source.', ...excerpts].join('\n\n'),
      'medium', options);
  };

  return [
    fromSources(
      'memory-project-rules',
      'project-rules',
      ['project', 'rules'],
      [
        source(projectRoot, 'AGENTS.md', 'repository operating rules'),
        source(projectRoot, 'docs/CONSTITUTION.md', 'harness rule hierarchy'),
        source(projectRoot, 'docs/SKILLS.md', 'skill authoring and handoff contract'),
      ]
    ),
    fromSources(
      'memory-architecture-decisions',
      'architecture-decisions',
      ['architecture', 'decisions', 'codex', 'fleet', 'worktree', 'telemetry'],
      [
        source(projectRoot, 'docs/ARCHITECTURE.md', 'current harness architecture'),
        source(projectRoot, 'docs/CODEX_NATIVE_INTEGRATIONS.md', 'Codex-native integration decisions'),
        source(projectRoot, 'docs/FLEET.md', 'fleet coordination design'),
        source(projectRoot, 'docs/worktree-isolation.md', 'worktree readiness design'),
      ]
    ),
    fromSources(
      'memory-verification-recipes',
      'verification-recipes',
      ['verification', 'tests'],
      [
        source(projectRoot, 'AGENTS.md', 'required verification table'),
        source(projectRoot, 'package.json', 'registered npm verification scripts'),
        source(projectRoot, 'scripts/test-all.js', 'full suite orchestration'),
        source(projectRoot, 'scripts/verify-telemetry-integrity.js', 'telemetry integrity verifier'),
      ]
    ),
    fromSources(
      'memory-failure-patterns',
      'failure-patterns',
      ['failure-patterns', 'quality'],
      [
        source(projectRoot, '.planning/research/patterns.md', 'observed project patterns'),
        source(projectRoot, '.planning/research/external-insights-brief.md', 'external analysis'),
        source(projectRoot, '.planning/telemetry/hook-errors.jsonl', 'recent hook error evidence'),
        ...fleetOutputs,
        ...postmortems,
      ]
    ),
    fromSources(
      'memory-user-preferences',
      'user-preferences',
      ['user', 'preferences'],
      [
        source(projectRoot, '.planning/user-preferences.md', 'recorded user preferences'),
        source(projectRoot, 'docs/user-preferences.md', 'recorded user preferences'),
      ]
    ),
  ].filter(Boolean);
}

function validateBlock(blockRecord) {
  const issues = [];
  for (const key of ['id', 'type', 'scope', 'owner', 'confidence', 'last_verified', 'sources', 'body']) {
    if (blockRecord[key] === undefined || blockRecord[key] === null || blockRecord[key] === '') issues.push(`missing ${key}`);
  }
  if (!BLOCK_TYPES.includes(blockRecord.type)) issues.push(`unknown type ${blockRecord.type}`);
  if (!Array.isArray(blockRecord.scope) || blockRecord.scope.length === 0) issues.push('scope must be a non-empty array');
  if (!Array.isArray(blockRecord.sources) || blockRecord.sources.length === 0) issues.push('sources must be a non-empty array');
  return issues;
}

function writeBlock(projectRoot, blockRecord) {
  fs.mkdirSync(blocksDir(projectRoot), { recursive: true });
  const filePath = path.join(blocksDir(projectRoot), `${slug(blockRecord.id)}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(blockRecord, null, 2)}\n`, 'utf8');
  return filePath;
}

function writeIndex(projectRoot, blocks) {
  fs.mkdirSync(memoryRoot(projectRoot), { recursive: true });
  const index = {
    generated_at: new Date().toISOString(),
    block_count: blocks.length,
    types: BLOCK_TYPES,
    blocks: blocks.map((entry) => ({
      id: entry.id,
      type: entry.type,
      scope: entry.scope,
      confidence: entry.confidence,
      freshness: entry.freshness,
      file: `blocks/${slug(entry.id)}.json`,
    })),
  };
  const filePath = path.join(memoryRoot(projectRoot), 'index.json');
  fs.writeFileSync(filePath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return filePath;
}

function compileMemoryBlocks(projectRoot, options = {}) {
  const generated = buildBlocks(projectRoot, options);
  const written = [];
  const preserved = [];
  for (const entry of generated) {
    const destination = path.join(blocksDir(projectRoot), `${slug(entry.id)}.json`);
    if (fs.existsSync(destination)) {
      let existing;
      try { existing = readBlockFile(destination); } catch { /* preserve an unreadable authored file too */ }
      const { generated_sha256, ...generatedContent } = existing || {};
      if (existing?.generated_by !== COMPILER
        || generated_sha256 !== sourceDigest(JSON.stringify(generatedContent))) {
        preserved.push({ file: destination, reason: 'authored-or-unverified-block' });
        continue;
      }
    }
    written.push(writeBlock(projectRoot, entry));
  }
  const blocks = loadMemoryBlocks(projectRoot, { includeNonCurrent: true, now: options.now });
  const indexPath = writeIndex(projectRoot, blocks);
  return { blocks, written, preserved, generated_count: generated.length, indexPath };
}

function readBlockFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadMemoryBlocks(projectRoot, filters = {}) {
  const dir = blocksDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  const query = filters.query
    ? String(filters.query).toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean)
    : null;
  const scope = filters.scope ? String(filters.scope).toLowerCase() : null;
  const type = filters.type ? String(filters.type).toLowerCase() : null;
  return fs.readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readBlockFile(path.join(dir, entry)))
    .map((entry) => ({ ...entry, freshness: blockFreshness(projectRoot, entry, filters).status }))
    .filter((entry) => filters.includeNonCurrent || entry.freshness === 'current')
    .filter((entry) => !type || entry.type === type)
    .filter((entry) => !scope || entry.scope.some((item) => String(item).toLowerCase().includes(scope)))
    .filter((entry) => !query || query.every((term) => JSON.stringify(entry).toLowerCase().includes(term)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function isOlderThan(dateString, days, now = new Date()) {
  const time = Date.parse(dateString);
  if (Number.isNaN(time)) return true;
  return (now.getTime() - time) > days * 24 * 60 * 60 * 1000;
}

function blockFreshness(projectRoot, entry, options = {}) {
  const issues = [];
  let status = 'current';
  const add = (type, issue) => {
    issues.push({ id: entry.id || null, type, issue });
    if (type === 'stale') status = 'stale';
    else if (status !== 'stale') status = 'unverified';
  };
  if (!Array.isArray(entry.sources) || !entry.sources.length) add('source', 'no verified sources');
  for (const item of entry.sources || []) {
    if (!item.path) add('source', 'source missing path');
    else if (!exists(projectRoot, item.path)) add('stale', `source path not found: ${item.path}`);
    else if (!item.sha256) add('source', `source content is unverified: ${item.path}`);
    else if (sourceDigest(fs.readFileSync(path.join(projectRoot, item.path))) !== item.sha256) {
      add('stale', `source content changed: ${item.path}`);
    }
  }
  if (entry.generated_by === COMPILER) {
    const { generated_sha256, freshness, ...content } = entry;
    if (generated_sha256 !== sourceDigest(JSON.stringify(content))) add('source', 'generated block content was edited');
  }
  if (isOlderThan(entry.last_verified, options.staleDays || 60, options.now || new Date())) {
    add('stale', `last_verified is stale: ${entry.last_verified}`);
  }
  return { status, issues };
}

function contradictionIssues(blockRecord) {
  const lines = String(blockRecord.body || '').toLowerCase().split(/\r?\n/);
  const always = new Set();
  const never = new Set();
  for (const line of lines) {
    const alwaysMatch = line.match(/\balways\s+(.+)/);
    const neverMatch = line.match(/\bnever\s+(.+)/);
    if (alwaysMatch) always.add(alwaysMatch[1].replace(/[^a-z0-9 ]/g, '').trim());
    if (neverMatch) never.add(neverMatch[1].replace(/[^a-z0-9 ]/g, '').trim());
  }
  return [...always].filter((item) => never.has(item)).map((item) => `contradiction: always and never ${item}`);
}

function lintMemoryBlocks(projectRoot, options = {}) {
  const blocks = loadMemoryBlocks(projectRoot, { ...options, includeNonCurrent: true });
  const issues = [];
  const seen = new Set();
  for (const entry of blocks) {
    for (const issue of validateBlock(entry)) issues.push({ id: entry.id || null, type: 'schema', issue });
    if (seen.has(entry.id)) issues.push({ id: entry.id, type: 'duplicate', issue: `duplicate block id ${entry.id}` });
    seen.add(entry.id);
    issues.push(...blockFreshness(projectRoot, entry, options).issues);
    for (const issue of contradictionIssues(entry)) issues.push({ id: entry.id, type: 'contradiction', issue });
  }
  return { blocks, issues, pass: issues.length === 0 };
}

module.exports = {
  BLOCK_TYPES,
  blocksDir,
  buildBlocks,
  compileMemoryBlocks,
  lintMemoryBlocks,
  loadMemoryBlocks,
  memoryRoot,
  slug,
  validateBlock,
};

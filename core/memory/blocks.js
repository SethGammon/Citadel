'use strict';

const fs = require('fs');
const path = require('path');

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

function readText(projectRoot, relativePath, maxChars = 24000) {
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').slice(0, maxChars);
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
  return candidates.filter((entry) => exists(projectRoot, entry.path));
}

function extractDecisionLog(campaignText) {
  const match = campaignText.match(/## Decision Log\s+([\s\S]*?)(?:\n## |\n<!--|$)/);
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .slice(-12);
}

function extractPatternLines(text, limit = 8) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.startsWith('**What') || line.startsWith('**Why') || line.startsWith('| `/'))
    .slice(0, limit);
}

function block(id, type, scope, sources, body, confidence = 'medium', options = {}) {
  return {
    id,
    type,
    scope,
    owner: options.owner || 'citadel',
    confidence,
    last_verified: today(options),
    sources,
    body,
  };
}

function buildBlocks(projectRoot, options = {}) {
  const campaignPath = '.planning/campaigns/citadel-competitor-gap-assessment.md';
  const campaignText = readText(projectRoot, campaignPath);
  const patternText = readText(projectRoot, '.planning/research/patterns.md');
  const insightText = readText(projectRoot, '.planning/research/external-insights-brief.md');
  const packageJson = readText(projectRoot, 'package.json');
  const decisions = extractDecisionLog(campaignText);
  const patterns = extractPatternLines(patternText || insightText, 10);

  const fleetOutputs = listFiles(path.join(projectRoot, '.planning', 'fleet'), (file) => /\.(md|json|jsonl)$/.test(file), 10)
    .map((file) => source(projectRoot, rel(projectRoot, file), 'fleet output or session evidence'));
  const postmortems = listFiles(path.join(projectRoot, '.planning', 'postmortems'), (file) => file.endsWith('.md'), 10)
    .map((file) => source(projectRoot, rel(projectRoot, file), 'postmortem evidence'));

  return [
    block(
      'memory-project-rules',
      'project-rules',
      ['project', 'harness', 'skills', 'hooks'],
      availableSources(projectRoot, [
        source(projectRoot, 'AGENTS.md', 'repository operating rules'),
        source(projectRoot, 'docs/CONSTITUTION.md', 'harness rule hierarchy'),
        source(projectRoot, 'docs/SKILLS.md', 'skill authoring and handoff contract'),
      ]),
      [
        '- Treat this repository as the Citadel harness; skills, agents, hooks, and state files are first-class product surfaces.',
        '- Keep changes scoped to harness conventions: skills in `skills/`, agents in `agents/`, hooks in `hooks_src/`, and campaign state in `.planning/`.',
        '- Every completed task must leave a compact HANDOFF and enough verification evidence for another session to resume.',
      ].join('\n'),
      'high',
      options
    ),
    block(
      'memory-architecture-decisions',
      'architecture-decisions',
      ['architecture', 'codex', 'fleet', 'worktree', 'telemetry'],
      availableSources(projectRoot, [
        source(projectRoot, 'docs/ARCHITECTURE.md', 'current harness architecture'),
        source(projectRoot, 'docs/CODEX_NATIVE_INTEGRATIONS.md', 'Codex-native integration decisions'),
        source(projectRoot, 'docs/FLEET.md', 'fleet coordination design'),
        source(projectRoot, 'docs/worktree-isolation.md', 'worktree readiness design'),
        source(projectRoot, campaignPath, 'competitor-gap implementation decisions'),
      ]),
      [
        '- Citadel owns durable campaign memory, discovery relay, scope claims, policy, and evidence even when Codex supplies native execution primitives.',
        '- Fleet work is dependency-aware: ready work, blocked work, readiness-blocked work, and merge-order blockers are separate operator states.',
        '- Telemetry and artifact records now carry lineage IDs plus `_hash`; optional HMAC signing upgrades integrity without breaking old legacy records.',
        ...decisions.slice(-6),
      ].join('\n'),
      'high',
      options
    ),
    block(
      'memory-verification-recipes',
      'verification-recipes',
      ['verification', 'tests', 'hooks', 'skills', 'telemetry'],
      availableSources(projectRoot, [
        source(projectRoot, 'AGENTS.md', 'required verification table'),
        source(projectRoot, 'package.json', 'registered npm verification scripts'),
        source(projectRoot, 'scripts/test-all.js', 'full suite orchestration'),
        source(projectRoot, 'scripts/verify-telemetry-integrity.js', 'telemetry integrity verifier'),
      ]),
      [
        '- After hook or skill changes, run the narrow check first, then `npm run test` before shipping.',
        '- Use `node scripts/skill-lint.js <skill>` after skill edits and `node scripts/test-all.js` for the full harness gate.',
        '- Use `npm run telemetry:verify` or `node scripts/verify-telemetry-integrity.js` to confirm hashed logs are clean and legacy records are only legacy.',
        packageJson.includes('"test"') ? '- `npm run test` is the canonical full regression command for this repository.' : '- Full regression command should be confirmed from package.json before use.',
      ].join('\n'),
      'high',
      options
    ),
    block(
      'memory-failure-patterns',
      'failure-patterns',
      ['failure-patterns', 'quality', 'agents', 'daemon', 'learn'],
      [
        ...availableSources(projectRoot, [
          source(projectRoot, '.planning/research/patterns.md', 'observed harness patterns'),
          source(projectRoot, '.planning/research/external-insights-brief.md', 'external memory/compiler gap analysis'),
          source(projectRoot, '.planning/telemetry/hook-errors.jsonl', 'recent hook error evidence'),
        ]),
        ...fleetOutputs,
        ...postmortems,
      ].slice(0, 12),
      [
        '- Hung or silent agents need explicit timeout and continuation behavior; never let a workflow block indefinitely without a recovery path.',
        '- Appending isolated logs does not compound knowledge; compile repeat findings into semantic memory or wiki pages with source links.',
        '- Verification that only checks happy-path text can miss experiential failures; prefer command gates plus operator-readable summaries.',
        ...patterns,
      ].join('\n'),
      'medium',
      options
    ),
    block(
      'memory-user-preferences',
      'user-preferences',
      ['user', 'planning', 'campaigns', 'verification'],
      availableSources(projectRoot, [
        source(projectRoot, campaignPath, 'active user-approved competitor-gap campaign'),
        source(projectRoot, 'AGENTS.md', 'handoff and verification expectations'),
      ]),
      [
        '- The user approved proceeding from competitor research into implementation, with each accepted determination ending in a ready-to-approve plan or verified build slice.',
        '- Keep the paper trail current: campaign phase status, decision log, continuation state, docs, and verification output should agree.',
        '- Prefer technically correct and experientially clear operator surfaces: commands should be obvious, summaries should be readable, and failures should be actionable.',
      ].join('\n'),
      'high',
      options
    ),
  ];
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
      file: `blocks/${slug(entry.id)}.json`,
    })),
  };
  const filePath = path.join(memoryRoot(projectRoot), 'index.json');
  fs.writeFileSync(filePath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return filePath;
}

function compileMemoryBlocks(projectRoot, options = {}) {
  const blocks = buildBlocks(projectRoot, options);
  const written = blocks.map((entry) => writeBlock(projectRoot, entry));
  const indexPath = writeIndex(projectRoot, blocks);
  return { blocks, written, indexPath };
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
  const blocks = loadMemoryBlocks(projectRoot);
  const issues = [];
  const seen = new Set();
  for (const entry of blocks) {
    for (const issue of validateBlock(entry)) issues.push({ id: entry.id || null, type: 'schema', issue });
    if (seen.has(entry.id)) issues.push({ id: entry.id, type: 'duplicate', issue: `duplicate block id ${entry.id}` });
    seen.add(entry.id);
    for (const item of entry.sources || []) {
      if (!item.path) issues.push({ id: entry.id, type: 'source', issue: 'source missing path' });
      else if (!exists(projectRoot, item.path)) issues.push({ id: entry.id, type: 'source', issue: `source path not found: ${item.path}` });
    }
    if (isOlderThan(entry.last_verified, options.staleDays || 60, options.now || new Date())) {
      issues.push({ id: entry.id, type: 'stale', issue: `last_verified is stale: ${entry.last_verified}` });
    }
    for (const issue of contradictionIssues(entry)) issues.push({ id: entry.id, type: 'contradiction', issue });
  }
  for (const type of BLOCK_TYPES) {
    if (!blocks.some((entry) => entry.type === type)) issues.push({ id: null, type: 'coverage', issue: `missing block type ${type}` });
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

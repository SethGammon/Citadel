#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BLOCK_TYPES,
  compileMemoryBlocks,
  lintMemoryBlocks,
  loadMemoryBlocks,
} = require('../core/memory/blocks');

function write(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-memory-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempProject((projectRoot) => {
  const verifiedAt = new Date();
  write(path.join(projectRoot, 'AGENTS.md'), [
    '# Codex Harness',
    'Always run tests after modifying hooks or skills.',
    'After completing any task, output a HANDOFF block.',
  ].join('\n'));
  write(path.join(projectRoot, 'docs', 'ARCHITECTURE.md'), 'Telemetry records carry lineage IDs and hashes.\n');
  write(path.join(projectRoot, 'docs', 'CODEX_NATIVE_INTEGRATIONS.md'), 'Codex native surfaces keep Citadel campaign memory.\n');
  write(path.join(projectRoot, 'docs', 'FLEET.md'), 'Fleet work is dependency-aware.\n');
  write(path.join(projectRoot, 'docs', 'worktree-isolation.md'), 'Readiness reports can block Fleet.\n');
  write(path.join(projectRoot, 'docs', 'CONSTITUTION.md'), 'Rule hierarchy.\n');
  write(path.join(projectRoot, 'docs', 'SKILLS.md'), 'Skill contracts.\n');
  write(path.join(projectRoot, 'scripts', 'test-all.js'), 'console.log("tests");\n');
  write(path.join(projectRoot, 'scripts', 'verify-telemetry-integrity.js'), 'console.log("verify");\n');
  write(path.join(projectRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node scripts/test-all.js' } }, null, 2));
  write(path.join(projectRoot, '.planning', 'research', 'patterns.md'), [
    '**What it is:** HANDOFF blocks need typed fields.',
    '- Hung agents need timeout behavior.',
  ].join('\n'));
  write(path.join(projectRoot, '.planning', 'research', 'external-insights-brief.md'), 'A wiki is a compiler.\n');
  write(path.join(projectRoot, '.planning', 'telemetry', 'hook-errors.jsonl'), '{"hook":"test"}\n');
  write(path.join(projectRoot, '.planning', 'user-preferences.md'), 'Prefer short verification summaries with evidence links.\n');
  write(path.join(projectRoot, '.planning', 'campaigns', 'citadel-competitor-gap-assessment.md'), [
    '# Campaign',
    'Status: active',
    '## Decision Log',
    '- User approved proceeding from research package into implementation.',
    '- Plan 4 implemented telemetry integrity.',
  ].join('\n'));

  const result = compileMemoryBlocks(projectRoot, { now: verifiedAt });
  assert.equal(result.blocks.length, 5);
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'memory', 'index.json')));
  for (const type of BLOCK_TYPES) {
    assert(result.blocks.some((block) => block.type === type), `missing block type ${type}`);
  }
  for (const block of result.blocks) {
    assert(block.sources.length > 0, `${block.id} should link to sources`);
    assert(block.body.length > 40, `${block.id} should have compact body text`);
    assert.equal(block.generated_by, 'citadel-source-excerpts-v1');
    assert(block.sources.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)), 'sources should bind exact bytes');
  }
  assert(result.blocks.some((entry) => entry.body.includes('Prefer short verification summaries')), 'preferences should quote their actual source');
  assert(!result.blocks.some((entry) => entry.body.includes('The user approved proceeding from competitor research')), 'compiler must not invent approval');

  const lint = lintMemoryBlocks(projectRoot, { now: verifiedAt });
  assert.equal(lint.pass, true, JSON.stringify(lint.issues, null, 2));

  const scoped = loadMemoryBlocks(projectRoot, { scope: 'verification' });
  assert(scoped.length >= 1);
  assert(scoped.some((block) => block.type === 'verification-recipes'));

  const cli = execFileSync(process.execPath, [
    path.join(__dirname, 'memory-compile.js'),
    'list',
    '--project-root',
    projectRoot,
    '--scope',
    'telemetry',
    '--json',
  ], { encoding: 'utf8' });
  const matches = JSON.parse(cli);
  assert(matches.some((block) => block.id === 'memory-architecture-decisions'));

  write(path.join(projectRoot, 'AGENTS.md'), '# Updated rules\nPlan only until approval.\n');
  const changed = lintMemoryBlocks(projectRoot, { now: verifiedAt });
  assert(changed.issues.some((entry) => entry.type === 'stale' && entry.issue.includes('source content changed: AGENTS.md')));
  assert(!loadMemoryBlocks(projectRoot).some((entry) => entry.type === 'project-rules'), 'stale source records must not be retrieved as current');
  compileMemoryBlocks(projectRoot, { now: verifiedAt });
  assert.equal(lintMemoryBlocks(projectRoot, { now: verifiedAt }).pass, true);

  const authoredPath = path.join(projectRoot, '.planning', 'memory', 'blocks', 'memory-project-rules.json');
  const authored = JSON.parse(fs.readFileSync(authoredPath, 'utf8'));
  delete authored.generated_by;
  authored.owner = 'human';
  authored.body = 'Human-authored operating note; preserve exactly.';
  const authoredBytes = `${JSON.stringify(authored, null, 2)}\n`;
  fs.writeFileSync(authoredPath, authoredBytes);
  const preserved = compileMemoryBlocks(projectRoot, { now: verifiedAt });
  assert.equal(fs.readFileSync(authoredPath, 'utf8'), authoredBytes, 'compile must preserve unmarked human-authored blocks');
  assert(preserved.preserved.some((entry) => entry.file === authoredPath));

  const editedPath = path.join(projectRoot, '.planning', 'memory', 'blocks', 'memory-architecture-decisions.json');
  const edited = JSON.parse(fs.readFileSync(editedPath, 'utf8'));
  edited.body = 'An author edited the generated note without removing its provenance marker.';
  const editedBytes = `${JSON.stringify(edited, null, 2)}\n`;
  fs.writeFileSync(editedPath, editedBytes);
  const editedResult = compileMemoryBlocks(projectRoot, { now: verifiedAt });
  assert.equal(fs.readFileSync(editedPath, 'utf8'), editedBytes, 'manual edits to a generated block must also be preserved');
  assert(editedResult.preserved.some((entry) => entry.file === editedPath));

  delete authored.sources[0].sha256;
  fs.writeFileSync(authoredPath, JSON.stringify(authored));
  assert(lintMemoryBlocks(projectRoot, { now: verifiedAt }).issues
    .some((entry) => entry.issue.includes('source content is unverified')), 'legacy sources without digests must not be freshly endorsed');

  fs.unlinkSync(path.join(projectRoot, 'AGENTS.md'));
  const broken = lintMemoryBlocks(projectRoot, { now: verifiedAt });
  assert.equal(broken.pass, false);
  assert(broken.issues.some((issue) => issue.issue.includes('AGENTS.md')));
});

withTempProject((projectRoot) => {
  const empty = compileMemoryBlocks(projectRoot);
  assert.equal(empty.blocks.length, 0, 'blank projects have no invented memory');
  assert.equal(lintMemoryBlocks(projectRoot).pass, true, 'absent categories are not evidence of a defect');
  write(path.join(projectRoot, 'AGENTS.md'), '# Recipe app\nOnly repair the ingredient importer.\n');
  const unrelated = compileMemoryBlocks(projectRoot);
  assert.deepEqual(unrelated.blocks.map((entry) => entry.type).sort(), ['project-rules', 'verification-recipes']);
  assert(unrelated.blocks.every((entry) => entry.body.includes('Only repair the ingredient importer.')));
  assert(unrelated.blocks.every((entry) => !entry.body.includes('Citadel harness') && !entry.body.includes('user approved')));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, 'AGENTS.md'), '# Recipe app\nPlan only.\n');
  const legacyPath = path.join(projectRoot, '.planning', 'memory', 'blocks', 'memory-user-preferences.json');
  const legacyBytes = `${JSON.stringify({ id: 'memory-user-preferences', type: 'user-preferences',
    owner: 'citadel', confidence: 'high', scope: ['user'], last_verified: new Date().toISOString().slice(0, 10),
    sources: [{ path: 'AGENTS.md', reason: 'handoff and verification expectations' }],
    body: '- The user approved proceeding from competitor research into implementation.' }, null, 2)}\n`;
  write(legacyPath, legacyBytes);
  assert.equal(loadMemoryBlocks(projectRoot).length, 0, 'legacy fabricated blocks without source digests must not be retrieved');
  const inspected = lintMemoryBlocks(projectRoot);
  assert.equal(inspected.pass, false);
  assert.equal(inspected.blocks[0].freshness, 'unverified');
  compileMemoryBlocks(projectRoot);
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), legacyBytes, 'upgrade must preserve unowned legacy bytes');
  assert(!loadMemoryBlocks(projectRoot).some((entry) => entry.id === 'memory-user-preferences'));
  const cli = execFileSync(process.execPath, [path.join(__dirname, 'memory-compile.js'), 'list',
    '--project-root', projectRoot, '--json'], { encoding: 'utf8' });
  assert(!JSON.parse(cli).some((entry) => entry.body.includes('The user approved proceeding')),
    'public list consumer must not return the historical fabricated approval');
});

console.log('memory block tests passed');

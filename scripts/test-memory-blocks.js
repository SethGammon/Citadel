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
  write(path.join(projectRoot, '.planning', 'campaigns', 'citadel-competitor-gap-assessment.md'), [
    '# Campaign',
    'Status: active',
    '## Decision Log',
    '- User approved proceeding from research package into implementation.',
    '- Plan 4 implemented telemetry integrity.',
  ].join('\n'));

  const result = compileMemoryBlocks(projectRoot, { now: new Date('2026-06-04T12:00:00.000Z') });
  assert.equal(result.blocks.length, 5);
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'memory', 'index.json')));
  for (const type of BLOCK_TYPES) {
    assert(result.blocks.some((block) => block.type === type), `missing block type ${type}`);
  }
  for (const block of result.blocks) {
    assert(block.sources.length > 0, `${block.id} should link to sources`);
    assert(block.body.length > 40, `${block.id} should have compact body text`);
  }

  const lint = lintMemoryBlocks(projectRoot, { now: new Date('2026-06-04T12:00:00.000Z') });
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

  fs.unlinkSync(path.join(projectRoot, 'AGENTS.md'));
  const broken = lintMemoryBlocks(projectRoot, { now: new Date('2026-06-04T12:00:00.000Z') });
  assert.equal(broken.pass, false);
  assert(broken.issues.some((issue) => issue.issue.includes('AGENTS.md')));
});

console.log('memory block tests passed');

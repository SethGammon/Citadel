#!/usr/bin/env node
'use strict';

// AGENTS.md as the preferred project guidance: delegated-agent context refresh,
// AGENTS.md load tracking at SessionStart, and the FileChanged watch list.

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  PREVIOUS_TEMPLATE_DIGESTS,
  contentDigest,
  syncAgentContext,
} = require('../core/project/agent-context');

const repo = path.resolve(__dirname, '..');
const templateDir = path.join(repo, 'templates', 'agent-context');
// The rules-summary.md Citadel shipped before AGENTS.md became preferred.
// Normalized to LF so the CRLF case below is built the same way on every checkout.
const PREVIOUS_RULES = fs.readFileSync(path.join(__dirname, 'fixtures', 'agent-context-rules-summary-previous.md'), 'utf8')
  .replace(/\r\n/g, '\n');

// When a template file changes, move its old digest into
// PREVIOUS_TEMPLATE_DIGESTS (core/project/agent-context.js) so existing
// project copies refresh, then update the expected digest here.
const CURRENT_TEMPLATE_DIGESTS = Object.freeze({
  'rules-summary.md': '37cd653c30ca98866ce1767d545eba5dc9f21514b6be298b37658c33aef7e283',
});

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  PASS ${name}`);
}

function runHook(script, projectRoot, env = {}) {
  return execFileSync(process.execPath, [path.join(repo, 'hooks_src', script)], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: '{}',
    env: { ...process.env, CITADEL_RUNTIME: '', CLAUDE_PROJECT_DIR: projectRoot, ...env },
  });
}

function readQueue(projectRoot) {
  const queue = path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl');
  if (!fs.existsSync(queue)) return [];
  return fs.readFileSync(queue, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-agents-md-'));
try {
  test('template digests are pinned and earlier versions are refreshable', () => {
    assert(PREVIOUS_TEMPLATE_DIGESTS['rules-summary.md'].includes(contentDigest(PREVIOUS_RULES)),
      'the previous-template fixture must be a recognised earlier version');
    for (const file of fs.readdirSync(templateDir)) {
      const digest = contentDigest(fs.readFileSync(path.join(templateDir, file), 'utf8'));
      assert.equal(digest, CURRENT_TEMPLATE_DIGESTS[file],
        `${file} changed: add its previous digest to PREVIOUS_TEMPLATE_DIGESTS, then update CURRENT_TEMPLATE_DIGESTS`);
      assert(!(PREVIOUS_TEMPLATE_DIGESTS[file] || []).includes(digest), `${file} current digest must not be listed as previous`);
    }
  });

  test('delegated-agent context tells agents to prefer AGENTS.md', () => {
    const rules = fs.readFileSync(path.join(templateDir, 'rules-summary.md'), 'utf8');
    assert.match(rules, /Read AGENTS\.md first/);
    assert.doesNotMatch(rules, /Read CLAUDE\.md before/);
  });

  test('sync creates, refreshes unmodified old copies, and preserves edits', () => {
    const target = path.join(root, 'sync', 'agent-context');
    assert.deepEqual(syncAgentContext(templateDir, target).created, ['rules-summary.md']);

    const file = path.join(target, 'rules-summary.md');
    // CRLF checkouts of an earlier template must still be recognised.
    fs.writeFileSync(file, PREVIOUS_RULES.replace(/\n/g, '\r\n'));
    assert.deepEqual(syncAgentContext(templateDir, target).refreshed, ['rules-summary.md']);
    assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(templateDir, 'rules-summary.md'), 'utf8'));

    fs.writeFileSync(file, `${PREVIOUS_RULES}\n## Local rule\n`);
    assert.deepEqual(syncAgentContext(templateDir, target).preserved, ['rules-summary.md']);
    assert.match(fs.readFileSync(file, 'utf8'), /## Local rule/);
  });

  test('init-project refreshes a stale agent-context copy on session start', () => {
    const project = path.join(root, 'init');
    const context = path.join(project, '.claude', 'agent-context');
    fs.mkdirSync(context, { recursive: true });
    fs.writeFileSync(path.join(context, 'rules-summary.md'), PREVIOUS_RULES);
    runHook('init-project.js', project, { CITADEL_RUNTIME: 'claude-code' });
    assert.match(fs.readFileSync(path.join(context, 'rules-summary.md'), 'utf8'), /Read AGENTS\.md first/);
  });

  test('init-project queues doc-sync when AGENTS.md changed since the last session', () => {
    const project = path.join(root, 'agents-load');
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    const agents = path.join(project, 'AGENTS.md');
    fs.writeFileSync(agents, '# Guidance\n');
    runHook('init-project.js', project, { CITADEL_RUNTIME: 'claude-code' });
    assert.equal(readQueue(project).filter((entry) => entry.file === 'AGENTS.md').length, 0, 'first load only records state');

    const later = new Date(Date.now() + 60000);
    fs.utimesSync(agents, later, later);
    runHook('init-project.js', project, { CITADEL_RUNTIME: 'claude-code' });
    const queued = readQueue(project).filter((entry) => entry.file === 'AGENTS.md');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].event, 'instructions-changed');
  });

  test('instructions-watch returns AGENTS.md, CLAUDE.md and rules as watchPaths', () => {
    const project = path.join(root, 'watch');
    fs.mkdirSync(path.join(project, '.claude', 'rules', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'rules', 'style.md'), '# style\n');
    fs.writeFileSync(path.join(project, '.claude', 'rules', 'nested', 'api.md'), '# api\n');
    fs.writeFileSync(path.join(project, '.claude', 'rules', 'notes.txt'), 'not a rule\n');
    const output = JSON.parse(runHook('instructions-watch.js', project));
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    const watched = output.hookSpecificOutput.watchPaths.map((entry) => path.relative(project, entry).replace(/\\/g, '/')).sort();
    assert.deepEqual(watched, ['.claude/rules/nested/api.md', '.claude/rules/style.md', 'AGENTS.md', 'CLAUDE.md']);
    for (const entry of output.hookSpecificOutput.watchPaths) assert(path.isAbsolute(entry));
  });

  test('instructions-watch stays silent outside Claude Code', () => {
    const project = path.join(root, 'watch');
    for (const runtime of ['codex', 'opencode']) {
      assert.equal(runHook('instructions-watch.js', project, { CITADEL_RUNTIME: runtime }), '');
    }
    assert.notEqual(runHook('instructions-watch.js', project, { CITADEL_RUNTIME: 'claude-code' }), '');
  });

  test('file-changed queues doc-sync for AGENTS.md', () => {
    const project = path.join(root, 'file-changed');
    fs.mkdirSync(path.join(project, '.planning', 'telemetry'), { recursive: true });
    execFileSync(process.execPath, [path.join(repo, 'hooks_src', 'file-changed.js')], {
      cwd: project,
      encoding: 'utf8',
      input: JSON.stringify({ file_path: path.join(project, 'AGENTS.md'), change_type: 'modified' }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    });
    assert.deepEqual(readQueue(project).map((entry) => entry.file), ['AGENTS.md']);
  });

  console.log(`AGENTS.md guidance tests passed: ${passed}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

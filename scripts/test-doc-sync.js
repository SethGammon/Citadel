#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  processDocSyncQueue,
  renderResult,
  summarizeEntries,
} = require('../hooks_src/doc-sync');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-doc-sync-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempProject((projectRoot) => {
  const now = '2026-06-05T12:00:00.000Z';
  write(path.join(projectRoot, 'CLAUDE.md'), '# Guidance\n');
  write(path.join(projectRoot, 'src', 'api.js'), 'export function run() {}\n');
  write(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'), [
    JSON.stringify({ event: 'file-changed', file: 'CLAUDE.md', status: 'needs-review', timestamp: now }),
    JSON.stringify({ event: 'potential-staleness', file: 'src/api.js', status: 'needs-review', timestamp: now }),
    JSON.stringify({ event: 'potential-staleness', file: 'src/api.js', status: 'needs-review', timestamp: now }),
    JSON.stringify({ event: 'session-end', status: 'pending', timestamp: now }),
    JSON.stringify({ event: 'file-changed', file: 'deleted.md', status: 'needs-review', timestamp: now }),
    JSON.stringify({ event: 'old', file: 'CLAUDE.md', status: 'surfaced', timestamp: now }),
  ].join('\n') + '\n');

  const entries = readJsonl(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'));
  const summary = summarizeEntries(projectRoot, entries);
  assert.equal(summary.pending.length, 5);
  assert.equal(summary.files.length, 2);
  assert.equal(summary.general.length, 1);
  assert.equal(summary.deleted.length, 1);

  const result = processDocSyncQueue(projectRoot, { now });
  assert.equal(result.summary.pending.length, 5);
  assert.equal(result.summary.files.length, 2);
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'doc-sync', 'latest.md')));

  const report = fs.readFileSync(path.join(projectRoot, '.planning', 'doc-sync', 'latest.md'), 'utf8');
  assert(report.includes('# Doc Sync Review'));
  assert(report.includes('- CLAUDE.md'));
  assert(report.includes('- src/api.js'));
  assert(report.includes('- session-end: 1'));

  const updated = readJsonl(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'));
  assert.equal(updated.filter(entry => entry.status === 'needs-review' || entry.status === 'pending').length, 0);
  assert.equal(updated.filter(entry => entry.status === 'surfaced').length, 5);
  assert.equal(updated.filter(entry => entry.status === 'skipped-deleted').length, 1);

  const rendered = renderResult(result);
  assert(rendered.includes('[doc-sync] 5 item(s) processed.'));
  assert(rendered.includes('2 file(s) may need doc updates:'));
  assert(rendered.includes('1 general event(s) surfaced.'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'), [
    JSON.stringify({ event: 'session-end', status: 'pending' }),
  ].join('\n') + '\n');

  const output = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'hooks_src', 'doc-sync.js'),
    '--project-root',
    projectRoot,
    '--dry-run',
  ], { encoding: 'utf8' });

  assert(output.includes('[doc-sync] 1 item(s) processed.'));
  assert(output.includes('Report: not written (dry run)'));
  assert(!fs.existsSync(path.join(projectRoot, '.planning', 'doc-sync', 'latest.md')));
  const entries = readJsonl(path.join(projectRoot, '.planning', 'telemetry', 'doc-sync-queue.jsonl'));
  assert.equal(entries[0].status, 'pending');
});

console.log('doc-sync tests passed');

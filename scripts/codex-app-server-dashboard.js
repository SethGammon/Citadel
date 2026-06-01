#!/usr/bin/env node

'use strict';

const fs = require('fs');
const {
  summarizeAppServerEvents,
  writeAppServerDashboard,
} = require('../core/codex/native-integrations');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/codex-app-server-dashboard.js --file app-server.jsonl [--project-root PATH] [--out-dir PATH]');
  process.exit(0);
}

const file = arg('--file', null);
const input = file ? fs.readFileSync(file, 'utf8') : readStdin();
const summary = summarizeAppServerEvents(input);

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const result = writeAppServerDashboard({
  projectRoot: arg('--project-root', process.cwd()),
  outDir: arg('--out-dir', null),
  source: arg('--source', file || 'stdin'),
  summary,
});

console.log(JSON.stringify(result, null, 2));
process.exit(0);

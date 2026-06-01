#!/usr/bin/env node

'use strict';

const fs = require('fs');
const { ingestCodexReview } = require('../core/codex/native-integrations');

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

const file = arg('--file', null);
const input = file ? fs.readFileSync(file, 'utf8') : readStdin();
if (!input.trim()) {
  console.error('Usage: node scripts/codex-review-ingest.js --repo owner/name --pr N --file review-comments.json [--write]');
  process.exit(1);
}

const result = ingestCodexReview({
  projectRoot: arg('--project-root', process.cwd()),
  repo: arg('--repo', 'current-repo'),
  prNumber: arg('--pr', 'current'),
  authorHint: arg('--author', 'codex'),
  input,
  write: process.argv.includes('--write'),
});

console.log(JSON.stringify(result, null, 2));
process.exit(0);

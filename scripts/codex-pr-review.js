#!/usr/bin/env node

'use strict';

const {
  createPrReviewPlan,
  ingestCodexReview,
  recordPrReviewResult,
} = require('../core/codex/native-integrations');
const fs = require('fs');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

const mode = process.argv[2] || 'plan';

if (mode === 'plan') {
  print(createPrReviewPlan({
    projectRoot: arg('--project-root', process.cwd()),
    repo: arg('--repo', 'current-repo'),
    prNumber: arg('--pr', 'current'),
    risk: arg('--risk', 'medium'),
    changedFiles: arg('--changed-files', 0),
    write: process.argv.includes('--write'),
  }));
} else if (mode === 'record') {
  print(recordPrReviewResult({
    projectRoot: arg('--project-root', process.cwd()),
    repo: arg('--repo', 'current-repo'),
    prNumber: arg('--pr', 'current'),
    source: arg('--source', 'codex-review'),
    status: arg('--status', 'recorded'),
    summary: arg('--summary', ''),
  }));
} else if (mode === 'ingest') {
  const file = arg('--file', null);
  const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  print(ingestCodexReview({
    projectRoot: arg('--project-root', process.cwd()),
    repo: arg('--repo', 'current-repo'),
    prNumber: arg('--pr', 'current'),
    authorHint: arg('--author', 'codex'),
    input,
    write: process.argv.includes('--write'),
  }));
} else {
  console.error('Usage: node scripts/codex-pr-review.js <plan|record|ingest> --repo owner/name --pr N');
  process.exit(1);
}

#!/usr/bin/env node

'use strict';

const {
  createAutomationPlan,
  recordAutomationRun,
} = require('../core/codex/native-integrations');

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
  print(createAutomationPlan({
    projectRoot: arg('--project-root', process.cwd()),
    type: arg('--type', 'schedule'),
    command: arg('--command', '/do status'),
    cadence: arg('--cadence', 'manual'),
    target: arg('--target', null),
    write: process.argv.includes('--write'),
  }));
} else if (mode === 'record') {
  print(recordAutomationRun({
    projectRoot: arg('--project-root', process.cwd()),
    id: arg('--id'),
    status: arg('--status', 'recorded'),
    summary: arg('--summary', ''),
    evidence: arg('--evidence', '').split(',').filter(Boolean),
  }));
} else {
  console.error('Usage: node scripts/codex-automation.js <plan|record> [--write] [--type schedule|daemon|pr-watch] [--command "..."]');
  process.exit(1);
}

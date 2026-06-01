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

const file = arg('--file', null);
const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
const summary = summarizeAppServerEvents(input);
if (process.argv.includes('--write-dashboard')) {
  console.log(JSON.stringify(writeAppServerDashboard({
    projectRoot: arg('--project-root', process.cwd()),
    source: file || 'stdin',
    summary,
  }), null, 2));
} else {
  console.log(JSON.stringify(summary, null, 2));
}

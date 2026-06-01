#!/usr/bin/env node

'use strict';

const { checkCodexReadiness } = require('../core/codex/native-integrations');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const report = checkCodexReadiness({
  projectRoot: arg('--project-root', process.cwd()),
  write: process.argv.includes('--write'),
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);

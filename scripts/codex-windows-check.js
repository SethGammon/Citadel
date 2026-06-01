#!/usr/bin/env node

'use strict';

const { detectWindowsCodexSetup } = require('../core/codex/native-integrations');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const report = detectWindowsCodexSetup({
  projectRoot: arg('--project-root', process.cwd()),
  platform: arg('--platform', process.platform),
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);

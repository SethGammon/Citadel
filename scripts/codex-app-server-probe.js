#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const { createAppServerProbe } = require('../core/codex/native-integrations');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const probe = createAppServerProbe({
  listen: arg('--listen', 'stdio://'),
  wsAuth: arg('--ws-auth', null),
  wsTokenFile: arg('--ws-token-file', null),
});

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(probe, null, 2));
  process.exit(0);
}

const result = spawnSync(probe.command, [...probe.args, '--help'], {
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});

console.log(JSON.stringify({
  ...probe,
  available: result.status === 0,
  stdout: (result.stdout || '').slice(0, 2000),
  stderr: (result.stderr || '').slice(0, 2000),
}, null, 2));
process.exit(result.status === 0 ? 0 : 1);

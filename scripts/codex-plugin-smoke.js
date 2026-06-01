#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const { createPluginMarketplace } = require('../core/codex/native-integrations');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status,
    pass: result.status === 0,
    stdout: (result.stdout || '').slice(0, 4000),
    stderr: (result.stderr || '').slice(0, 4000),
    error: result.error ? result.error.message : null,
  };
}

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/codex-plugin-smoke.js [--project-root PATH] [--write] [--live] [--add-marketplace]');
  process.exit(0);
}

const projectRoot = arg('--project-root', process.cwd());
const live = process.argv.includes('--live') || process.argv.includes('--add-marketplace');
const marketplace = createPluginMarketplace({
  projectRoot,
  write: process.argv.includes('--write') || process.argv.includes('--add-marketplace'),
});

const cliChecks = [];
if (live) {
  cliChecks.push(run('codex', ['--version']));
  cliChecks.push(run('codex', ['plugin', 'marketplace', '--help']));
}
if (process.argv.includes('--add-marketplace')) {
  cliChecks.push(run('codex', ['plugin', 'marketplace', 'add', projectRoot]));
  cliChecks.push(run('codex', ['plugin', 'marketplace', '--help']));
}

const report = {
  ...marketplace,
  live,
  cliChecks,
  pass: marketplace.pass && cliChecks.every((check) => check.pass),
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);

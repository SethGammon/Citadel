#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { platformInvocation } = require('../core/forks/launcher');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-consumer-package-'));

function npm(args, cwd) {
  const invocation = platformInvocation({ command: 'npm', args });
  const result = spawnSync(invocation.command, invocation.args, {
    cwd, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 60000,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

try {
  const archive = JSON.parse(npm(['pack', '--json', '--pack-destination', temp], root))[0].filename;
  const consumer = path.join(temp, 'consumer with spaces');
  fs.mkdirSync(consumer);
  npm(['install', '--prefix', consumer, path.join(temp, archive), '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], consumer);
  const installed = path.join(consumer, 'node_modules', 'citadel');
  for (const required of [
    'scripts/run-with-timeout.js', 'core/forks/launcher.js',
    'core/contracts/events.js', 'core/policy/external-actions.js',
    'core/security/shell-containment.js',
  ]) assert(fs.existsSync(path.join(installed, required)), `consumer package is missing ${required}`);
  const arg = 'literal " & echo NEVER_EXECUTE & "';
  const result = spawnSync(process.execPath, [
    path.join(installed, 'scripts', 'run-with-timeout.js'), '15', process.execPath,
    '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', arg,
  ], { cwd: consumer, encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), [arg]);
  console.log('Codex consumer package closure passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

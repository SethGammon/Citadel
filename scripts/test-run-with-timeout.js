#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findOnPath } = require('../core/forks/launcher');

const wrapper = path.join(__dirname, 'run-with-timeout.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-timeout-'));
const project = path.join(root, 'project with spaces');
fs.mkdirSync(project);

function run(command, args, seconds = 15) {
  return spawnSync(process.execPath, [wrapper, String(seconds), command, ...args], {
    cwd: project, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: (seconds + 10) * 1000,
  });
}

try {
  const marker = path.join(project, 'injected.txt');
  const values = ['x" & echo PR328_MARKER & "', 'space value', 'a|b', 'a^b', 'a%b', marker];
  const echoArgs = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
  const literal = run(process.execPath, ['-e', echoArgs, ...values]);
  assert.strictEqual(literal.status, 0, literal.stderr);
  assert.deepStrictEqual(JSON.parse(literal.stdout), values);
  assert(!fs.existsSync(marker), 'a shell metacharacter in argv must not execute another command');

  const script = path.join(project, 'script with spaces.js');
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n');
  const spaced = run(process.execPath, [script, 'quoted " value', 'with spaces']);
  assert.strictEqual(spaced.status, 0, spaced.stderr);
  assert.deepStrictEqual(JSON.parse(spaced.stdout), ['quoted " value', 'with spaces']);

  if (process.platform === 'win32') {
    const binary = path.join(project, 'node with spaces.exe');
    fs.copyFileSync(process.execPath, binary);
    const executable = run(binary, ['-e', echoArgs, 'literal & | ^ % "']);
    assert.strictEqual(executable.status, 0, executable.stderr);
    assert.deepStrictEqual(JSON.parse(executable.stdout), ['literal & | ^ % "']);
    for (const command of ['npm', 'npx']) {
      const result = run(command, ['--version'], 30);
      assert.strictEqual(result.status, 0, `${command}: ${result.stderr}`);
      assert(/^\d+\.\d+\./.test(result.stdout.trim()), `${command} did not run its trusted CLI`);
      const shim = findOnPath(`${command}.cmd`, process.env);
      assert(shim, `${command}.cmd must resolve for the explicit-shim regression`);
      const explicit = run(shim, ['--version'], 30);
      assert.strictEqual(explicit.status, 0, `${shim}: ${explicit.stderr}`);
    }
    const unsafe = path.join(project, 'unknown.cmd');
    fs.writeFileSync(unsafe, `@echo off\r\necho unsafe > "${marker}"\r\n`);
    const rejected = run(unsafe, []);
    assert.strictEqual(rejected.status, 1);
    assert(!fs.existsSync(marker), 'an unknown batch shim must fail closed');
  }

  const late = path.join(project, 'grandchild-survived.txt');
  const grandchild = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(late)}, 'late'), 3500)`;
  const parent = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000)`;
  const timeout = run(process.execPath, ['-e', parent], 1);
  assert.strictEqual(timeout.status, 124, timeout.stderr);
  assert(/Command exceeded 1s/.test(timeout.stderr));
  const receipt = JSON.parse(fs.readFileSync(path.join(project, '.planning', 'telemetry', 'last-command-result.json'), 'utf8'));
  assert.strictEqual(receipt.timedOut, true);
  spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { timeout: 6000 });
  assert(!fs.existsSync(late), 'timeout must kill the descendant process tree');

  console.log('timeout wrapper physical tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

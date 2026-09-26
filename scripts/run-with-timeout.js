#!/usr/bin/env node

/**
 * run-with-timeout.js -- Cross-platform command timeout wrapper
 *
 * Usage: node scripts/run-with-timeout.js <seconds> <command> [args...]
 *
 * Runs the command as a child process with a timeout. If the command
 * exceeds the time limit, it kills the process tree and exits with
 * a clear message.
 * On Windows, executable images and known Node-package shims such as npm/npx
 * are supported; arbitrary batch shims fail closed rather than using cmd.exe.
 *
 * After completion (normal or timeout), writes the result to
 * .planning/telemetry/last-command-result.json for watchdog pickup.
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { platformInvocation } = require('../core/forks/launcher');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 2) {
  process.stderr.write(
    'Usage: node scripts/run-with-timeout.js <seconds> <command> [args...]\n' +
    'Example: node scripts/run-with-timeout.js 300 npm test\n'
  );
  process.exit(1);
}

const timeoutSec = Number(args[0]);
if (!Number.isSafeInteger(timeoutSec) || timeoutSec <= 0) {
  process.stderr.write(`[timeout] Invalid timeout: "${args[0]}". Must be a positive integer (seconds).\n`);
  process.exit(1);
}

const command = args[1];
const commandArgs = args.slice(2);
const fullCommand = [command, ...commandArgs].join(' ');

// ── Run ──────────────────────────────────────────────────────────────────────

const startTime = Date.now();
let timedOut = false;
let outputChunks = [];

const isWindows = process.platform === 'win32';

// Never interpolate argv into a shell. Windows npm/npx shims are resolved to
// their JavaScript entrypoints, while executable images launch directly.
let invocation;
try {
  invocation = platformInvocation({ command, args: commandArgs });
} catch (error) {
  process.stderr.write(`[timeout] Failed to resolve command safely: ${error.message}\n`);
  process.exit(1);
}
const child = spawn(invocation.command, invocation.args, {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: false,
  windowsVerbatimArguments: false,
  detached: !isWindows,
  cwd: PROJECT_ROOT,
  env: process.env,
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  outputChunks.push(chunk.toString());
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  outputChunks.push(chunk.toString());
});

const timer = setTimeout(() => {
  timedOut = true;
  process.stderr.write(
    `\n[timeout] Command exceeded ${timeoutSec}s limit and was killed.\n` +
    `  Command: ${fullCommand}\n` +
    `  Duration: ${timeoutSec}s (limit)\n`
  );

  // Kill the process tree
  try {
    if (isWindows) {
      // taskkill /T kills the tree, /F forces it
      const killer = spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], { stdio: 'ignore', shell: false });
      killer.on('error', () => { try { child.kill('SIGKILL'); } catch { /* already dead */ } });
      killer.on('close', (code) => {
        if (code !== 0) { try { child.kill('SIGKILL'); } catch { /* already dead */ } }
      });
    } else {
      // Negative PID kills the process group
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    // Process may have already exited
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  }
}, timeoutSec * 1000);

child.on('close', (exitCode) => {
  clearTimeout(timer);
  const durationMs = Date.now() - startTime;
  const durationSec = Math.round(durationMs / 1000);

  // Write result for watchdog
  writeResult({
    command: fullCommand,
    exitCode: timedOut ? null : exitCode,
    timedOut,
    durationSec,
    durationMs,
    output: outputChunks.join('').slice(-500),
    timestamp: new Date().toISOString(),
    timeoutLimit: timeoutSec,
  });

  if (timedOut) {
    process.exit(124); // Standard timeout exit code (matches GNU timeout)
  } else {
    process.exit(typeof exitCode === 'number' ? exitCode : 1);
  }
});

child.on('error', (err) => {
  clearTimeout(timer);
  const durationMs = Date.now() - startTime;

  process.stderr.write(`[timeout] Failed to start command: ${err.message}\n`);

  writeResult({
    command: fullCommand,
    exitCode: null,
    timedOut: false,
    error: err.message,
    durationSec: Math.round(durationMs / 1000),
    durationMs,
    output: '',
    timestamp: new Date().toISOString(),
    timeoutLimit: timeoutSec,
  });

  process.exit(1);
});

// ── Result file ──────────────────────────────────────────────────────────────

function writeResult(result) {
  try {
    const telemetryDir = path.join(PROJECT_ROOT, '.planning', 'telemetry');
    if (!fs.existsSync(telemetryDir)) {
      fs.mkdirSync(telemetryDir, { recursive: true });
    }
    const resultPath = path.join(telemetryDir, 'last-command-result.json');
    const tmpPath = resultPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(result, null, 2));
    fs.renameSync(tmpPath, resultPath);
  } catch {
    // Non-fatal -- don't fail the command because telemetry couldn't write
  }
}

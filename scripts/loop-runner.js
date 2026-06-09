#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const {
  appendLoopRun,
  registerLoop,
  stopLoop,
} = require('../core/loops/registry');
const { createLoopContract } = require('../core/loops/contract');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  return [
    'Usage:',
    '  node scripts/loop-runner.js --action "<shell command>" --verify "<shell command>" [--max-attempts 3] [--write]',
    '',
    'Runs an explicit bounded foreground loop. The verifier controls success.',
  ].join('\n');
}

function runShell(command, cwd) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    command,
    exitCode: result.status === null ? 1 : result.status,
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || '').slice(-4000),
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const projectRoot = path.resolve(arg('--project-root', process.cwd()));
  const action = arg('--action');
  const verify = arg('--verify');
  const maxAttempts = Number(arg('--max-attempts', 3));
  const write = hasFlag('--write') || hasFlag('--run');

  if (!verify) {
    process.stderr.write('Missing --verify. A bounded loop needs a verifier.\n');
    process.exit(1);
  }
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    process.stderr.write('--max-attempts must be >= 1.\n');
    process.exit(1);
  }

  const contractPlan = createLoopContract({
    type: 'foreground-loop',
    title: arg('--title') || action || verify,
    goal: arg('--goal') || action || verify,
    command: action || null,
    verifierCommand: verify,
    maxAttempts,
    triggerKind: 'manual',
    status: write ? 'running' : 'planned',
  });

  if (!write) {
    process.stdout.write(`Loop planned: ${contractPlan.id}\n`);
    process.stdout.write(`State: ${contractPlan.statePath}\n`);
    process.stdout.write('Pass --write or --run to execute.\n');
    return;
  }

  const contract = registerLoop(projectRoot, contractPlan);

  let finalStatus = 'attempt-limit';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (action) {
      const actionResult = runShell(action, projectRoot);
      appendLoopRun(projectRoot, contract.id, {
        attempt,
        status: actionResult.exitCode === 0 ? 'running' : 'blocked',
        summary: actionResult.exitCode === 0 ? 'action completed' : 'action failed',
        command: action,
        exitCode: actionResult.exitCode,
        startedAt: actionResult.startedAt,
        completedAt: actionResult.completedAt,
      });
      if (actionResult.exitCode !== 0) {
        finalStatus = 'blocked';
        break;
      }
    }

    const verifierResult = runShell(verify, projectRoot);
    const passed = verifierResult.exitCode === 0;
    appendLoopRun(projectRoot, contract.id, {
      attempt,
      status: passed ? 'verifier-passed' : (attempt >= maxAttempts ? 'attempt-limit' : 'running'),
      summary: passed ? 'verifier passed' : 'verifier failed',
      command: action || null,
      verifier: verify,
      exitCode: verifierResult.exitCode,
      startedAt: verifierResult.startedAt,
      completedAt: verifierResult.completedAt,
    });

    if (passed) {
      finalStatus = 'verifier-passed';
      break;
    }
  }

  const stopped = stopLoop(projectRoot, contract.id, finalStatus, finalStatus);
  process.stdout.write(`Loop stopped: ${stopped.id}\n`);
  process.stdout.write(`Status: ${stopped.status}\n`);
  process.stdout.write(`State: ${stopped.statePath}\n`);
  process.exit(finalStatus === 'verifier-passed' ? 0 : 1);
}

if (require.main === module) main();

#!/usr/bin/env node

'use strict';

const path = require('path');
const { registerLoop } = require('../core/loops/registry');
const { createLoopContract, validateLoopContract } = require('../core/loops/contract');
const { superviseLoop } = require('../core/loops/supervisor');

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
    '    [--max-duration-ms <positive integer>] [--command-timeout-ms <positive integer>]',
    '',
    'Runs an explicit bounded foreground loop. The verifier controls success.',
    'Commands must remain in the foreground. Command timeout defaults to 300000 ms.',
    'Without --write or --run, only a plan is printed; no commands or state writes occur.',
  ].join('\n');
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const projectRoot = path.resolve(arg('--project-root', process.cwd()));
  const action = arg('--action');
  const verify = arg('--verify');
  const maxAttempts = Number(arg('--max-attempts', 3));
  const write = hasFlag('--write') || hasFlag('--run');

  if (!verify?.trim()) throw new Error('Missing --verify. A bounded loop needs a verifier.');

  const contractPlan = createLoopContract({
    type: 'foreground-loop',
    title: arg('--title') || action || verify,
    goal: arg('--goal') || action || verify,
    command: action || null,
    verifierCommand: verify,
    maxAttempts,
    maxDurationMs: arg('--max-duration-ms') === null ? null : Number(arg('--max-duration-ms')),
    commandTimeoutMs: arg('--command-timeout-ms') === null ? undefined : Number(arg('--command-timeout-ms')),
    triggerKind: 'manual',
    status: write ? 'running' : 'planned',
  });
  const validation = validateLoopContract(contractPlan);
  if (!validation.pass) throw new Error(validation.errors.join('; '));

  if (!write) {
    process.stdout.write(`Loop planned: ${contractPlan.id}\n`);
    process.stdout.write(`State: ${contractPlan.statePath}\n`);
    process.stdout.write('Pass --write or --run to execute.\n');
    return;
  }

  const contract = registerLoop(projectRoot, contractPlan);
  process.stdout.write(`Loop started: ${contract.id}\n`);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  let stopped;
  try {
    stopped = await superviseLoop(projectRoot, contract.id, { signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  process.stdout.write(`Loop stopped: ${stopped.id}\n`);
  process.stdout.write(`Status: ${stopped.status}\n`);
  process.stdout.write(`State: ${stopped.statePath}\n`);
  const run = stopped.runs?.at(-1);
  const cleanupError = stopped.cleanupError || run?.verifierResult?.cleanupError || run?.actionResult?.cleanupError;
  if (cleanupError) process.stderr.write(`Command cleanup failed: ${cleanupError}\n`);
  process.exitCode = stopped.verified ? 0 : 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

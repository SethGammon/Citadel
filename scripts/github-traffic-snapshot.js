#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const {
  appendSnapshot,
  fetchCombinedResponse,
  normalizeSnapshot,
  parseRepository,
  redactSecrets,
} = require('../core/telemetry/github-traffic');

function parseArgs(argv) {
  const args = { outputRoot: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (['--repo', '--fixture', '--output-root', '--captured-at'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      args[{ '--repo': 'repo', '--fixture': 'fixture', '--output-root': 'outputRoot', '--captured-at': 'capturedAt' }[arg]] = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function help() {
  return [
    'Usage: node scripts/github-traffic-snapshot.js --repo owner/repo [options]',
    '',
    'Options:',
    '  --fixture <file>       Read a combined GitHub response without network access',
    '  --output-root <dir>    Root containing .planning/acquisition (default: cwd)',
    '  --captured-at <ISO>    Override capture time for deterministic tests',
    '  --json                 Print machine-readable result',
    '',
    'Live capture uses GH_TOKEN/GITHUB_TOKEN when set, otherwise the authenticated gh CLI.',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${help()}\n`);
    return null;
  }
  if (!args.repo) throw new Error('--repo owner/repo is required');
  parseRepository(args.repo);
  let combined;
  if (args.fixture) {
    combined = JSON.parse(fs.readFileSync(path.resolve(args.fixture), 'utf8'));
  } else {
    combined = await fetchCombinedResponse(args.repo);
  }
  const snapshot = normalizeSnapshot(combined, args.repo, args.capturedAt || new Date().toISOString());
  const saved = appendSnapshot(snapshot, path.resolve(args.outputRoot));
  const result = { file: saved.filePath, snapshot_count: saved.history.snapshots.length, snapshot };
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`Captured ${snapshot.repository} traffic at ${snapshot.captured_at}\nSaved ${saved.filePath} (${result.snapshot_count} snapshot${result.snapshot_count === 1 ? '' : 's'} today)\n`);
  return result;
}

if (require.main === module) {
  main().catch(error => {
    const secrets = [process.env.GH_TOKEN, process.env.GITHUB_TOKEN];
    process.stderr.write(`GitHub traffic snapshot failed: ${redactSecrets(error, secrets)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };

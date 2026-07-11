#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildMatrix,
  mergeMatrices,
  normalizeResult,
  stableId,
} = require('../core/golden-path/matrix');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--require-complete') args.requireComplete = true;
    else if (token.startsWith('--')) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
      args[token.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unexpected argument: ${token}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function parseRunnerJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) throw new Error('Golden-path runner produced no JSON result');
  try {
    return JSON.parse(text);
  } catch (_) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try { return JSON.parse(lines[index]); } catch (_) { /* continue */ }
    }
  }
  throw new Error('Golden-path runner output did not contain valid JSON');
}

function writeMatrix(file, matrix) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
}

function executeLocal(args) {
  const runner = path.resolve(args.runner || path.join(__dirname, 'golden-path.js'));
  const fixture = path.resolve(args.fixture || '');
  const repeat = Number(args.repeat);
  if (!args.fixture || !args.runtime || !args.repeat || !args.output) throw new Error('Local mode requires --fixture, --runtime, --repeat, and --output');
  if (!['claude', 'codex', 'both'].includes(args.runtime)) throw new Error('Invalid --runtime value');
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat must be a positive integer');
  const runtimes = args.runtime === 'both' ? ['claude', 'codex'] : [args.runtime];
  const runs = [];
  let fixtureId = null;
  for (const runtime of runtimes) {
    for (let iteration = 0; iteration < repeat; iteration += 1) {
      const child = spawnSync(process.execPath, [runner, '--runtime', runtime, '--fixture', fixture, '--json'], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      });
      if (child.error) throw child.error;
      const result = parseRunnerJson(child.stdout);
      if (result.platform !== process.platform) throw new Error('Runner platform does not match the actual local platform');
      if (result.runtime !== runtime) throw new Error('Runner runtime does not match the requested runtime');
      fixtureId = fixtureId || result.fixture_id;
      if (result.fixture_id !== fixtureId) throw new Error('Runner returned incompatible fixture_id values');
      const identity = `${path.resolve(args.output)}|${fixtureId}|${result.platform}|${runtime}|${iteration}`;
      runs.push(normalizeResult(result, { runId: stableId(identity) }));
    }
  }
  return buildMatrix({
    fixtureId,
    runs,
    sources: [{ kind: 'local-execution', platform: process.platform, fixture, runner, repeat }],
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) throw new Error('--output is required');
  let matrix;
  if (args.merge) {
    if (args.fixture || args.runtime || args.repeat || args.runner) throw new Error('--merge cannot be combined with local execution options');
    const files = args.merge.split(',').map((file) => file.trim()).filter(Boolean);
    matrix = mergeMatrices(files.map(readJson), { requireComplete: args.requireComplete });
    matrix.sources = [...new Set([...matrix.sources, ...files.map((file) => path.resolve(file))])];
  } else {
    matrix = executeLocal(args);
  }
  writeMatrix(args.output, matrix);
  process.stdout.write(`${JSON.stringify(matrix)}\n`);
  if (args.requireComplete && matrix.status !== 'passed') process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`golden-path-matrix: ${error.message}\n`);
  process.exitCode = 1;
}

module.exports = { executeLocal, parseArgs, parseRunnerJson };

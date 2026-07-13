#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const activation = require('../core/telemetry/activation');

const CITADEL_VERSION = require('../package.json').version;
const HELP = `Usage: node scripts/install.js --runtime <claude|codex> [runtime options]

Unified Citadel installer dispatcher.

Examples:
  node scripts/install.js --runtime claude --install --scope local
  node scripts/install.js --runtime codex --add-marketplace

Run the runtime-specific helper for all options:
  node scripts/claude-install.js --help
  node scripts/codex-install.js --help
`;

function arg(argv, name, fallback = null) {
  const prefix = `${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : fallback;
}

function has(argv, flag) {
  return argv.includes(flag);
}

function withoutRuntimeArgs(argv) {
  const result = [];
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '--runtime') {
      index++;
      continue;
    }
    if (item.startsWith('--runtime=')) continue;
    result.push(item);
  }
  return result;
}

function normalizeRuntime(runtime) {
  if (runtime === 'claude' || runtime === 'claude-code') return 'claude-code';
  if (runtime === 'codex') return 'codex';
  return 'unknown';
}

function targetRoot(argv, cwd = process.cwd()) {
  return path.resolve(arg(argv, '--project-root', arg(argv, '--target-project', cwd)));
}

function shouldRecordActivation(argv) {
  return !has(argv, '--dry-run') && !has(argv, '--plugin-only');
}

function acquisitionSource(env = process.env) {
  const value = env.CITADEL_ACQUISITION_SOURCE || 'unknown';
  return activation.ACQUISITION_SOURCES.includes(value) ? value : 'unknown';
}

function recordSafely(input, options) {
  try {
    if (!fs.existsSync(options.root) || !fs.statSync(options.root).isDirectory()) {
      return { recorded: false, reason: 'target_missing' };
    }
    return activation.record(input, options);
  } catch {
    return { recorded: false, reason: 'record_failed' };
  }
}

function execute(argv, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const clock = options.clock || (() => new Date());
  const spawn = options.spawnSync || spawnSync;

  if (has(argv, '--help') || has(argv, '-h')) return { status: 0, help: true };

  const runtimeArg = String(arg(argv, '--runtime', '')).toLowerCase();
  const scriptByRuntime = {
    claude: 'claude-install.js',
    'claude-code': 'claude-install.js',
    codex: 'codex-install.js',
  };
  const scriptName = scriptByRuntime[runtimeArg];
  if (!scriptName) return { status: 1, error: 'Missing or invalid --runtime. Expected claude or codex.' };

  const root = targetRoot(argv, cwd);
  const runtime = normalizeRuntime(runtimeArg);
  const records = [];
  const recordEnabled = shouldRecordActivation(argv);
  const startedAt = clock();
  if (recordEnabled) {
    records.push(recordSafely({
      stage: 'install_started', status: 'started', runtime,
      acquisition_source: acquisitionSource(env),
    }, { root, env, now: startedAt, version: CITADEL_VERSION }));
  }

  const scriptPath = path.join(__dirname, scriptName);
  const result = spawn(process.execPath, [scriptPath, ...withoutRuntimeArgs(argv)], {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  const endedAt = clock();
  const status = result.error ? 1 : (result.status ?? 1);

  if (recordEnabled) {
    records.push(recordSafely({
      stage: 'install_completed',
      status: status === 0 ? 'succeeded' : 'failed',
      runtime,
      duration_ms: Math.max(0, endedAt - startedAt),
      failure_code: status === 0 ? null : (result.error ? 'dependency_missing' : 'unknown_error'),
      acquisition_source: acquisitionSource(env),
    }, { root, env, now: endedAt, version: CITADEL_VERSION }));
  }

  return { status, error: result.error ? result.error.message : null, records };
}

function main() {
  const outcome = execute(process.argv.slice(2));
  if (outcome.help) process.stdout.write(HELP);
  if (outcome.error) process.stderr.write(`${outcome.error}\n`);
  process.exitCode = outcome.status;
}

if (require.main === module) main();

module.exports = {
  HELP, arg, withoutRuntimeArgs, normalizeRuntime, targetRoot,
  shouldRecordActivation, acquisitionSource, recordSafely, execute,
};

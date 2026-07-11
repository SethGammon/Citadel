#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const activation = require('../core/telemetry/activation');

const COMMAND_FLAGS = {
  record: ['root', 'stage', 'status', 'runtime', 'duration-ms', 'failure-code', 'source'],
  report: ['root', 'output'],
  status: ['root'],
  'opt-out': ['root'],
  'opt-in': ['root'],
};

function usage() {
  return [
    'Citadel activation telemetry (local only; never transmitted)',
    '',
    '  record  --stage <stage> --status <status> [--runtime codex] [--duration-ms 10]',
    '          [--failure-code <code>] [--source <category>] [--root <project>]',
    '  report  [--output <redacted.json>] [--root <project>]',
    '  status  [--root <project>]',
    '  opt-out [--root <project>]',
    '  opt-in  [--root <project>]',
    '',
    `Stages: ${activation.STAGES.join(', ')}`,
    `Statuses: ${activation.STATUSES.join(', ')}`,
    `Failure codes: ${activation.FAILURE_CODES.join(', ')}`,
    `Sources: ${activation.ACQUISITION_SOURCES.join(', ')}`,
  ].join('\n');
}

function parse(argv) {
  const command = argv[0];
  if (!COMMAND_FLAGS[command]) throw new Error(`unknown command: ${command || '(missing)'}`);
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag.startsWith('--')) throw new Error(`expected flag, got: ${flag}`);
    const key = flag.slice(2);
    if (!COMMAND_FLAGS[command].includes(key)) throw new Error(`unknown flag for ${command}: --${key}`);
    if (values[key] !== undefined) throw new Error(`duplicate flag: --${key}`);
    if (argv[index + 1] === undefined || argv[index + 1].startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = argv[index + 1];
  }
  return { command, values };
}

function numberOrUndefined(value, flag) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
  return Number(value);
}

function plan(command, root, detail = {}) {
  return { action: command, root: path.resolve(root), local_only: true, network: 'disabled', ...detail };
}

function run(argv = process.argv.slice(2)) {
  const { command, values } = parse(argv);
  const root = path.resolve(values.root || process.cwd());

  if (command === 'record') {
    if (!values.stage || !values.status) throw new Error('record requires --stage and --status');
    const result = activation.record({
      stage: values.stage,
      status: values.status,
      runtime: values.runtime || 'unknown',
      duration_ms: numberOrUndefined(values['duration-ms'], '--duration-ms'),
      failure_code: values['failure-code'],
      acquisition_source: values.source || 'unknown',
    }, { root });
    return plan(command, root, {
      outcome: result.recorded ? 'recorded' : 'skipped',
      reason: result.reason || null,
      event: result.recorded ? {
        schema: result.event.schema, stage: result.event.stage, status: result.event.status,
        acquisition_source: result.event.acquisition_source,
      } : null,
    });
  }

  if (command === 'report') {
    const result = activation.report(root);
    let output = null;
    if (values.output) {
      output = path.resolve(values.output);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
    return plan(command, root, { outcome: output ? 'redacted_report_written' : 'redacted_report_printed', output, report: result });
  }

  if (command === 'status') {
    const files = activation.pathsFor(root);
    return plan(command, root, {
      outcome: activation.isEnabled(root) ? 'enabled' : 'disabled',
      env_opt_out: process.env.CITADEL_ACTIVATION_TELEMETRY === '0',
      marker_opt_out: fs.existsSync(files.optOut),
      event_store_exists: fs.existsSync(files.events),
    });
  }

  const disabled = command === 'opt-out';
  activation.setOptOut(root, disabled);
  return plan(command, root, { outcome: activation.isEnabled(root) ? 'enabled' : 'disabled' });
}

function main() {
  try {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      process.stdout.write(usage() + '\n');
      return;
    }
    process.stdout.write(JSON.stringify(run(), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`activation-telemetry: ${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parse, run, usage };

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cohort = require('../core/telemetry/activation-cohort');

function usage() {
  return [
    'Citadel activation cohort maintainer tools',
    '',
    '  ingest --bundle <activation-share.json> --evidence-url <discussion-comment-url> [--root <repo>]',
    '  report [--input <activation-cohort.jsonl>] [--output <report.json>] [--root <repo>]',
    '',
    'Ingest and report operate only on explicit, redacted, opt-in submissions.',
  ].join('\n');
}

function parse(argv) {
  const command = argv[0];
  if (!['ingest', 'report'].includes(command)) throw new Error(`unknown command: ${command || '(missing)'}`);
  const allowed = command === 'ingest' ? ['bundle', 'evidence-url', 'root'] : ['input', 'output', 'root'];
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag || !flag.startsWith('--')) throw new Error(`expected flag, got: ${flag || '(missing)'}`);
    const key = flag.slice(2);
    if (!allowed.includes(key)) throw new Error(`unknown flag for ${command}: --${key}`);
    if (argv[index + 1] === undefined || argv[index + 1].startsWith('--')) throw new Error(`missing value for --${key}`);
    values[key] = argv[index + 1];
  }
  return { command, values };
}

function writeReport(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function run(argv = process.argv.slice(2), options = {}) {
  const { command, values } = parse(argv);
  const root = path.resolve(values.root || process.cwd());
  const files = cohort.sharePaths(root);
  const input = path.resolve(values.input || files.cohort);
  const output = path.resolve(values.output || files.report);

  if (command === 'ingest') {
    if (!values.bundle || !values['evidence-url']) throw new Error('ingest requires --bundle and --evidence-url');
    const bundle = cohort.validateSubmission(JSON.parse(fs.readFileSync(path.resolve(values.bundle), 'utf8')));
    const result = cohort.upsertEvidence(files.cohort, bundle, values['evidence-url'], options.now || new Date());
    writeReport(files.report, result.report);
    return {
      action: command,
      outcome: 'submission_ingested',
      cohort_file: files.cohort,
      report_file: files.report,
      evidence_url: result.envelope.evidence_url,
      records: result.records,
      report: result.report,
    };
  }

  const envelopes = fs.existsSync(input) ? cohort.parseJsonl(fs.readFileSync(input, 'utf8')) : [];
  const report = cohort.cohortReport(envelopes);
  writeReport(output, report);
  return { action: command, outcome: 'cohort_report_written', input, output, report };
}

function main() {
  try {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      process.stdout.write(usage() + '\n');
      return;
    }
    process.stdout.write(JSON.stringify(run(), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`activation-cohort: ${error.message}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parse, run, usage };

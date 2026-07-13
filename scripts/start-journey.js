#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { completePackJourney, createPackJourney } = require('../core/packs/journey');

function parseArgs(argv) {
  const command = argv[0];
  if (!['start', 'complete'].includes(command)) throw new Error('command must be start or complete');
  const options = { command, projectRoot: process.cwd(), sourceProjectRoot: path.resolve(__dirname, '..') };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[++index];
    if (!value || !['--pack', '--project', '--runtime', '--run-id', '--evidence', '--created-at', '--completed-at'].includes(flag)) {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
    const key = flag.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    options[key] = value;
  }
  if (!options.runId) throw new Error('--run-id is required');
  if (command === 'start' && (!options.pack || !options.runtime)) throw new Error('start requires --pack and --runtime');
  if (command === 'complete' && !options.evidence) throw new Error('complete requires --evidence');
  return options;
}

function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === 'start') {
    return createPackJourney({ ...options, packRoot: path.resolve(options.sourceProjectRoot, 'packs', options.pack), write: true });
  }
  return completePackJourney({ ...options,
    evidence: JSON.parse(fs.readFileSync(path.resolve(options.evidence), 'utf8')) });
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify({ run_id: result.run.run_id, status: result.run.status,
      receipt_id: result.receipt?.receipt_id || null }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`journey: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ parseArgs, run });

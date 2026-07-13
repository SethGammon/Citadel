#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { ledgerFromBundle, renderMarkdown } = require('../core/proof');

function parseArgs(argv) {
  if (argv[0] !== 'build') throw new Error('command must be build');
  const options = { strict: false };
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--strict') options.strict = true;
    else if (['--bundle', '--trust-roots', '--json-out', '--markdown-out'].includes(flag)) {
      const value = argv[++index];
      if (!value) throw new Error(`${flag} requires a value`);
      options[flag.slice(2)] = path.resolve(value);
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!options.bundle) throw new Error('build requires --bundle');
  return options;
}

function writeOutput(file, content) {
  if (!file) return;
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`output must not be a symlink: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, file);
}

function build(options) {
  const ledger = ledgerFromBundle(options.bundle, { strict: options.strict, trustRootFile: options['trust-roots'] });
  const json = `${JSON.stringify(ledger, null, 2)}\n`;
  const markdown = renderMarkdown(ledger);
  writeOutput(options['json-out'], json);
  writeOutput(options['markdown-out'], markdown);
  return { ledger, json, markdown };
}

function main(argv = process.argv.slice(2)) {
  const result = build(parseArgs(argv));
  if (!result.ledger || (!argv.includes('--json-out') && !argv.includes('--markdown-out'))) {
    process.stdout.write(result.json);
  } else {
    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      records: result.ledger.denominators.all_records,
      verified_receipts: result.ledger.denominators.verified_receipts,
    })}\n`);
  }
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`Proof bundle build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ build, main, parseArgs, writeOutput });

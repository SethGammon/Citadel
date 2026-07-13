#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { verifyExecutionReceipt } = require('../core/operations');

function parseArgs(argv) {
  if (argv[0] !== 'verify') throw new Error('command must be verify');
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--input', '--public-key'].includes(flag) || !value) throw new Error('verify accepts --input and optional --public-key');
    values[flag.slice(2)] = value;
  }
  if (!values.input) throw new Error('verify requires --input');
  return values;
}

function verifyFile(options) {
  const envelope = JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8'));
  const publicKey = options['public-key'] ? fs.readFileSync(path.resolve(options['public-key']), 'utf8') : null;
  return verifyExecutionReceipt(envelope, { publicKey });
}

function runCli(argv = process.argv.slice(2)) {
  return verifyFile(parseArgs(argv));
}

function main() {
  try {
    const verification = runCli();
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    if (verification.status !== 'verified') {
      process.exitCode = verification.status === 'invalid' ? 1 : verification.status === 'unsigned' ? 2 : 3;
    }
  } catch (_error) {
    process.stdout.write(`${JSON.stringify({ status: 'invalid', receipt_status: 'unknown', reason_code: 'VERIFY_INPUT_INVALID', key_id: null })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = Object.freeze({ parseArgs, runCli, verifyFile });

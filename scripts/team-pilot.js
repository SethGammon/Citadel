#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { pilotReport, simulatedPilot } = require('../core/team');

function run(argv = process.argv.slice(2)) {
  if (argv[0] === 'simulate' && argv.length === 1) return simulatedPilot();
  if (argv[0] === 'report' && argv[1] === '--input' && argv[2] && argv.length === 3) {
    return { report: pilotReport(JSON.parse(fs.readFileSync(path.resolve(argv[2]), 'utf8')),
      { evidenceClass: 'independent-pilot' }) };
  }
  throw new Error('Usage: team-pilot.js simulate | report --input events.json');
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = Object.freeze({ run });

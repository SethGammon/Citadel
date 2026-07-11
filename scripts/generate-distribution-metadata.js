#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { buildMetadata, stableJson, validateMetadata } = require('../core/distribution/metadata');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'citadel-metadata.json');
const check = process.argv.includes('--check');
const stdout = process.argv.includes('--stdout');
const metadata = buildMetadata(root);
const errors = validateMetadata(root, metadata);

if (errors.length > 0) {
  process.stderr.write(`distribution metadata invalid:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}

const rendered = stableJson(metadata);
if (check) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== rendered) {
    process.stderr.write('citadel-metadata.json is stale; run node scripts/generate-distribution-metadata.js\n');
    process.exit(1);
  }
  process.stdout.write('distribution metadata is canonical and in sync\n');
} else if (stdout) {
  process.stdout.write(rendered);
} else {
  fs.writeFileSync(target, rendered, 'utf8');
  process.stdout.write('wrote citadel-metadata.json\n');
}

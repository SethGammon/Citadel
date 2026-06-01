#!/usr/bin/env node

'use strict';

const {
  readAppArtifacts,
  recordAppArtifact,
  verifyAppArtifacts,
} = require('../core/codex/native-integrations');

function arg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const mode = process.argv[2] || 'list';
const projectRoot = arg('--project-root', process.cwd());

if (mode === 'record') {
  console.log(JSON.stringify(recordAppArtifact({
    projectRoot,
    kind: arg('--kind', 'artifact'),
    path: arg('--path'),
    workflow: arg('--workflow', 'qa'),
    route: arg('--route', null),
    status: arg('--status', 'recorded'),
    note: arg('--note', ''),
  }), null, 2));
} else if (mode === 'list') {
  console.log(JSON.stringify(readAppArtifacts(projectRoot), null, 2));
} else if (mode === 'verify') {
  const report = verifyAppArtifacts({
    projectRoot,
    requireExistingPaths: !process.argv.includes('--allow-missing'),
    requireArtifacts: process.argv.includes('--require-artifacts'),
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
} else {
  console.error('Usage: node scripts/codex-app-artifacts.js <record|list|verify> --path .planning/screenshots/example.png');
  process.exit(1);
}

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'scripts', 'hosted-site-smoke.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'hosted-pages-smoke.yml'), 'utf8');
const testsWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'tests.yml'), 'utf8');
const { normalizeForManifest } = require('./site-release-manifest');
for (const page of ['/', '/evidence.html', '/operation-control.html', '/optimizer.html', '/research.html', '/walkthrough.html']) assert(script.includes(`path: '${page}'`), `hosted smoke is missing ${page}`);
for (const gate of ['scrollY', 'active', 'scrollWidth', 'canonical', 'ogImage', 'consoleErrors', 'aria-expanded', 'LOCAL_RELEASE.source_digest', 'site-release-manifest.json']) assert(script.includes(gate), `hosted smoke is missing ${gate}`);
assert(workflow.includes('workflow_run:'));
assert(workflow.includes('schedule:'));
assert(workflow.includes('playwright@1.55.1'));
assert(workflow.includes('node scripts/hosted-site-smoke.js'));
assert(workflow.includes('ref: refs/heads/main'));
assert(workflow.includes('persist-credentials: false'));
assert(!workflow.includes('workflow_run.head_sha'));
assert(testsWorkflow.includes('fetch-depth: 0'), 'historical freeze verification requires full checkout history');
assert.deepStrictEqual(
  normalizeForManifest('index.html', Buffer.from('first\r\nsecond\r\n')),
  normalizeForManifest('index.html', Buffer.from('first\nsecond\n')),
  'site release text hashing must be line-ending invariant',
);
const binary = Buffer.from([0, 13, 10, 255]);
assert.deepStrictEqual(normalizeForManifest('capture.png', binary), binary, 'binary release assets must remain byte-exact');
process.stdout.write('hosted site smoke contract passed\n');

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDeliveryFromIntake, listPendingIntakes, readIntakeFile, resolveNextIntake, slugify } = require('../core/intake/deliver');
const { generateMapIndex, writeMapIndex, defaultOutputPath } = require('../core/map');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-deliver-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

assert.equal(slugify('Add Auth Flow!'), 'add-auth-flow');

withTempProject((projectRoot) => {
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }, null, 2));
  write(path.join(projectRoot, 'src', 'auth.js'), 'export function login() { return true; }\n');
  writeMapIndex(generateMapIndex(projectRoot), defaultOutputPath(projectRoot));

  const intakePath = path.join(projectRoot, '.planning', 'intake', 'auth.md');
  write(intakePath, [
    '---',
    'title: "Add Auth Flow"',
    'status: pending',
    'priority: high',
    'target: src/auth.js',
    '---',
    '',
    '## Description',
    '',
    'Add an authentication flow with a clear verification path.',
    '',
    '## Acceptance Criteria',
    '',
    '- Login is implemented.',
    '- Tests pass.',
  ].join('\n'));

  const intake = readIntakeFile(intakePath);
  assert.equal(intake.title, 'Add Auth Flow');
  assert.equal(intake.status, 'pending');

  const result = createDeliveryFromIntake(projectRoot, intakePath, {
    verification: 'npm run test',
  });
  assert.equal(result.slug, 'add-auth-flow');
  assert(fs.existsSync(result.campaignPath), 'campaign should be created');

  const campaign = fs.readFileSync(result.campaignPath, 'utf8');
  assert(campaign.includes('# Campaign: Add Auth Flow'));
  assert(campaign.includes('| phase:2 | implementation-diff | file_diff | yes | git diff --stat | pending | 2 | implement requested change |'));
  assert(campaign.includes('| phase:4 | review-package | review_package | yes | .planning/review-packages/add-auth-flow.md | pending | 2 | package delivery for review |'));
  assert(campaign.includes('=== MAP SLICE: src/auth.js Add Auth Flow ==='));
  assert(campaign.includes('Phase: 2'));

  const updatedIntake = fs.readFileSync(intakePath, 'utf8');
  assert(updatedIntake.includes('status: in-progress'));
  assert(updatedIntake.includes('campaign: add-auth-flow'));

  assert.throws(
    () => createDeliveryFromIntake(projectRoot, intakePath),
    /Campaign already exists/,
    'duplicate delivery should fail without --force'
  );

  const secondIntake = path.join(projectRoot, '.planning', 'intake', 'docs.md');
  write(secondIntake, [
    '---',
    'title: "Document CLI"',
    'status: pending',
    'target: docs/',
    '---',
    '',
    '## Description',
    'Document the delivery command.',
  ].join('\n'));

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'deliver.js'),
    '--project-root',
    projectRoot,
    '--intake',
    secondIntake,
  ], { encoding: 'utf8' });
  assert(output.includes('Delivery campaign created.'));
  assert(output.includes('document-cli'));
});

withTempProject((projectRoot) => {
  const lowIntake = path.join(projectRoot, '.planning', 'intake', 'low.md');
  write(lowIntake, [
    '---',
    'title: "Low Priority Docs"',
    'status: pending',
    'priority: low',
    'target: docs/',
    '---',
    '',
    '## Description',
    'Document later.',
  ].join('\n'));

  const highIntake = path.join(projectRoot, '.planning', 'intake', 'high.md');
  write(highIntake, [
    '---',
    'title: "High Priority API"',
    'status: pending',
    'priority: high',
    'target: src/api.js',
    '---',
    '',
    '## Description',
    'Implement now.',
  ].join('\n'));

  const pending = listPendingIntakes(projectRoot);
  assert.equal(pending.length, 2);
  assert.equal(path.basename(pending[0].filePath), 'high.md');
  assert.equal(resolveNextIntake(projectRoot), highIntake);

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'deliver.js'),
    '--project-root',
    projectRoot,
    '--next',
  ], { encoding: 'utf8' });
  assert(output.includes('Delivery campaign created.'));
  assert(output.includes('high-priority-api'));

  const updatedHigh = fs.readFileSync(highIntake, 'utf8');
  assert(updatedHigh.includes('status: in-progress'));
  assert(fs.readFileSync(lowIntake, 'utf8').includes('status: pending'));
});

withTempProject((projectRoot) => {
  const intakePath = path.join(projectRoot, '.planning', 'intake', 'alias.md');
  write(intakePath, [
    '---',
    'title: "Alias Intake"',
    'status: pending',
    'priority: normal',
    '---',
    '',
    '## Description',
    'Prove the intake alias selects the next pending item.',
  ].join('\n'));

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'deliver.js'),
    '--project-root',
    projectRoot,
    'intake',
  ], { encoding: 'utf8' });
  assert(output.includes('alias-intake'));
});

withTempProject((projectRoot) => {
  assert.throws(
    () => resolveNextIntake(projectRoot),
    /No pending intake items/,
    'next intake resolution should fail clearly when queue is empty'
  );
});

console.log('delivery preflight tests passed');

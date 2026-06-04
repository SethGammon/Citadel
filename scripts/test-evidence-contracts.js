#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  appendRepairTasks,
  parseExitEvidence,
  validateExitEvidence,
} = require('../core/evidence/contracts');

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-evidence-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const markdown = [
  '# Campaign',
  '',
  '## Exit Evidence',
  '',
  '| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |',
  '|---|---|---|---|---|---|---|---|',
  '| phase:1 | tests | test_result | yes | npm run test | pass | 2 | none |',
  '| phase:1 | screenshot | screenshot | yes | .planning/screenshots/missing.png | pass | 1 | capture screenshot |',
  '| phase:2 | docs | doc_update | yes | docs/result.md | pass | 1 | update docs |',
  '| task:7 | pr | pr_link | yes | https://github.com/acme/repo/pull/12 | resolved | 0 | none |',
].join('\n');

withTempProject((projectRoot) => {
  fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'docs', 'result.md'), 'done\n', 'utf8');
  const filePath = path.join(projectRoot, 'campaign.md');
  fs.writeFileSync(filePath, markdown, 'utf8');

  const items = parseExitEvidence(markdown);
  assert.equal(items.length, 4);
  assert.equal(items[0].type, 'test_result');

  const phase1 = validateExitEvidence(markdown, { projectRoot, target: 'phase:1' });
  assert.equal(phase1.pass, false);
  assert.equal(phase1.failures.length, 1);
  assert.equal(phase1.failures[0].action, 'repair-task');

  const phase2 = validateExitEvidence(markdown, { projectRoot, target: 'phase:2' });
  assert.equal(phase2.pass, true);

  const repaired = appendRepairTasks(markdown, phase1.failures);
  assert(repaired.includes('## Repair Tasks'));
  assert(repaired.includes('Repairs phase:1/screenshot'));

  let failed = false;
  try {
    execFileSync(process.execPath, [
      path.join(__dirname, 'evidence-validate.js'),
      '--project-root',
      projectRoot,
      '--file',
      filePath,
      '--target',
      'phase:1',
      '--json',
    ], { encoding: 'utf8' });
  } catch (error) {
    failed = true;
    const report = JSON.parse(error.stdout);
    assert.equal(report.pass, false);
    assert.equal(report.failures.length, 1);
  }
  assert.equal(failed, true, 'CLI should fail when required evidence is missing');

  try {
    execFileSync(process.execPath, [
      path.join(__dirname, 'evidence-validate.js'),
      '--project-root',
      projectRoot,
      '--file',
      filePath,
      '--target',
      'phase:1',
      '--write-repair',
    ], { encoding: 'utf8' });
  } catch (error) {
    assert.equal(error.status, 1, '--write-repair should still fail so callers do not advance');
  }
  assert(fs.readFileSync(filePath, 'utf8').includes('Repairs phase:1/screenshot'));
});

console.log('evidence contract tests passed');

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operator-journey-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function completeBuildAndVerify(campaignPath) {
  let campaign = fs.readFileSync(campaignPath, 'utf8');
  campaign = campaign
    .replace('| 2 | pending | build | Implement requested change | Required files are changed and implementation diff is available |', '| 2 | complete | build | Implement requested change | Required files are changed and implementation diff is available |')
    .replace('| 3 | pending | verify | Run verification | npm run test passes |', '| 3 | complete | verify | Run verification | npm run test passes |')
    .replace('| phase:2 | implementation-diff | file_diff | yes | git diff --stat | pending | 2 | implement requested change |', '| phase:2 | implementation-diff | file_diff | yes | git diff --stat | resolved | 2 | implement requested change |')
    .replace('| phase:3 | verification-command | test_result | yes | npm run test | pending | 2 | fix verification failures |', '| phase:3 | verification-command | test_result | yes | npm run test | pass | 2 | fix verification failures |');
  fs.writeFileSync(campaignPath, campaign, 'utf8');
}

withTempProject((projectRoot) => {
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }, null, 2));
  write(path.join(projectRoot, 'test.js'), 'process.exit(0);\n');
  write(path.join(projectRoot, 'src', 'feature.js'), 'module.exports = true;\n');

  const intakePath = path.join(projectRoot, '.planning', 'intake', 'ship-feature.md');
  write(intakePath, [
    '---',
    'title: "Ship Feature"',
    'status: pending',
    'priority: high',
    'target: src/feature.js',
    '---',
    '',
    '## Description',
    '',
    'Ship a feature through the Citadel delivery loop.',
    '',
    '## Acceptance Criteria',
    '',
    '- Feature file exists.',
    '- Tests pass.',
  ].join('\n'));

  const deliverOutput = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'deliver.js'),
    '--project-root',
    projectRoot,
    '--next',
  ], { encoding: 'utf8' });
  assert(deliverOutput.includes('Delivery campaign created.'));
  assert(deliverOutput.includes('ship-feature'));

  const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'ship-feature.md');
  assert(fs.existsSync(campaignPath), 'delivery campaign should exist');
  assert(fs.readFileSync(intakePath, 'utf8').includes('status: in-progress'));

  completeBuildAndVerify(campaignPath);

  const operatorOutput = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'next-action.js'),
    '--project-root',
    projectRoot,
    '--run',
    '--max-steps',
    '3',
  ], { encoding: 'utf8' });

  assert(operatorOutput.includes('1. Package ship-feature for review'));
  assert(operatorOutput.includes('2. Complete ship-feature'));
  assert(operatorOutput.includes('Outcome: idle'));
  assert(!fs.existsSync(campaignPath), 'active campaign should be archived');
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'campaigns', 'completed', 'ship-feature.md')));
  assert(fs.existsSync(path.join(projectRoot, '.planning', 'review-packages', 'ship-feature.md')));

  const completed = fs.readFileSync(path.join(projectRoot, '.planning', 'campaigns', 'completed', 'ship-feature.md'), 'utf8');
  assert(completed.includes('status: completed'));
  assert(completed.includes('## Completion Record'));
  assert(completed.includes('| phase:4 | review-package | review_package | yes | .planning/review-packages/ship-feature.md | resolved | 2 | review local handoff package |'));
});

console.log('operator journey tests passed');

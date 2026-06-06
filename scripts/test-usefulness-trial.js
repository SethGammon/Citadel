#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildTrial, parseArgs, renderTrial, writeTrial } = require('./usefulness-trial');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-usefulness-trial-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function scaffoldRepo(projectRoot, testExit = 0) {
  write(path.join(projectRoot, 'README.md'), '# Fixture\n');
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: {
      test: `node -e "process.exit(${testExit})"`,
    },
  }, null, 2));
}

assert.equal(parseArgs(['--json', '--write', '--task', 'review docs']).task, 'review docs');

withTempProject((projectRoot) => {
  scaffoldRepo(projectRoot);

  const trial = buildTrial(projectRoot, {
    task: 'review README.md for first-time developer friction',
    runVerification: true,
    now: '2026-06-05T12:00:00.000Z',
  });

  assert.equal(trial.decision, 'setup-needed');
  assert.equal(trial.score.label, '4/5');
  assert.equal(trial.criteria.find((item) => item.id === 'setup-path').status, 'pass');
  assert.equal(trial.criteria.find((item) => item.id === 'durable-evidence').status, 'partial');
  assert(trial.nextAction.includes('/do setup --express'));

  const reportPath = writeTrial(projectRoot, trial);
  assert.equal(reportPath, '.planning/usefulness-trial/latest.md');
  assert(fs.existsSync(path.join(projectRoot, reportPath)));
  assert(fs.readFileSync(path.join(projectRoot, reportPath), 'utf8').includes('Citadel Usefulness Trial'));
});

withTempProject((projectRoot) => {
  scaffoldRepo(projectRoot);
  fs.mkdirSync(path.join(projectRoot, '.planning', 'campaigns'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.planning', 'telemetry'), { recursive: true });
  write(path.join(projectRoot, '.planning', 'operator-console', 'latest.md'), 'operator evidence\n');

  const trial = buildTrial(projectRoot, {
    task: 'review README.md for first-time developer friction',
    runVerification: true,
  });

  assert.equal(trial.decision, 'ready-for-dogfood');
  assert.equal(trial.score.label, '5/5');
  assert(renderTrial(trial).includes('Use this project for the post-landing first-use audit'));
});

withTempProject((projectRoot) => {
  scaffoldRepo(projectRoot, 1);
  fs.mkdirSync(path.join(projectRoot, '.planning', 'campaigns'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.planning', 'telemetry'), { recursive: true });
  write(path.join(projectRoot, '.planning', 'operator-console', 'latest.md'), 'operator evidence\n');

  const trial = buildTrial(projectRoot, {
    runVerification: true,
  });

  assert.equal(trial.decision, 'blocked');
  assert.equal(trial.criteria.find((item) => item.id === 'verification').status, 'fail');
});

withTempProject((projectRoot) => {
  scaffoldRepo(projectRoot);

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'usefulness-trial.js'),
    '--project-root',
    projectRoot,
    '--write',
    '--json',
  ], { encoding: 'utf8' });
  const payload = JSON.parse(output);
  assert.equal(payload.reportPath, '.planning/usefulness-trial/latest.md');
  assert(fs.existsSync(path.join(projectRoot, payload.reportPath)));
});

console.log('usefulness trial tests passed');

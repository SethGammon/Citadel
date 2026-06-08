#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildProof, parseArgs, renderProof, writeProof } = require('./operating-proof');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-operating-proof-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

assert.equal(parseArgs(['--json', '--write', '--route-request', 'review docs']).routeRequest, 'review docs');

withTempProject((projectRoot) => {
  write(path.join(projectRoot, 'README.md'), '# Fixture\n');
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node -e "process.exit(0)"',
    },
  }, null, 2));

  const proof = buildProof(projectRoot, {
    routeRequest: 'review README.md for first-time developer friction',
    runVerification: true,
    now: '2026-06-05T12:00:00.000Z',
  });

  assert.equal(proof.status, 'partial');
  assert.equal(proof.summary.setup, 'partial');
  assert.equal(proof.summary.route, 'pass');
  assert.equal(proof.summary.verify, 'pass');
  assert(proof.checks.find((check) => check.id === 'setup').detail.includes('/do setup --express'));

  const reportPath = writeProof(projectRoot, proof);
  assert.equal(reportPath, '.planning/operating-proof/latest.md');
  assert(fs.existsSync(path.join(projectRoot, reportPath)));
  assert(fs.readFileSync(path.join(projectRoot, reportPath), 'utf8').includes('Citadel Operating Proof'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, 'README.md'), '# Fixture\n');
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node -e "process.exit(0)"',
    },
  }, null, 2));
  fs.mkdirSync(path.join(projectRoot, '.planning', 'verification'), { recursive: true });

  const proof = buildProof(projectRoot, {
    routeRequest: 'review README.md for first-time developer friction',
    runVerification: true,
  });

  assert.equal(proof.status, 'partial');
  assert.equal(proof.summary.setup, 'partial');
  assert(proof.checks.find((check) => check.id === 'setup').evidence.includes('.planning'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, 'README.md'), '# Fixture\n');
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node -e "process.exit(0)"',
    },
  }, null, 2));
  fs.mkdirSync(path.join(projectRoot, '.planning', 'campaigns'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.planning', 'telemetry'), { recursive: true });
  write(path.join(projectRoot, '.planning', 'operator-console', 'latest.md'), 'operator evidence\n');

  const proof = buildProof(projectRoot, {
    routeRequest: 'review README.md for first-time developer friction',
    runVerification: true,
  });

  assert.equal(proof.status, 'ready');
  assert.equal(proof.summary.setup, 'pass');
  assert.equal(proof.summary.report, 'pass');
  assert(renderProof(proof).includes('The project has an inspectable operating loop'));
});

withTempProject((projectRoot) => {
  write(path.join(projectRoot, 'README.md'), '# Fixture\n');
  write(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node -e "process.exit(0)"',
    },
  }, null, 2));

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'operating-proof.js'),
    '--project-root',
    projectRoot,
    '--write',
    '--json',
  ], { encoding: 'utf8' });
  const payload = JSON.parse(output);
  assert.equal(payload.reportPath, '.planning/operating-proof/latest.md');
  assert(fs.existsSync(path.join(projectRoot, payload.reportPath)));
});

console.log('operating proof tests passed');

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { changedFilesFromGit, profileForFiles, readPackageScripts, selectVerificationProfile } = require('../core/verification/profiles');
const { render } = require('./verification-plan');

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-verification-plan-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

assert.equal(profileForFiles(['hooks_src/protect-files.js'], { test: 'node test.js' }).id, 'hook-runtime');
assert(profileForFiles(['hooks_src/protect-files.js'], { test: 'node test.js' }).commands.includes('node scripts/verify-hooks.js'));
assert.equal(profileForFiles(['skills/do/SKILL.md'], { test: 'node test.js' }).id, 'skill-surface');
assert.equal(profileForFiles(['docs/index.html'], { test: 'node test.js' }).id, 'demo-experience');
assert.equal(profileForFiles(['scripts/dashboard.js'], { test: 'node test.js' }).id, 'operator-loop');
assert.equal(profileForFiles(['scripts/operator-console.js'], { test: 'node test.js' }).id, 'operator-loop');
assert(profileForFiles(['scripts/operator-console.js'], { test: 'node test.js' }).commands.includes('node scripts/test-operator-console.js'));
assert.equal(profileForFiles(['skills/do/SKILL.md', 'scripts/operator-console.js'], { test: 'node test.js' }).id, 'skill-surface');
assert(profileForFiles(['skills/do/SKILL.md', 'scripts/operator-console.js'], { test: 'node test.js' }).commands.includes('node scripts/test-operator-journey.js'));
assert.equal(profileForFiles(['scripts/pr-ready.js'], { test: 'node test.js' }).id, 'review-readiness');
assert(profileForFiles(['core/verification/profiles.js'], { test: 'node test.js' }).commands.includes('node scripts/test-verification-plan.js'));
assert.equal(profileForFiles(['core/campaigns/update-campaign.js'], { test: 'node test.js' }).id, 'campaign-delivery');
assert.equal(profileForFiles(['docs/CAMPAIGNS.md'], { test: 'node test.js' }).id, 'documentation');

withTempProject((projectRoot) => {
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.js' },
  }), 'utf8');

  const plan = selectVerificationProfile(projectRoot, {
    changedFiles: ['scripts/next-action.js'],
  });
  assert.equal(plan.id, 'operator-loop');
  assert.equal(plan.primaryCommand, 'npm run test');
  assert(plan.commands.includes('node scripts/test-next-action.js'));

  const output = render(plan);
  assert(output.includes('Citadel Verification Plan'));
  assert(output.includes('Profile: operator-loop'));
  assert(output.includes('---HANDOFF---'));
});

withTempProject((projectRoot) => {
  fs.writeFileSync(path.join(projectRoot, 'package.json'), `\uFEFF${JSON.stringify({
    scripts: { test: 'node test.js' },
  })}`, 'utf8');

  assert.equal(readPackageScripts(projectRoot).test, 'node test.js');
});

withTempProject((projectRoot) => {
  childProcess.execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  fs.mkdirSync(path.join(projectRoot, 'core', 'verification'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'core', 'verification', 'profiles.js'), 'module.exports = {};\n', 'utf8');

  const changed = changedFilesFromGit(projectRoot);
  assert(changed.includes('core/verification/profiles.js'));
});

console.log('verification plan tests passed');

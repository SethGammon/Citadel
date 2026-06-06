#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  packageDelivery,
  renderReviewPackage,
  updateReviewEvidence,
} = require('../core/campaigns/package-delivery');
const { validateExitEvidence } = require('../core/evidence/contracts');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-package-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function campaignMarkdown() {
  return [
    '---',
    'version: 1',
    'status: active',
    '---',
    '',
    '# Campaign: Add Review Package',
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | complete | brief | Intake preflight | done |',
    '| 2 | complete | build | Implement requested change | done |',
    '| 3 | complete | verify | Run verification | done |',
    '| 4 | pending | package | Package for review | PR link or local handoff is recorded |',
    '',
    '## Exit Evidence',
    '',
    '| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |',
    '|---|---|---|---|---|---|---|---|',
    '| phase:2 | implementation-diff | file_diff | yes | src/result.js | resolved | 2 | implement requested change |',
    '| phase:3 | verification-command | test_result | yes | npm run test | pass | 2 | fix verification failures |',
    '| phase:4 | review-package | pr_link | yes | PR URL or local handoff path | pending | 2 | package delivery for review |',
  ].join('\n');
}

withTempProject((projectRoot) => {
  const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'add-review-package.md');
  const sourcePath = path.join(projectRoot, 'src', 'result.js');
  write(campaignPath, campaignMarkdown());
  write(sourcePath, 'module.exports = true;\n');

  const result = packageDelivery(projectRoot, 'add-review-package', {
    now: '2026-06-05T00:00:00.000Z',
    note: 'Ready for local review.',
  });

  assert.equal(result.reviewType, 'review_package');
  assert.equal(result.reviewEvidence, '.planning/review-packages/add-review-package.md');
  assert.equal(result.readiness, 'ready');
  assert(fs.existsSync(result.packagePath), 'review package should exist');

  const campaign = fs.readFileSync(campaignPath, 'utf8');
  assert(/\|\s*4\s*\|\s*complete\s*\|\s*package\s*\|\s*Package for review\s*\|/.test(campaign));
  assert(campaign.includes('| phase:4 | review-package | review_package | yes | .planning/review-packages/add-review-package.md | resolved | 2 | review local handoff package |'));
  assert.equal(validateExitEvidence(campaign, { projectRoot }).pass, true);

  const reviewPackage = fs.readFileSync(result.packagePath, 'utf8');
  assert(reviewPackage.includes('# Delivery Review Package: Add Review Package'));
  assert(reviewPackage.includes('Readiness: ready'));
  assert(reviewPackage.includes('---HANDOFF---'));
  assert(reviewPackage.includes('- Review target: .planning/review-packages/add-review-package.md'));
});

withTempProject((projectRoot) => {
  const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'pr-package.md');
  write(campaignPath, campaignMarkdown().replace('Add Review Package', 'PR Package'));
  write(path.join(projectRoot, 'src', 'result.js'), 'module.exports = true;\n');

  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'package-delivery.js'),
    '--project-root',
    projectRoot,
    'pr-package',
    '--pr',
    'https://github.com/acme/repo/pull/42',
  ], { encoding: 'utf8' });

  assert(output.includes('Delivery review package created.'));
  assert(output.includes('pr_link https://github.com/acme/repo/pull/42'));
  const campaign = fs.readFileSync(campaignPath, 'utf8');
  assert(campaign.includes('| phase:4 | review-package | pr_link | yes | https://github.com/acme/repo/pull/42 | resolved | 2 | review pull request |'));
});

assert.throws(
  () => updateReviewEvidence('# No evidence', {
    type: 'review_package',
    evidence: '.planning/review-packages/nope.md',
    nextAction: 'review local package',
  }),
  /review-package Exit Evidence/,
  'campaigns without review evidence should fail clearly'
);

const packageMarkdown = renderReviewPackage(process.cwd(), {
  slug: 'unit',
  title: 'Unit',
  filePath: path.join(process.cwd(), '.planning', 'campaigns', 'unit.md'),
  content: '# Campaign: Unit\n',
}, {
  now: '2026-06-05T00:00:00.000Z',
  packagePath: path.join(process.cwd(), '.planning', 'review-packages', 'unit.md'),
});
assert(packageMarkdown.includes('Readiness: needs-evidence'));

console.log('delivery package tests passed');

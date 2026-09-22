#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  commitFileTransaction,
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

function campaignMarkdown(options = {}) {
  const title = options.title || 'Add Review Package';
  const phases = options.phases || [
    '| 1 | complete | brief | Intake preflight | done |',
    '| 2 | complete | build | Implement requested change | done |',
    '| 3 | complete | verify | Run verification | done |',
    '| 4 | pending | package | Package for review | PR link or local handoff is recorded |',
  ];
  const packagePhase = options.packagePhase || 4;
  return [
    '---',
    'version: 1',
    'status: active',
    '---',
    '',
    `# Campaign: ${title}`,
    '',
    'Status: active',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    ...phases,
    '',
    '## Exit Evidence',
    '',
    '| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |',
    '|---|---|---|---|---|---|---|---|',
    '| phase:2 | implementation-diff | file_diff | yes | src/result.js | resolved | 2 | implement requested change |',
    '| phase:3 | verification-command | test_result | yes | npm run test | pass | 2 | fix verification failures |',
    `| phase:${packagePhase} | review-package | pr_link | yes | PR URL or local handoff path | pending | 2 | package delivery for review |`,
  ].join('\n');
}

function fileOperationsFailing(predicate) {
  return {
    existsSync: fs.existsSync,
    rmSync: fs.rmSync,
    writeFileSync: fs.writeFileSync,
    renameSync(source, destination) {
      if (predicate(source, destination)) throw new Error(`injected rename failure: ${destination}`);
      fs.renameSync(source, destination);
    },
  };
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
  assert(reviewPackage.includes('Outcome: review-package'));
  assert(reviewPackage.includes('Readiness: ready'));
  assert(reviewPackage.includes('---HANDOFF---'));
  assert(reviewPackage.includes('- Review target: .planning/review-packages/add-review-package.md'));
});

withTempProject((projectRoot) => {
  const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'custom-package.md');
  write(campaignPath, campaignMarkdown({
    title: 'Custom Package',
    packagePhase: 3,
    phases: [
      '| 1 | complete | brief | Intake preflight | done |',
      '| 2 | complete | build | Build | done |',
      '| 3 | pending | package | Package for review | local handoff recorded |',
    ],
  }));
  write(path.join(projectRoot, 'src', 'result.js'), 'module.exports = true;\n');

  const result = packageDelivery(projectRoot, 'custom-package');
  const campaign = fs.readFileSync(campaignPath, 'utf8');
  assert(/\|\s*3\s*\|\s*complete\s*\|\s*package\s*\|/.test(campaign));
  assert(fs.readFileSync(result.packagePath, 'utf8').includes('Readiness: ready'));
});

for (const [status, expectedReadiness, expectedResult] of [
  ['passed', 'ready', 'pass'],
  ['blocked/HUMAN_INPUT_REQUIRED', 'needs-evidence', 'fail'],
]) {
  withTempProject((projectRoot) => {
    const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'manual-gate.md');
    const manualRow = `| phase:3 | operator-approval | manual | yes | Operator decision recorded in campaign | ${status} | 0 | request approval |`;
    write(campaignPath, `${campaignMarkdown({ title: 'Manual Gate' })}\n${manualRow}`);
    write(path.join(projectRoot, 'src', 'result.js'), 'module.exports = true;\n');

    const result = packageDelivery(projectRoot, 'manual-gate');
    const reviewPackage = fs.readFileSync(result.packagePath, 'utf8');
    assert.equal(result.readiness, expectedReadiness);
    assert(reviewPackage.includes(`Readiness: ${expectedReadiness}`));
    assert(reviewPackage.includes(`| phase:3 | operator-approval | manual | yes | Operator decision recorded in campaign | ${status.toLowerCase()} | ${expectedResult} |`));
  });
}

withTempProject((projectRoot) => {
  const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'missing-package.md');
  const original = campaignMarkdown({
    title: 'Missing Package',
    phases: ['| 1 | complete | build | Build | done |'],
  });
  write(campaignPath, original);

  assert.throws(() => packageDelivery(projectRoot, 'missing-package'), /no package phase/);
  assert.equal(fs.readFileSync(campaignPath, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(projectRoot, '.planning', 'review-packages')), false);
});

withTempProject((projectRoot) => {
  const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'ambiguous-package.md');
  const original = campaignMarkdown({
    title: 'Ambiguous Package',
    phases: [
      '| 1 | complete | build | Build | done |',
      '| 2 | pending | package | First package | done |',
      '| 3 | pending | package | Second package | done |',
    ],
  });
  write(campaignPath, original);

  assert.throws(() => packageDelivery(projectRoot, 'ambiguous-package'), /multiple package phases/);
  assert.equal(fs.readFileSync(campaignPath, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(projectRoot, '.planning', 'review-packages')), false);
});

for (const failureTarget of ['package', 'campaign']) {
  withTempProject((projectRoot) => {
    const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'rollback-package.md');
    const packagePath = path.join(projectRoot, '.planning', 'review-packages', 'rollback-package.md');
    const originalCampaign = campaignMarkdown({ title: 'Rollback Package' });
    const originalPackage = '# Existing package\nDo not replace on failure.\n';
    write(campaignPath, originalCampaign);
    write(packagePath, originalPackage);
    write(path.join(projectRoot, 'src', 'result.js'), 'module.exports = true;\n');
    const target = failureTarget === 'package' ? packagePath : campaignPath;
    const fileOperations = fileOperationsFailing(
      (source, destination) => source.includes('.staged-') && destination === target,
    );

    assert.throws(
      () => packageDelivery(projectRoot, 'rollback-package', { fileOperations }),
      /injected rename failure/,
    );
    assert.equal(fs.readFileSync(campaignPath, 'utf8'), originalCampaign);
    assert.equal(fs.readFileSync(packagePath, 'utf8'), originalPackage);
  });
}

withTempProject((projectRoot) => {
  const campaignPath = path.join(projectRoot, '.planning', 'campaigns', 'render-failure.md');
  const packagePath = path.join(projectRoot, '.planning', 'review-packages', 'render-failure.md');
  const originalCampaign = campaignMarkdown({ title: 'Render Failure' });
  const originalPackage = '# Existing package\n';
  write(campaignPath, originalCampaign);
  write(packagePath, originalPackage);

  assert.throws(
    () => packageDelivery(projectRoot, 'render-failure', {
      renderPackage() { throw new Error('injected render failure'); },
    }),
    /injected render failure/,
  );
  assert.equal(fs.readFileSync(campaignPath, 'utf8'), originalCampaign);
  assert.equal(fs.readFileSync(packagePath, 'utf8'), originalPackage);
});

withTempProject((projectRoot) => {
  const first = path.join(projectRoot, 'first.md');
  const second = path.join(projectRoot, 'second.md');
  write(first, 'first original\n');
  write(second, 'second original\n');
  const operations = fileOperationsFailing((source, destination) =>
    (source.includes('.staged-') && destination === second) ||
    (source.includes('.backup-') && destination === first));

  let failure;
  try {
    commitFileTransaction([
      { filePath: first, content: 'first new\n' },
      { filePath: second, content: 'second new\n' },
    ], operations);
  } catch (error) {
    failure = error;
  }
  assert(failure, 'transaction should report the injected failure');
  assert.match(failure.message, /Rollback incomplete/);
  assert(failure.recoveryBackups.some((backup) => fs.existsSync(backup)));
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

#!/usr/bin/env node

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseCampaignContent } = require('../core/campaigns/parse-campaign');
const { findActiveCampaign, getCampaignPaths, readCampaignStats } = require('../core/campaigns/load-campaign');
const {
  archiveCampaign,
  completeCampaign,
  updateCampaignStatus,
  updatePhaseStatus,
} = require('../core/campaigns/update-campaign');
const { extractCompletionOutcome } = require('../core/campaigns/outcomes');

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-campaign-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeCampaign(name, status = 'active') {
  return [
    '---',
    'version: 1',
    `status: ${status}`,
    'phase_count: 3',
    'current_phase: 1',
    '---',
    '',
    `# Campaign: ${name}`,
    '',
    `Status: ${status}`,
    '',
    '## Claimed Scope',
    '- src/',
    '- docs/guide.md',
    '',
    '## Restricted Files',
    '- .env.production',
  ].join('\n');
}

function makePhasedCampaign(name, phaseStatuses, status = 'active') {
  return [
    '---',
    'version: 1',
    `status: ${status}`,
    '---',
    '',
    `# Campaign: ${name}`,
    '',
    `Status: ${status}`,
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    ...phaseStatuses.map((phaseStatus, index) => `| ${index + 1} | ${phaseStatus} | build | Phase ${index + 1} | done |`),
  ].join('\n');
}

const parsed = parseCampaignContent(makeCampaign('Parser Test'));
assert.equal(parsed.frontmatter.phase_count, 3, 'frontmatter numbers should parse as numbers');
assert.equal(parsed.bodyStatus, 'active', 'body status should be parsed');
assert.deepEqual(parsed.claimedScope, ['src/', 'docs/guide.md'], 'claimed scope should parse from bullets');
assert.deepEqual(parsed.restrictedFiles, ['.env.production'], 'restricted files should parse from bullets');

withTempProject((projectRoot) => {
  const paths = getCampaignPaths(projectRoot);
  fs.mkdirSync(paths.campaignsDir, { recursive: true });
  fs.mkdirSync(paths.completedDir, { recursive: true });

  const activeFile = path.join(paths.campaignsDir, 'alpha.md');
  const completedFile = path.join(paths.completedDir, 'beta.md');
  fs.writeFileSync(activeFile, makeCampaign('Alpha', 'active'));
  fs.writeFileSync(completedFile, makeCampaign('Beta', 'completed'));

  const active = findActiveCampaign(projectRoot);
  assert(active, 'active campaign should be found');
  assert.equal(active.slug, 'alpha', 'active campaign slug should be derived from filename');

  const updated = updateCampaignStatus(activeFile, 'completed');
  assert.equal(updated.frontmatter.status, 'completed', 'frontmatter status should update');
  assert.equal(updated.bodyStatus, 'completed', 'body status should update');

  const archived = archiveCampaign(activeFile, projectRoot);
  assert.equal(archived.slug, 'alpha', 'archived campaign slug should be preserved');
  assert(fs.existsSync(path.join(paths.completedDir, 'alpha.md')), 'archived file should move into completed/');

  const stats = readCampaignStats(projectRoot);
  assert.deepEqual(stats.active, [], 'no active campaigns should remain after archive');
  assert.equal(stats.completed_count, 2, 'completed count should include archived campaign');
});

withTempProject((projectRoot) => {
  const paths = getCampaignPaths(projectRoot);
  fs.mkdirSync(paths.campaignsDir, { recursive: true });

  const incompleteFile = path.join(paths.campaignsDir, 'incomplete.md');
  fs.writeFileSync(incompleteFile, makePhasedCampaign('Incomplete', ['complete', 'pending']));
  assert.throws(
    () => completeCampaign(incompleteFile, projectRoot, { archive: true }),
    /incomplete phases/,
    'completion should reject incomplete phases without force'
  );

  const completeFile = path.join(paths.campaignsDir, 'complete.md');
  fs.writeFileSync(completeFile, makePhasedCampaign('Complete', ['complete', 'completed']));
  const result = completeCampaign(completeFile, projectRoot, {
    archive: true,
    pr: 'https://github.com/example/repo/pull/1',
    mergeSha: 'abc123',
    verification: 'npm run test',
  });
  assert.equal(result.frontmatter.status, 'completed');
  assert.equal(result.bodyStatus, 'completed');
  assert(result.content.includes('## Completion Record'));
  assert(result.content.includes('- Outcome: shipped-pr'));
  assert(result.content.includes('https://github.com/example/repo/pull/1'));
  assert.equal(extractCompletionOutcome(result.content), 'shipped-pr');
  assert(fs.existsSync(path.join(paths.completedDir, 'complete.md')), 'completed campaign should be archived');

  const cliFile = path.join(paths.campaignsDir, 'cli.md');
  fs.writeFileSync(cliFile, makePhasedCampaign('Cli', ['complete']));
  const output = childProcess.execFileSync(process.execPath, [
    path.join(__dirname, 'campaign.js'),
    'complete',
    'cli',
    '--archive',
    '--project-root',
    projectRoot,
    '--outcome',
    'implementation-plan',
  ], { encoding: 'utf8' });
  assert(output.includes('Campaign completed.'));
  assert(fs.existsSync(path.join(paths.completedDir, 'cli.md')), 'CLI should archive completed campaign');
  assert(fs.readFileSync(path.join(paths.completedDir, 'cli.md'), 'utf8').includes('- Outcome: implementation-plan'));

  const invalidFile = path.join(paths.campaignsDir, 'invalid.md');
  fs.writeFileSync(invalidFile, makePhasedCampaign('Invalid', ['complete']));
  assert.throws(
    () => completeCampaign(invalidFile, projectRoot, { outcome: 'not-real' }),
    /Unknown campaign outcome/,
    'completion should reject unknown outcome labels'
  );
});

withTempProject((projectRoot) => {
  const legacyFile = path.join(projectRoot, 'legacy.md');
  fs.writeFileSync(legacyFile, makePhasedCampaign('Legacy Layout', ['pending', 'pending']));
  updatePhaseStatus(legacyFile, 1, 'in-progress');
  const legacyUpdated = fs.readFileSync(legacyFile, 'utf8');
  assert(legacyUpdated.includes('| 1 | in-progress | build | Phase 1 | done |'));
  assert(legacyUpdated.includes('| 2 | pending | build | Phase 2 | done |'));

  const currentFile = path.join(projectRoot, 'current.md');
  const currentCampaign = [
    '# Campaign: Current Layout',
    '',
    '| # | Status | Label |',
    '|---|--------|-------|',
    '| 2 | untouched | unrelated |',
    '',
    '## Phase End Conditions',
    '',
    '| Phase | Type | Title | Status | End Conditions | Validator Retries |',
    '|-------|------|-------|--------|----------------|-------------------|',
    '| 1 | research | Observe | complete | evidence | 3 |',
    '| 2 | build | Repair | pending | tests | 2 |',
  ].join('\n');
  fs.writeFileSync(currentFile, currentCampaign);
  updatePhaseStatus(currentFile, 2, 'in-progress');
  const currentUpdated = fs.readFileSync(currentFile, 'utf8');
  assert(currentUpdated.includes('| 2 | untouched | unrelated |'));
  assert(currentUpdated.includes('| 2 | build | Repair | in-progress | tests | 2 |'));
  assert(currentUpdated.includes('| 1 | research | Observe | complete | evidence | 3 |'));
  assert.deepStrictEqual(
    fs.readdirSync(projectRoot).filter((name) => name.includes('.tmp-')),
    []
  );

  const missingStatusFile = path.join(projectRoot, 'missing-status.md');
  const missingStatusCampaign = [
    '# Campaign: Missing Status',
    '',
    '## Phases',
    '',
    '| Phase | Type | Title |',
    '|-------|------|-------|',
    '| 1 | build | Repair |',
  ].join('\n');
  fs.writeFileSync(missingStatusFile, missingStatusCampaign);
  assert.throws(
    () => updatePhaseStatus(missingStatusFile, 1, 'complete'),
    /missing Status column/
  );
  assert.strictEqual(fs.readFileSync(missingStatusFile, 'utf8'), missingStatusCampaign);

  const missingHeaderFile = path.join(projectRoot, 'missing-header.md');
  const missingHeaderCampaign = [
    '# Campaign: Missing Header',
    '',
    '## Phases',
    '',
    'No phase table has been written yet.',
  ].join('\n');
  fs.writeFileSync(missingHeaderFile, missingHeaderCampaign);
  assert.throws(
    () => updatePhaseStatus(missingHeaderFile, 1, 'complete'),
    /missing Phase\/# and Status column/
  );
  assert.strictEqual(fs.readFileSync(missingHeaderFile, 'utf8'), missingHeaderCampaign);

  const missingPhaseFile = path.join(projectRoot, 'missing-phase.md');
  const missingPhaseCampaign = makePhasedCampaign('Missing Phase', ['pending']);
  fs.writeFileSync(missingPhaseFile, missingPhaseCampaign);
  assert.throws(() => updatePhaseStatus(missingPhaseFile, 9, 'complete'), /phase 9 not found/);
  assert.strictEqual(fs.readFileSync(missingPhaseFile, 'utf8'), missingPhaseCampaign);

  const atomicFile = path.join(projectRoot, 'atomic.md');
  const atomicCampaign = makePhasedCampaign('Atomic Failure', ['pending']);
  fs.writeFileSync(atomicFile, atomicCampaign);
  const originalRenameSync = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('synthetic rename failure'); };
    assert.throws(
      () => updatePhaseStatus(atomicFile, 1, 'complete'),
      /synthetic rename failure/
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.strictEqual(fs.readFileSync(atomicFile, 'utf8'), atomicCampaign);
  assert.deepStrictEqual(
    fs.readdirSync(projectRoot).filter((name) => name.includes('.tmp-')),
    []
  );
});

console.log('campaign core tests passed');

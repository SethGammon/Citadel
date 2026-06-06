'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { parseExitEvidence, validateExitEvidence } = require('../evidence/contracts');
const { getCampaignPaths, readCampaignFile } = require('./load-campaign');
const { updatePhaseStatus } = require('./update-campaign');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function relativePath(projectRoot, filePath) {
  return normalizePath(path.relative(projectRoot, filePath));
}

function resolveCampaignPath(projectRoot, target) {
  if (!target) throw new Error('Missing campaign slug or path.');

  const root = path.resolve(projectRoot || process.cwd());
  const direct = path.resolve(root, target);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;

  const paths = getCampaignPaths(root);
  const slug = target.endsWith('.md') ? target : `${target}.md`;
  const candidates = [
    path.join(paths.campaignsDir, slug),
    path.join(paths.completedDir, slug),
  ];
  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) throw new Error(`Campaign not found: ${target}`);
  return match;
}

function runGit(projectRoot, args) {
  try {
    return childProcess.execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return '';
  }
}

function readGitSnapshot(projectRoot) {
  const branch = runGit(projectRoot, ['branch', '--show-current']) || '(not a git repository)';
  const status = runGit(projectRoot, ['status', '--short']);
  const diffStat = runGit(projectRoot, ['diff', '--stat']);
  const changedFiles = runGit(projectRoot, ['diff', '--name-only']);
  return {
    branch,
    status: status || 'clean',
    diffStat: diffStat || '(no unstaged diff)',
    changedFiles: changedFiles ? changedFiles.split(/\r?\n/).filter(Boolean) : [],
  };
}

function evidenceResult(item, failures) {
  return failures.some((failure) => failure.target === item.target && failure.id === item.id)
    ? 'fail'
    : 'pass';
}

function evidenceSummary(markdown, projectRoot) {
  const report = validateExitEvidence(markdown, { projectRoot });
  const items = parseExitEvidence(markdown);
  return {
    items: items.map((item) => ({
      ...item,
      result: evidenceResult(item, report.failures),
    })),
    failures: report.failures,
    ready: report.pass && !report.missingDeclarations,
  };
}

function renderReviewPackage(projectRoot, campaign, options = {}) {
  const now = options.now || new Date().toISOString();
  const targetKind = options.pr ? 'pull-request' : 'local-package';
  const evidence = evidenceSummary(campaign.content, projectRoot);
  const git = readGitSnapshot(projectRoot);
  const campaignPath = relativePath(projectRoot, campaign.filePath);
  const packagePath = options.packagePath ? relativePath(projectRoot, options.packagePath) : '';
  const target = options.pr || packagePath;
  const verificationRows = evidence.items.filter((item) => item.type === 'test_result' || item.id.includes('verification'));

  const evidenceRows = evidence.items.length > 0
    ? evidence.items.map((item) => `| ${item.target} | ${item.id} | ${item.type} | ${item.required ? 'yes' : 'no'} | ${item.evidence || '(missing)'} | ${item.status || '(blank)'} | ${item.result} |`)
    : ['| (none) | (none) | (none) | no | (none) | (none) | fail |'];

  const changedFiles = git.changedFiles.length > 0
    ? git.changedFiles.map((file) => `- ${file}`)
    : ['- (no unstaged diff files)'];

  const verification = verificationRows.length > 0
    ? verificationRows.map((item) => `- ${item.evidence}: ${item.status || 'pending'} (${item.result})`)
    : ['- (no verification evidence declared)'];

  const handoff = [
    '---HANDOFF---',
    `- Review target: ${target || packagePath}`,
    `- Campaign: ${campaignPath}`,
    `- Evidence readiness: ${evidence.ready ? 'ready' : 'needs-evidence'}`,
    `- Git status: ${git.status === 'clean' ? 'clean' : 'dirty'}`,
    '---',
  ];

  const lines = [
    `# Delivery Review Package: ${campaign.title || campaign.slug}`,
    '',
    `Generated: ${now}`,
    `Campaign: ${campaignPath}`,
    `Review Target: ${target || packagePath}`,
    `Review Target Type: ${targetKind}`,
    `Readiness: ${evidence.ready ? 'ready' : 'needs-evidence'}`,
  ];
  if (options.note) lines.push(`Note: ${options.note}`);
  lines.push(
    '',
    '## Git Snapshot',
    '',
    `- Branch: ${git.branch}`,
    `- Status: ${git.status}`,
    '',
    '### Changed Files',
    '',
    ...changedFiles,
    '',
    '### Diff Stat',
    '',
    '```',
    git.diffStat,
    '```',
    '',
    '## Evidence Summary',
    '',
    '| Target | ID | Type | Required | Evidence | Status | Result |',
    '|---|---|---|---|---|---|---|',
    ...evidenceRows,
    '',
    '## Verification',
    '',
    ...verification,
    '',
    ...handoff,
    '',
  );
  return lines.join('\n');
}

function updateReviewEvidence(content, replacement) {
  const lines = content.split(/\r?\n/);
  let inExitEvidence = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^##\s+Exit Evidence\s*$/i.test(line.trim())) {
      inExitEvidence = true;
      continue;
    }
    if (inExitEvidence && /^##\s+/.test(line.trim())) break;
    if (!inExitEvidence || !line.trim().startsWith('|')) continue;

    const cells = line.split('|').map((cell) => cell.trim());
    if (cells[2] !== 'review-package') continue;
    lines[index] = `| ${cells[1]} | review-package | ${replacement.type} | yes | ${replacement.evidence} | resolved | ${cells[7] || '0'} | ${replacement.nextAction} |`;
    return lines.join('\n');
  }
  throw new Error('Campaign does not declare a review-package Exit Evidence row.');
}

function packageDelivery(projectRoot, target, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const campaignPath = resolveCampaignPath(root, target);
  const campaign = readCampaignFile(campaignPath);
  const packageDir = path.join(root, '.planning', 'review-packages');
  const packagePath = path.join(packageDir, `${campaign.slug}.md`);
  const reviewEvidence = options.pr || relativePath(root, packagePath);
  const reviewType = options.pr ? 'pr_link' : 'review_package';

  fs.mkdirSync(packageDir, { recursive: true });
  if (!options.pr) fs.writeFileSync(packagePath, '', 'utf8');

  const updated = updateReviewEvidence(fs.readFileSync(campaignPath, 'utf8'), {
    type: reviewType,
    evidence: reviewEvidence,
    nextAction: options.pr ? 'review pull request' : 'review local handoff package',
  });
  fs.writeFileSync(campaignPath, updated, 'utf8');
  const updatedCampaign = updatePhaseStatus(campaignPath, 4, 'complete');

  const packageMarkdown = renderReviewPackage(root, updatedCampaign, {
    now: options.now,
    note: options.note,
    pr: options.pr,
    packagePath,
  });
  fs.writeFileSync(packagePath, packageMarkdown, 'utf8');

  return {
    slug: campaign.slug,
    campaignPath,
    packagePath,
    reviewType,
    reviewEvidence,
    readiness: evidenceSummary(updatedCampaign.content, root).ready ? 'ready' : 'needs-evidence',
  };
}

module.exports = {
  evidenceSummary,
  packageDelivery,
  readGitSnapshot,
  renderReviewPackage,
  resolveCampaignPath,
  updateReviewEvidence,
};

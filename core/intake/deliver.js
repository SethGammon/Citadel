'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseFrontmatter, parseSection } = require('../campaigns/parse-campaign');
const { createMapSlice, defaultOutputPath, loadMapIndex } = require('../map');

function slugify(value) {
  return String(value || 'delivery')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'delivery';
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function readIntakeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatter = parseFrontmatter(content);
  const title = frontmatter.title || path.basename(filePath, '.md');
  const description = parseSection(content, 'Description') || content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const acceptance = parseSection(content, 'Acceptance Criteria') || '';
  const notes = parseSection(content, 'Notes') || '';

  return {
    filePath,
    content,
    frontmatter,
    title: String(title).replace(/^["']|["']$/g, ''),
    status: String(frontmatter.status || 'pending').toLowerCase(),
    priority: String(frontmatter.priority || 'normal').toLowerCase(),
    target: String(frontmatter.target || '').trim(),
    description: description.trim(),
    acceptance: acceptance.trim(),
    notes: notes.trim(),
  };
}

function updateIntakeFrontmatter(content, updates) {
  if (!content.startsWith('---')) return content;
  return content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_match, body) => {
    const lines = body.split(/\r?\n/);
    const seen = new Set();
    const updated = lines.map((line) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!match) return line;
      const key = match[1];
      if (!Object.prototype.hasOwnProperty.call(updates, key)) return line;
      seen.add(key);
      return `${key}: ${updates[key]}`;
    });

    for (const [key, value] of Object.entries(updates)) {
      if (!seen.has(key)) updated.push(`${key}: ${value}`);
    }

    return `---\n${updated.join('\n')}\n---`;
  });
}

function readMapSlice(projectRoot, intake) {
  const outputPath = defaultOutputPath(projectRoot);
  if (!fs.existsSync(outputPath)) return null;
  try {
    const index = loadMapIndex(outputPath);
    const terms = [intake.target, intake.title].filter(Boolean).join(' ');
    return createMapSlice(index, terms || intake.title, { maxFiles: 12 });
  } catch (_) {
    return null;
  }
}

function renderCampaign(projectRoot, intake, options = {}) {
  const now = options.now || new Date().toISOString();
  const slug = options.slug || slugify(intake.title);
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const target = intake.target || '(unscoped)';
  const mapSlice = readMapSlice(projectRoot, intake);
  const verification = options.verification || 'npm run test';

  return [
    '---',
    'version: 1',
    `id: "${id}"`,
    'status: active',
    `started: "${now}"`,
    'completed_at: null',
    `direction: "${intake.title.replace(/"/g, '\\"')}"`,
    'phase_count: 4',
    'current_phase: 2',
    'branch: null',
    'worktree_status: null',
    '---',
    '',
    `# Campaign: ${intake.title}`,
    '',
    'Status: active',
    `Started: ${now}`,
    `Direction: ${intake.title}`,
    '',
    '## Claimed Scope',
    `- ${target}`,
    '',
    '## Intake Source',
    '',
    `- File: ${normalizePath(path.relative(projectRoot, intake.filePath))}`,
    `- Priority: ${intake.priority}`,
    `- Initial Status: ${intake.status}`,
    '',
    '## Delivery Brief',
    '',
    intake.description || '(no description supplied)',
    '',
    '## Acceptance Criteria',
    '',
    intake.acceptance || '- Define concrete acceptance criteria before build.',
    '',
    '## Map Context',
    '',
    mapSlice ? ['```', mapSlice, '```'].join('\n') : 'No map index available. Run `node scripts/map-index.js --generate --root .` before delegation.',
    '',
    '## Phases',
    '',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    '| 1 | complete | brief | Intake preflight and campaign scaffold | Campaign file exists with scope, acceptance criteria, and evidence contract |',
    '| 2 | pending | build | Implement requested change | Required files are changed and implementation diff is available |',
    `| 3 | pending | verify | Run verification | ${verification} passes |`,
    '| 4 | pending | package | Package for review | PR link or local handoff is recorded |',
    '',
    '## Exit Evidence',
    '',
    '| Target | ID | Type | Required | Evidence | Status | Retries Remaining | Next Action |',
    '|---|---|---|---|---|---|---|---|',
    '| phase:2 | implementation-diff | file_diff | yes | git diff --stat | pending | 2 | implement requested change |',
    `| phase:3 | verification-command | test_result | yes | ${verification} | pending | 2 | fix verification failures |`,
    '| phase:4 | review-package | pr_link | yes | PR URL or local handoff path | pending | 2 | package delivery for review |',
    '',
    '## Decision Log',
    '',
    `- ${now}: Created delivery campaign from intake preflight.`,
    '  Reason: Convert intake into an evidence-backed delivery loop before implementation.',
    '',
    '## Active Context',
    '',
    'Delivery preflight complete. Next action: implement Phase 2 using the claimed scope, acceptance criteria, map context, and evidence contract.',
    '',
    '## Continuation State',
    '',
    'Phase: 2',
    'Sub-step: implementation not started',
    'Files modified: campaign scaffold only',
    'Blocking: none',
    '',
  ].join('\n');
}

function createDeliveryFromIntake(projectRoot, intakePath, options = {}) {
  const resolvedRoot = path.resolve(projectRoot || process.cwd());
  const resolvedIntake = path.resolve(resolvedRoot, intakePath);
  const intake = readIntakeFile(resolvedIntake);
  const slug = options.slug || slugify(intake.title);
  const campaignPath = path.join(resolvedRoot, '.planning', 'campaigns', `${slug}.md`);

  if (fs.existsSync(campaignPath) && !options.force) {
    throw new Error(`Campaign already exists: ${normalizePath(path.relative(resolvedRoot, campaignPath))}`);
  }

  fs.mkdirSync(path.dirname(campaignPath), { recursive: true });
  const campaign = renderCampaign(resolvedRoot, intake, { ...options, slug });
  fs.writeFileSync(campaignPath, campaign, 'utf8');

  const updatedIntake = updateIntakeFrontmatter(intake.content, {
    status: 'in-progress',
    campaign: slug,
  });
  fs.writeFileSync(resolvedIntake, updatedIntake, 'utf8');

  return {
    slug,
    campaignPath,
    intakePath: resolvedIntake,
    target: intake.target,
    status: 'in-progress',
  };
}

module.exports = {
  createDeliveryFromIntake,
  readIntakeFile,
  renderCampaign,
  slugify,
  updateIntakeFrontmatter,
};

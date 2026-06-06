'use strict';

const fs = require('fs');
const path = require('path');
const { getCampaignPaths, readCampaignFile } = require('./load-campaign');
const { inferCompletionOutcome } = require('./outcomes');

const COMPLETE_PHASE_STATUSES = new Set(['complete', 'completed', 'done', 'skipped']);

function isPhaseComplete(phase) {
  return COMPLETE_PHASE_STATUSES.has(String(phase.status || '').trim().toLowerCase());
}

function updateCampaignStatus(filePath, status) {
  let content = fs.readFileSync(filePath, 'utf8');

  if (/^(status:\s*).+$/im.test(content)) {
    content = content.replace(/^(status:\s*).+$/im, `$1${status}`);
  }

  if (/^(Status:\s*).+$/m.test(content)) {
    content = content.replace(/^(Status:\s*).+$/m, `$1${status}`);
  }

  fs.writeFileSync(filePath, content);
  return readCampaignFile(filePath);
}

function appendCompletionRecord(filePath, details = {}) {
  let content = fs.readFileSync(filePath, 'utf8').replace(/\s*$/, '\n');
  const lines = [
    '',
    '## Completion Record',
    '',
    `- Completed At: ${details.completedAt || new Date().toISOString()}`,
    `- Outcome: ${details.outcome}`,
  ];

  if (details.pr) lines.push(`- PR: ${details.pr}`);
  if (details.mergeSha) lines.push(`- Merge SHA: ${details.mergeSha}`);
  if (details.verification) lines.push(`- Verification: ${details.verification}`);
  if (details.note) lines.push(`- Note: ${details.note}`);

  if (/^##\s+Completion Record\s*$/im.test(content)) {
    content = content.replace(
      /^##\s+Completion Record\s*\r?\n[\s\S]*?(?=^##\s+|\s*$)/im,
      lines.join('\n') + '\n\n'
    );
  } else {
    content += `${lines.join('\n')}\n`;
  }

  fs.writeFileSync(filePath, content);
  return readCampaignFile(filePath);
}

function completeCampaign(filePath, projectRoot, options = {}) {
  const campaign = readCampaignFile(filePath);
  const incomplete = (campaign.phases || []).filter((phase) => !isPhaseComplete(phase));
  if (incomplete.length > 0 && !options.force) {
    const labels = incomplete.map((phase) => `phase:${phase.number}:${phase.status}`).join(', ');
    throw new Error(`Campaign has incomplete phases: ${labels}. Use --force only after human review.`);
  }

  updateCampaignStatus(filePath, 'completed');
  const recorded = appendCompletionRecord(filePath, {
    completedAt: options.completedAt,
    outcome: inferCompletionOutcome(campaign.content, options),
    pr: options.pr,
    mergeSha: options.mergeSha,
    verification: options.verification,
    note: options.note,
  });

  if (options.archive) {
    return archiveCampaign(recorded.filePath, projectRoot);
  }

  return recorded;
}

/**
 * Update the status cell of a specific phase row in the Phases table.
 *
 * Finds the row whose first data cell matches `phaseNumber`, replaces the
 * Status cell in place, and writes the file. The rest of the row is untouched.
 *
 * Valid status values (by convention): pending, in-progress, design-complete,
 * complete, partial, failed, skipped.
 *
 * @param {string} filePath    - Absolute path to the campaign markdown file
 * @param {number} phaseNumber - Phase number to update (matches the # column)
 * @param {string} newStatus   - New status string to write into the Status cell
 * @returns {object} Updated campaign object from readCampaignFile
 */
function updatePhaseStatus(filePath, phaseNumber, newStatus) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Find the Phases section and locate the matching row.
  // Row format: | N | status | type | name | done when |
  // We match the row by its leading number cell (| N |) and rewrite the
  // second cell (Status) without touching anything else.
  const rowPattern = new RegExp(
    `(^\\|\\s*${phaseNumber}\\s*\\|\\s*)([^|]+)(\\|.*)$`,
    'm'
  );

  if (!rowPattern.test(content)) {
    throw new Error(
      `updatePhaseStatus: phase ${phaseNumber} not found in ${path.basename(filePath)}`
    );
  }

  content = content.replace(rowPattern, (_, pre, _oldStatus, rest) => {
    // Preserve original padding width if possible
    const padded = ` ${newStatus} `;
    return `${pre}${padded}${rest}`;
  });

  fs.writeFileSync(filePath, content);
  return readCampaignFile(filePath);
}

function archiveCampaign(filePath, projectRoot) {
  const paths = getCampaignPaths(projectRoot);
  fs.mkdirSync(paths.completedDir, { recursive: true });
  const destination = path.join(paths.completedDir, path.basename(filePath));
  fs.renameSync(filePath, destination);
  return readCampaignFile(destination);
}

module.exports = {
  archiveCampaign,
  completeCampaign,
  isPhaseComplete,
  updateCampaignStatus,
  updatePhaseStatus,
};

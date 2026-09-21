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
 * Update the status cell of a specific phase row in a campaign phase table.
 *
 * Finds a table scoped to a Phases or Phase End Conditions section, derives
 * the phase and status columns from its header, and updates only the matching
 * Status cell. Both legacy `# | Status | ...` and current
 * `Phase | ... | Status | ...` layouts are supported.
 *
 * Valid status values (by convention): pending, in-progress, design-complete,
 * complete, partial, failed, skipped.
 *
 * @param {string} filePath    - Absolute path to the campaign markdown file
 * @param {number} phaseNumber - Phase number to update (matches Phase or #)
 * @param {string} newStatus   - New status string to write into the Status cell
 * @returns {object} Updated campaign object from readCampaignFile
 */
function updatePhaseStatus(filePath, phaseNumber, newStatus) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const phaseValue = String(phaseNumber).trim();
  let phaseSectionLevel = null;
  let sawPhaseSection = false;
  let sawPhaseColumn = false;
  let sawStatusColumn = false;
  let sawPhaseTableHeader = false;
  let matchedRowIndex = -1;
  let matchedStatusIndex = -1;

  const splitRow = (line) => {
    if (!/^\s*\|.*\|\s*$/.test(line)) return null;
    return line.trim().slice(1, -1).split('|');
  };
  const isSeparator = (cells) =>
    cells && cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  const isPhaseValue = (cell) => {
    const normalized = cell.trim().toLowerCase();
    return normalized === phaseValue.toLowerCase() ||
      normalized === `phase ${phaseValue}`.toLowerCase();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim().toLowerCase();
      if (title === 'phases' || title === 'phase end conditions') {
        phaseSectionLevel = level;
        sawPhaseSection = true;
      } else if (phaseSectionLevel !== null && level <= phaseSectionLevel) {
        phaseSectionLevel = null;
      }
      continue;
    }
    if (phaseSectionLevel === null) continue;

    const headerCells = splitRow(lines[index]);
    const separatorCells = index + 1 < lines.length
      ? splitRow(lines[index + 1])
      : null;
    if (!headerCells || !isSeparator(separatorCells) ||
      headerCells.length !== separatorCells.length) continue;

    const normalizedHeaders = headerCells.map((cell) => cell.trim().toLowerCase());
    const phaseIndex = normalizedHeaders.findIndex((cell) => cell === 'phase' || cell === '#');
    const statusIndex = normalizedHeaders.indexOf('status');
    sawPhaseColumn = sawPhaseColumn || phaseIndex >= 0;
    sawStatusColumn = sawStatusColumn || statusIndex >= 0;
    if (phaseIndex < 0 || statusIndex < 0) continue;
    sawPhaseTableHeader = true;

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowCells = splitRow(lines[rowIndex]);
      if (!rowCells) break;
      if (rowCells.length <= Math.max(phaseIndex, statusIndex)) continue;
      if (isPhaseValue(rowCells[phaseIndex])) {
        matchedRowIndex = rowIndex;
        matchedStatusIndex = statusIndex;
        break;
      }
    }
    if (matchedRowIndex >= 0) break;
  }

  if (!sawPhaseSection) {
    throw new Error(
      `updatePhaseStatus: phase table section not found in ${path.basename(filePath)}`
    );
  }
  if (!sawPhaseTableHeader) {
    const missing = [];
    if (!sawPhaseColumn) missing.push('Phase/#');
    if (!sawStatusColumn) missing.push('Status');
    const detail = missing.length > 0
      ? `missing ${missing.join(' and ')} column`
      : 'requires Phase/# and Status columns in the same header';
    throw new Error(
      `updatePhaseStatus: phase table ${detail} in ${path.basename(filePath)}`
    );
  }
  if (matchedRowIndex < 0) {
    throw new Error(
      `updatePhaseStatus: phase ${phaseNumber} not found in ${path.basename(filePath)}`
    );
  }

  const rowCells = splitRow(lines[matchedRowIndex]);
  const statusCell = rowCells[matchedStatusIndex];
  const leadingWhitespace = statusCell.match(/^\s*/)[0];
  const trailingWhitespace = statusCell.match(/\s*$/)[0];
  rowCells[matchedStatusIndex] =
    `${leadingWhitespace}${newStatus}${trailingWhitespace}`;
  const originalIndent = lines[matchedRowIndex].match(/^\s*/)[0];
  lines[matchedRowIndex] = `${originalIndent}|${rowCells.join('|')}|`;
  const updatedContent = lines.join(lineEnding);

  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-` +
    Math.random().toString(16).slice(2);
  try {
    fs.writeFileSync(temporaryPath, updatedContent);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
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

'use strict';

const fs = require('fs');
const path = require('path');
const { getCampaignPaths, readCampaignFile } = require('./load-campaign');

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
  updateCampaignStatus,
  updatePhaseStatus,
};

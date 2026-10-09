'use strict';

const { parseFrontmatter } = require('../campaigns/parse-campaign');

const PENDING_STATUSES = Object.freeze(['pending']);
const IN_PROGRESS_STATUSES = Object.freeze(['in-progress', 'briefed', 'approved']);
const INACTIVE_STATUSES = Object.freeze([
  'completed', 'archived', 'closed', 'deferred', 'rejected', 'cancelled',
]);

/**
 * Whether a directory entry is an intake item. Templates (`_`-prefixed) and
 * dotfiles are excluded.
 *
 * @param {string} name - Directory entry name
 * @returns {boolean}
 */
function isIntakeItemFile(name) {
  return name.endsWith('.md') && !name.startsWith('_') && !name.startsWith('.');
}

/**
 * Read an intake item's status from its frontmatter only. The key match is
 * case-insensitive so `Status: Pending` and `status: pending` agree.
 *
 * @param {string} content - Full intake file content
 * @returns {string|null} Lowercased status, or null when no status is declared
 */
function readIntakeStatus(content) {
  const frontmatter = parseFrontmatter(String(content || ''));
  const key = Object.keys(frontmatter).find((name) => name.toLowerCase() === 'status');
  if (!key) return null;
  const value = String(frontmatter[key]).trim().toLowerCase();
  return value || null;
}

/**
 * Classify an intake item for counting. A missing status is pending; a present
 * but unrecognised status is never treated as pending.
 *
 * @param {string} content - Full intake file content
 * @returns {'pending'|'in-progress'|'inactive'|'unrecognised'}
 */
function classifyIntakeStatus(content) {
  const status = readIntakeStatus(content);
  if (status === null || PENDING_STATUSES.includes(status)) return 'pending';
  if (IN_PROGRESS_STATUSES.includes(status)) return 'in-progress';
  if (INACTIVE_STATUSES.includes(status)) return 'inactive';
  return 'unrecognised';
}

module.exports = {
  INACTIVE_STATUSES,
  IN_PROGRESS_STATUSES,
  PENDING_STATUSES,
  classifyIntakeStatus,
  isIntakeItemFile,
  readIntakeStatus,
};

'use strict';

const { parseExitEvidence } = require('../evidence/contracts');

const OUTCOME_TYPES = new Set([
  'shipped-pr',
  'review-package',
  'implementation-plan',
  'blocked-decision',
  'archived-completion',
]);

function validateOutcome(value) {
  const outcome = String(value || '').trim();
  if (!outcome) return '';
  if (!OUTCOME_TYPES.has(outcome)) {
    throw new Error(`Unknown campaign outcome: ${outcome}. Expected one of: ${Array.from(OUTCOME_TYPES).join(', ')}`);
  }
  return outcome;
}

function reviewPackageOutcome(content) {
  const item = parseExitEvidence(content || '').find((entry) => entry.id === 'review-package');
  if (!item || String(item.status || '').toLowerCase() !== 'resolved') return '';
  if (item.type === 'pr_link') return 'review-package';
  if (item.type === 'review_package') return 'review-package';
  return '';
}

function inferCompletionOutcome(content, options = {}) {
  const explicit = validateOutcome(options.outcome);
  if (explicit) return explicit;
  if (options.mergeSha) return 'shipped-pr';
  const reviewOutcome = reviewPackageOutcome(content);
  if (reviewOutcome) return reviewOutcome;
  if (options.pr) return 'review-package';
  return 'archived-completion';
}

function extractCompletionOutcome(content) {
  const lines = String(content || '').split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+Completion Record\s*$/i.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line.trim())) break;
    if (!inSection) continue;
    const match = line.match(/^-\s+Outcome:\s*(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

module.exports = {
  OUTCOME_TYPES,
  extractCompletionOutcome,
  inferCompletionOutcome,
  reviewPackageOutcome,
  validateOutcome,
};

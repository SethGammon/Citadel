'use strict';

const fs = require('fs');
const path = require('path');

const EVIDENCE_TYPES = [
  'file_diff',
  'command_result',
  'test_result',
  'screenshot',
  'browser_route_check',
  'doc_update',
  'pr_link',
  'review_thread_resolution',
  'hook_status',
];

const PASS_STATUSES = new Set(['pass', 'passed', 'verified', 'resolved', 'clean', 'ok']);

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function parseMarkdownTables(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const tables = [];
  for (let index = 0; index < lines.length - 1; index++) {
    if (!lines[index].trim().startsWith('|')) continue;
    if (!/^\s*\|?[\s:-]+\|/.test(lines[index + 1])) continue;
    const header = splitRow(lines[index]).map(normalizeHeader);
    const rows = [];
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      const cells = splitRow(lines[index]);
      const row = {};
      header.forEach((key, offset) => { row[key] = cells[offset] || ''; });
      rows.push(row);
      index++;
    }
    tables.push({ header, rows });
  }
  return tables;
}

function parseExitEvidence(markdown) {
  return parseMarkdownTables(markdown)
    .filter((table) => table.header.includes('target') && table.header.includes('type') && table.header.includes('evidence'))
    .flatMap((table) => table.rows.map((row) => ({
      target: row.target || row.phase || row.task || '',
      id: row.id || row.evidence_id || '',
      type: row.type || '',
      required: !['no', 'false', 'optional', 'advisory'].includes(String(row.required || 'yes').toLowerCase()),
      evidence: row.evidence || row.path || row.command || row.url || '',
      status: String(row.status || '').toLowerCase(),
      retries_remaining: Number.parseInt(row.retries_remaining || row.retries || '0', 10) || 0,
      next_action: row.next_action || row.repair || '',
    })));
}

function looksLikePath(value) {
  return /^[./\\\w-]+[\\/][^:*?"<>|]+$/.test(String(value || '')) || /\.[a-z0-9]+$/i.test(String(value || ''));
}

function pathExists(projectRoot, evidence) {
  const firstToken = String(evidence || '').split(/\s+/)[0];
  if (!looksLikePath(firstToken)) return true;
  if (/^https?:\/\//i.test(firstToken)) return true;
  return fs.existsSync(path.resolve(projectRoot, firstToken));
}

function validateEvidenceItem(item, options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const issues = [];
  if (!item.id) issues.push('missing id');
  if (!item.target) issues.push('missing target');
  if (!EVIDENCE_TYPES.includes(item.type)) issues.push(`unsupported evidence type ${item.type || '(blank)'}`);
  if (item.required && !item.evidence) issues.push('missing evidence');
  if (item.required && !PASS_STATUSES.has(item.status)) issues.push(`status is not passing: ${item.status || '(blank)'}`);

  if (item.evidence && ['screenshot', 'doc_update', 'file_diff'].includes(item.type) && !pathExists(projectRoot, item.evidence)) {
    issues.push(`evidence path not found: ${item.evidence}`);
  }
  if (item.type === 'pr_link' && item.evidence && !/^https?:\/\/.+\/pull\/\d+/i.test(item.evidence)) {
    issues.push('PR evidence must be a pull request URL');
  }
  if (item.type === 'review_thread_resolution' && item.required && !['resolved', 'pass', 'verified'].includes(item.status)) {
    issues.push('review thread is not resolved');
  }
  return issues;
}

function validateExitEvidence(markdown, options = {}) {
  const target = options.target ? String(options.target).toLowerCase() : null;
  const items = parseExitEvidence(markdown)
    .filter((item) => !target || String(item.target).toLowerCase() === target || String(item.id).toLowerCase() === target);
  const failures = [];
  for (const item of items) {
    const issues = validateEvidenceItem(item, options);
    if (issues.length > 0 && item.required) {
      failures.push({
        ...item,
        issues,
        action: item.retries_remaining > 0 ? 'repair-task' : 'block-advancement',
      });
    }
  }
  return {
    items,
    failures,
    pass: failures.length === 0,
    missingDeclarations: items.length === 0,
  };
}

function appendRepairTasks(markdown, failures) {
  if (failures.length === 0) return markdown;
  const lines = [];
  if (!/\n## Repair Tasks\b/.test(markdown)) lines.push('\n## Repair Tasks\n');
  for (const failure of failures) {
    const next = failure.next_action || `Provide ${failure.type} evidence for ${failure.target}`;
    lines.push(`- Repairs ${failure.target}/${failure.id}: ${failure.issues.join('; ')}. Next: ${next}. Retries remaining: ${Math.max(0, failure.retries_remaining - 1)}.`);
  }
  return `${markdown.replace(/\s*$/, '')}\n${lines.join('\n')}\n`;
}

module.exports = {
  EVIDENCE_TYPES,
  appendRepairTasks,
  parseExitEvidence,
  validateEvidenceItem,
  validateExitEvidence,
};

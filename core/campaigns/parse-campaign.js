'use strict';

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const raw = kv[2].trim().replace(/^["']|["']$/g, '');
    result[kv[1]] = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  }

  return result;
}

function parseSection(content, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'm');
  const match = content.match(regex);
  return match ? match[1] : null;
}

function parseBulletSection(content, sectionName) {
  const section = parseSection(content, sectionName);
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*\s]+/, '').trim())
    .filter(Boolean);
}

/**
 * Parse the Phases markdown table into structured objects.
 *
 * Expects a table with columns (in any order):
 *   | # | Status | Type | Phase | Done When |
 *
 * Returns an array of phase objects. Rows that don't parse cleanly are skipped.
 *
 * @param {string} content - Full campaign file content
 * @returns {Array<{number: number, status: string, type: string, name: string, doneWhen: string}>}
 */
function parsePhaseTable(content) {
  const section = parseSection(content, 'Phases');
  if (!section) return [];

  const rows = section.split(/\r?\n/).filter(line => line.trim().startsWith('|'));
  if (rows.length < 2) return [];

  // First row is the header — extract column positions
  const headerCells = rows[0].split('|').map(c => c.trim().toLowerCase());
  const col = {
    number: headerCells.indexOf('#'),
    status: headerCells.indexOf('status'),
    type: headerCells.indexOf('type'),
    name: headerCells.findIndex(h => h === 'phase' || h === 'name'),
    doneWhen: headerCells.findIndex(h => h.includes('done') || h.includes('when')),
  };

  // Second row is the separator — skip it
  const dataRows = rows.slice(2);
  const phases = [];

  for (const row of dataRows) {
    const cells = row.split('|').map(c => c.trim());
    // cells[0] is empty (before first |), col indices from indexOf already
    // account for this empty slot so use them directly — no +1 adjustment.
    const get = (idx) => (idx >= 0 && idx < cells.length ? cells[idx] : '');
    const num = parseInt(get(col.number), 10);
    if (Number.isNaN(num)) continue;
    phases.push({
      number: num,
      status: get(col.status) || 'pending',
      type: get(col.type) || '',
      name: get(col.name) || '',
      doneWhen: get(col.doneWhen) || '',
    });
  }

  return phases;
}

function parseCampaignContent(content, options = {}) {
  const slug = options.slug || null;
  const frontmatter = parseFrontmatter(content);
  const bodyStatusMatch = content.match(/^Status:\s*(\S+)$/im);
  const titleMatch = content.match(/^#\s+Campaign:\s*(.+)$/im);

  return {
    slug,
    content,
    frontmatter,
    title: titleMatch ? titleMatch[1].trim() : slug,
    bodyStatus: bodyStatusMatch ? bodyStatusMatch[1].trim() : null,
    phases: parsePhaseTable(content),
    claimedScope: parseBulletSection(content, 'Claimed Scope'),
    restrictedFiles: parseBulletSection(content, 'Restricted Files'),
  };
}

module.exports = {
  parseCampaignContent,
  parseFrontmatter,
  parsePhaseTable,
  parseSection,
};

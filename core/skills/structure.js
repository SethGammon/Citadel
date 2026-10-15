'use strict';

// Shared mandatory SKILL.md contract for lint and the Stop quality gate.
const STRUCTURE_CHECKS = [
  {
    id: 'frontmatter-present',
    level: 'FAIL',
    description: 'frontmatter block present (--- ... ---)',
    check: (fm) => fm !== null,
    fix: 'Add a YAML frontmatter block at the top of SKILL.md starting with ---',
  },
  {
    id: 'frontmatter-name',
    level: 'FAIL',
    description: 'frontmatter: name field present',
    check: (fm) => fm && !!fm.name,
    fix: 'Add `name: skill-name` to frontmatter',
  },
  {
    id: 'frontmatter-description',
    level: 'FAIL',
    description: 'frontmatter: description field present',
    check: (fm) => fm && !!fm.description && fm.description.length >= 10,
    fix: 'Add `description: ...` to frontmatter (min 10 chars)',
  },
  {
    id: 'frontmatter-user-invocable',
    level: 'FAIL',
    description: 'frontmatter: user-invocable declared',
    check: (fm) => fm && ('user-invocable' in fm),
    fix: 'Add `user-invocable: true` or `user-invocable: false` to frontmatter',
  },
  {
    id: 'has-protocol',
    level: 'FAIL',
    description: 'has Protocol / Commands / Steps section',
    check: (fm, body) => /^##\s+(Protocol|Commands|Steps|How\s+(You\s+)?Work|How to Use|Execution Protocol)/im.test(body)
                      || /^###\s+(Step\s+\d|Tier\s+\d|Phase\s+\d)/im.test(body),
    fix: 'Add a `## Protocol` section describing how the skill works step by step',
  },
  {
    id: 'has-quality-gates',
    level: 'FAIL',
    description: 'has Quality Gates section',
    check: (fm, body) => /^##\s+Quality/im.test(body),
    fix: 'Add a `## Quality Gates` section with completion/correctness criteria',
  },
  {
    id: 'has-exit-protocol',
    level: 'FAIL',
    description: 'has Exit Protocol section',
    check: (fm, body) => /^##\s+Exit/im.test(body),
    fix: 'Add an `## Exit Protocol` section describing what the skill outputs when done',
  },

];

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };

  const raw  = match[1];
  const body = match[2];
  const fm   = {};

  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Multiline value (>- or |)
    const multilineMatch = line.match(/^(\S[\w-]*):\s*[>|]-?\s*$/);
    if (multilineMatch) {
      const key = multilineMatch[1];
      const parts = [];
      i++;
      while (i < lines.length && /^\s+/.test(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      fm[key] = parts.join(' ');
      continue;
    }

    // Simple key: value
    const kvMatch = line.match(/^(\S[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].trim();
      if      (val === 'true')  fm[key] = true;
      else if (val === 'false') fm[key] = false;
      else if (val.startsWith('[') && val.endsWith(']')) {
        fm[key] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
      }
      else if (val === '')      fm[key] = null;
      else                      fm[key] = val;
    }
    i++;
  }

  return { frontmatter: fm, body };
}

module.exports = { STRUCTURE_CHECKS, parseFrontmatter };

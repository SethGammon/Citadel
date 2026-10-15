'use strict';

// Deliberately supports only Citadel's flat frontmatter subset, not general YAML.
function scalar(value) {
  if (/^(["']).*\1$/.test(value)) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function parseFrontmatter(content) {
  const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content || '' };
  const raw = match[1];
  const body = match[2];
  const fm = {};
  const lines = raw.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) { index++; continue; }
    const multiline = line.match(/^(\S[\w-]*):\s*[>|]-?\s*$/);
    if (multiline) {
      const key = multiline[1];
      const parts = [];
      index++;
      while (index < lines.length && /^\s+/.test(lines[index])) {
        parts.push(lines[index].trim());
        index++;
      }
      fm[key] = parts.join(' ');
      continue;
    }
    const kv = line.match(/^(\S[\w-]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const value = kv[2].trim();
      if (value === 'true') fm[key] = true;
      else if (value === 'false') fm[key] = false;
      else if (value.startsWith('[') && value.endsWith(']')) {
        fm[key] = value.slice(1, -1).split(',').map((item) => scalar(item.trim())).filter(item => item !== '');
      } else if (value) fm[key] = scalar(value);
      else {
        const items = [];
        let next = index + 1;
        while (next < lines.length) {
          const item = lines[next].match(/^\s+-\s+(.*)$/);
          if (!item) break;
          items.push(scalar(item[1].trim()));
          next++;
        }
        if (items.length > 0) {
          fm[key] = items;
          index = next;
          continue;
        }
        fm[key] = null;
      }
    }
    index++;
  }
  return { frontmatter: fm, body };
}

module.exports = { parseFrontmatter };

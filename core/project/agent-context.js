'use strict';

// Keeps a project's delegated-agent context (.claude/agent-context/ or
// .codex/agent-context/) in step with templates/agent-context/.
//
// The project copy is user-editable, so a file is only replaced when it is
// byte-identical (modulo line endings) to a template version Citadel shipped
// earlier. Anything else is a local customization and is left alone.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// sha256 of every earlier shipped version of each template file, with CRLF
// normalized to LF. When a template changes, add the digest of the version
// being replaced here; scripts/test-agents-md-guidance.js fails until you do.
const PREVIOUS_TEMPLATE_DIGESTS = Object.freeze({
  'rules-summary.md': Object.freeze([
    '779cbc62e5a2d6b332f1f0a9aa071c7cde953f72d7ec5d71d2422c05df93aeec', // 6c04381
    '707079e4a027c47f7677ba0384d0f056ba129cc47b30bde6a3a5493fdd54c6b6', // 490370b
    '60098f9912b7f304f2f15cef5970eea1520d992ef73b90ad8a51b1cc91eb4d49', // 631b94d ("Read CLAUDE.md")
  ]),
});

function contentDigest(content) {
  return crypto.createHash('sha256')
    .update(String(content).replace(/\r\n/g, '\n'))
    .digest('hex');
}

function listTemplateFiles(templateDir, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(templateDir, relative), { withFileTypes: true })) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listTemplateFiles(templateDir, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

// Inspect the entry itself (including dangling and hard links) and each
// component down to the runtime directory. Never follow a redirected parent.
function isRedirected(target, boundary) {
  let current = path.resolve(target);
  const stop = path.resolve(boundary);
  for (;;) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) return true;
    } catch (error) {
      if (error.code !== 'ENOENT') return true;
    }
    if (current === stop) return false;
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

/**
 * Create or refresh a project's agent-context directory from the template.
 *
 * @param {string} templateDir - templates/agent-context in the Citadel install
 * @param {string} targetDir - the project's <runtime>/agent-context directory
 * @returns {{created: string[], refreshed: string[], preserved: string[]}}
 */
function syncAgentContext(templateDir, targetDir) {
  const result = { created: [], refreshed: [], preserved: [] };
  if (!fs.existsSync(templateDir)) return result;
  const boundary = path.dirname(path.resolve(targetDir));

  for (const relative of listTemplateFiles(templateDir)) {
    const source = path.join(templateDir, relative);
    const target = path.join(targetDir, relative);
    const key = relative.split(path.sep).join('/');
    const template = fs.readFileSync(source);

    if (isRedirected(target, boundary)) {
      result.preserved.push(key);
      continue;
    }

    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, template);
      result.created.push(key);
      continue;
    }

    const current = contentDigest(fs.readFileSync(target, 'utf8'));
    if (current === contentDigest(template.toString('utf8'))) continue;
    if ((PREVIOUS_TEMPLATE_DIGESTS[key] || []).includes(current)) {
      fs.writeFileSync(target, template);
      result.refreshed.push(key);
    } else {
      result.preserved.push(key);
    }
  }
  return result;
}

module.exports = {
  PREVIOUS_TEMPLATE_DIGESTS,
  contentDigest,
  syncAgentContext,
};

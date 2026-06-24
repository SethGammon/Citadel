#!/usr/bin/env node

/**
 * noop-apply.js - Phase 4 of the no-op pipeline: apply confirmed removals.
 *
 * Reads the latest judge verdicts (.planning/noop-audit/judge-verdicts-*.json)
 * and applies the actionable ones to the real SKILL.md files: "trim" replaces
 * the line with the trimmed version, "delete" removes the line. "keep" verdicts
 * are ignored. Bumps `last-updated` in any edited skill's frontmatter, per
 * docs/SKILL_LIFECYCLE.md (Protocol edits require a date bump).
 *
 * This is the only destructive step. Always --dry-run first; only apply lines
 * you have confirmed (judge high-confidence and/or Tier 3 ablation).
 *
 * Usage:
 *   node scripts/noop-apply.js --dry-run               # preview every edit
 *   node scripts/noop-apply.js --skill systematic-debugging --dry-run
 *   node scripts/noop-apply.js --skill systematic-debugging   # apply
 *   node scripts/noop-apply.js --verdicts <path.json>  # use a specific verdict file
 *
 * Exit codes: 0 = applied / previewed; 1 = no verdicts or a write error.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR  = path.join(PLUGIN_ROOT, 'skills');
const AUDIT_DIR   = path.join(PLUGIN_ROOT, '.planning', 'noop-audit');

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');

function getArgValue(flag) {
  const eq = args.find(a => a.startsWith(flag + '='));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}
const skillFilter  = getArgValue('--skill');
const verdictsPath = getArgValue('--verdicts');

function loadVerdicts() {
  let file = verdictsPath;
  if (!file) {
    if (!fs.existsSync(AUDIT_DIR)) return null;
    const files = fs.readdirSync(AUDIT_DIR).filter(f => /^judge-verdicts-.*\.json$/.test(f)).sort();
    if (files.length === 0) return null;
    file = path.join(AUDIT_DIR, files[files.length - 1]);
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { file, merged: data.merged || [] };
  } catch (e) {
    console.error(`Cannot read verdicts at ${file}: ${e.message}`);
    return null;
  }
}

function bumpLastUpdated(content) {
  const today = new Date().toISOString().slice(0, 10);
  if (/^last-updated:\s*.*$/m.test(content)) {
    return content.replace(/^last-updated:\s*.*$/m, `last-updated: ${today}`);
  }
  return content; // no field - leave it; not all skills carry one
}

function main() {
  const loaded = loadVerdicts();
  if (!loaded) {
    console.error('No judge verdicts found. Run: node scripts/noop-judge.js');
    process.exit(1);
  }

  let actionable = loaded.merged.filter(m => m.verdict && (m.verdict.verdict === 'trim' || m.verdict.verdict === 'delete'));
  if (skillFilter) actionable = actionable.filter(m => m.skill === skillFilter || m.skill.includes(skillFilter));

  if (actionable.length === 0) {
    console.log('\nNo actionable (trim/delete) verdicts to apply.\n');
    process.exit(0);
  }

  console.log(`\nNo-op Apply ${DRY_RUN ? '(dry-run)' : ''}\n` + '='.repeat(44));
  console.log(`Source: ${path.relative(PLUGIN_ROOT, loaded.file)}\n`);

  // Group by skill file.
  const bySkill = {};
  for (const m of actionable) { (bySkill[m.skill] = bySkill[m.skill] || []).push(m); }

  let editedFiles = 0;
  for (const [skill, items] of Object.entries(bySkill)) {
    const file = path.join(SKILLS_DIR, skill, 'SKILL.md');
    if (!fs.existsSync(file)) { console.log(`  SKIP ${skill}: SKILL.md not found`); continue; }
    let content = fs.readFileSync(file, 'utf8');
    const eol = content.includes('\r\n') ? '\r\n' : '\n'; // preserve original line endings
    let lines = content.split(/\r?\n/);

    // Apply bottom-up so line numbers stay valid across deletes.
    const sorted = [...items].sort((a, b) => b.lineNo - a.lineNo);
    let changed = false;
    for (const m of sorted) {
      const idx = m.lineNo - 1;
      if (idx < 0 || idx >= lines.length) { console.log(`  SKIP ${skill} L${m.lineNo}: out of range`); continue; }
      const before = lines[idx];
      if (m.verdict.verdict === 'delete') {
        console.log(`  ${skill} L${m.lineNo}  DELETE`);
        console.log(`    - ${before}`);
        lines.splice(idx, 1);
        changed = true;
      } else if (m.verdict.verdict === 'trim' && m.verdict.trimmed_line) {
        const lead = (before.match(/^(\s*)/) || ['', ''])[1];
        const after = lead + m.verdict.trimmed_line.replace(/^\s+/, '');
        console.log(`  ${skill} L${m.lineNo}  TRIM`);
        console.log(`    - ${before}`);
        console.log(`    + ${after}`);
        lines[idx] = after;
        changed = true;
      }
    }

    if (changed && !DRY_RUN) {
      content = bumpLastUpdated(lines.join(eol));
      fs.writeFileSync(file, content);
      editedFiles++;
      console.log(`    written (last-updated bumped)`);
    }
    console.log('');
  }

  if (DRY_RUN) {
    console.log('Dry-run only. Re-run without --dry-run to apply.\n');
  } else {
    console.log(`Applied. ${editedFiles} file(s) edited.`);
    console.log('Now verify no regression:');
    console.log('  node scripts/test-noop-detect.js     (calibration still green)');
    console.log('  node scripts/noop-scan.js            (candidate should be gone)');
    console.log('  node scripts/skill-lint.js           (structure intact)\n');
  }
  process.exit(0);
}

main();

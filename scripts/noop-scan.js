#!/usr/bin/env node

/**
 * noop-scan.js - Tier 1 no-op scanner for all SKILL.md files.
 *
 * Runs the static detector (core/skills/noop-detect.js) across every skill and
 * reports candidate no-op lines: instructions that look like disposition/effort
 * filler with no checkable criterion ("be thorough", "make it high-quality").
 *
 * This is ADVISORY by default - candidates are suspects for a human or the
 * Tier 2 judge (scripts/noop-judge.js) to adjudicate, not confirmed no-ops.
 * It exits 0 even when candidates are found, so it never blocks CI on a
 * heuristic. Use --strict to make any candidate a non-zero exit (for a
 * pre-release gate once you trust the signal).
 *
 * Usage:
 *   node scripts/noop-scan.js                 # scan all skills, advisory
 *   node scripts/noop-scan.js do              # scan one skill by name
 *   node scripts/noop-scan.js --json          # machine-readable (feeds the judge)
 *   node scripts/noop-scan.js --strict        # exit 1 if any candidate found
 *
 * Exit codes:
 *   0 = scan completed (candidates may exist; advisory mode)
 *   1 = --strict and at least one candidate found, or a read error
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { detectNoOps } = require('../core/skills/noop-detect');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR  = path.join(PLUGIN_ROOT, 'skills');

const args      = process.argv.slice(2);
const JSON_MODE  = args.includes('--json');
const STRICT     = args.includes('--strict');
const FILTER     = args.find(a => !a.startsWith('--'));

function discoverSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs.readdirSync(SKILLS_DIR)
    .filter(name => {
      const f = path.join(SKILLS_DIR, name, 'SKILL.md');
      return fs.existsSync(f) && fs.statSync(f).isFile();
    })
    .sort();
}

function main() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`skills/ not found at ${SKILLS_DIR}`);
    process.exit(1);
  }

  let skills = discoverSkills();
  if (FILTER) {
    skills = skills.filter(n => n === FILTER || n.includes(FILTER));
    if (skills.length === 0) {
      console.error(`No skill matching "${FILTER}". Available: ${discoverSkills().join(', ')}`);
      process.exit(1);
    }
  }

  const report = [];
  let totalCandidates = 0;

  for (const skill of skills) {
    const file = path.join(SKILLS_DIR, skill, 'SKILL.md');
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (e) {
      report.push({ skill, error: e.message, candidates: [] });
      continue;
    }
    const candidates = detectNoOps(content);
    totalCandidates += candidates.length;
    report.push({ skill, candidates });
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({ totalCandidates, skills: report }, null, 2));
    process.exit(STRICT && totalCandidates > 0 ? 1 : 0);
  }

  console.log('\nCitadel No-op Scan (Tier 1, advisory)\n' + '='.repeat(44));
  const withCandidates = report.filter(r => r.candidates.length > 0);

  if (withCandidates.length === 0) {
    console.log(`\nScanned ${skills.length} skill(s). No no-op candidates found.`);
    console.log('The skills are clean of disposition/effort filler by the Tier 1 heuristic.\n');
    process.exit(0);
  }

  for (const r of withCandidates) {
    console.log(`\n  ${r.skill}  (${r.candidates.length} candidate${r.candidates.length > 1 ? 's' : ''})`);
    // Highest suspicion first.
    const sorted = [...r.candidates].sort((a, b) => b.suspicion - a.suspicion);
    for (const c of sorted) {
      console.log(`    L${c.lineNo}  ${c.text.slice(0, 90)}`);
      console.log(`          hits: ${c.noopHits.join(', ')}`);
    }
  }

  console.log('\n' + '='.repeat(44));
  console.log(`Scanned ${skills.length} skill(s) - ${totalCandidates} candidate(s) in ${withCandidates.length} skill(s).`);
  console.log('Candidates are SUSPECTS, not confirmed no-ops. Adjudicate with:');
  console.log('  node scripts/noop-judge.js            (Tier 2: LLM judge - trim vs delete vs keep)');
  console.log('  node scripts/noop-ablate.js --skill X (Tier 3: ablation - the empirical Pocock test)\n');

  process.exit(STRICT && totalCandidates > 0 ? 1 : 0);
}

main();

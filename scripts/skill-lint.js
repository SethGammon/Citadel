#!/usr/bin/env node

/**
 * skill-lint.js — Static structure checker for all SKILL.md files
 *
 * Validates that every installed skill has the required sections, handling,
 * and metadata to be safe and complete. Catches structural gaps before they
 * become runtime surprises for users.
 *
 * Checks per skill:
 *   FAIL — missing required section (skill will behave incorrectly or confuse users)
 *   WARN — missing recommended section (skill may fail on edge inputs)
 *   INFO — style improvement (no impact on correctness)
 *
 * Exit codes:
 *   0 = all skills pass (WARNs are OK)
 *   1 = one or more skills have FAIL-level issues
 *
 * Usage:
 *   node scripts/skill-lint.js               # check all skills
 *   node scripts/skill-lint.js dashboard     # check one skill by name
 *   node scripts/skill-lint.js --json        # machine-readable JSON output
 *   node scripts/skill-lint.js --warn-as-fail  # treat WARNs as FAILs (strict CI mode)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { validateOptionalMetadata } = require('../core/skills/catalog');

const PLUGIN_ROOT  = path.resolve(__dirname, '..');
const SKILLS_DIR   = path.join(PLUGIN_ROOT, 'skills');

// Max SKILL.md body lines before a WARN. Policy: docs/SKILL_LIFECYCLE.md#line-budget
const LINE_BUDGET  = 300;

// ── CLI args ─────────────────────────────────────────────────────────────────

const args         = process.argv.slice(2);
const JSON_MODE    = args.includes('--json');
const STRICT_MODE  = args.includes('--warn-as-fail');
const SKILL_FILTER = args.find(a => !a.startsWith('--'));

// ── Check definitions ─────────────────────────────────────────────────────────

/**
 * Each check: { id, level, description, check(frontmatter, body, skillName), fix }
 * check() returns true (pass), false (fail), or a string (fail with detail).
 * Returning null means "not applicable — skip this check".
 */
const CHECKS = [
  // ── Frontmatter checks (FAIL) ─────────────────────────────────────────────

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
    id: 'optional-packaging-metadata',
    level: 'WARN',
    description: 'optional packaging metadata is valid when present',
    check: (fm) => {
      if (!fm) return null;
      const keys = ['task-class', 'risk-level', 'expected-artifacts', 'verification-commands', 'benchmark-status', 'neighbor-skills'];
      if (!keys.some((key) => key in fm)) return null;
      const issues = validateOptionalMetadata(fm);
      return issues.length === 0 ? true : issues.join('; ');
    },
    fix: 'Use valid optional metadata: task-class, risk-level, expected-artifacts, verification-commands, benchmark-status, neighbor-skills',
  },

  // ── Required sections (FAIL) ──────────────────────────────────────────────

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

  // ── Coverage signals (WARN) ───────────────────────────────────────────────

  {
    id: 'has-fringe-handling',
    level: 'WARN',
    description: 'has fringe / edge case handling',
    check: (fm, body) => /fringe|edge case|if.*not.*exist|if.*missing|doesn.t exist|not found|no \.planning/i.test(body),
    fix: 'Add a "## Fringe Cases" section or inline guards for missing state, wrong input, and unavailable tools',
  },
  {
    id: 'planning-dir-guard',
    level: 'WARN',
    description: 'guards .planning/ access when used',
    check: (fm, body) => {
      // Only check if the skill actually references .planning/
      if (!body.includes('.planning/')) return null; // not applicable
      return /if.*\.planning.*not|no \.planning|\.planning.*doesn|\.planning.*exist|\.planning.*miss|not.*exist.*skip|if.*dir.*not|doesn.t exist.*empty/i.test(body);
    },
    fix: 'Add handling for when .planning/ does not exist (e.g., "treat as empty, show setup hint")',
  },
  {
    id: 'gh-cli-guard',
    level: 'WARN',
    description: 'guards gh CLI usage when used',
    check: (fm, body) => {
      if (!/\bgh\b (pr|issue|api|run|repo|auth|browse)\b|`gh /.test(body)) return null; // not applicable
      return /gh.*not.*available|gh.*not.*found|gh.*install|if.*gh.*not|gh.*fail|gh.*unavailable/i.test(body);
    },
    fix: 'Add handling for when the gh CLI is not installed or not authenticated',
  },
  {
    id: 'description-length',
    level: 'WARN',
    description: 'frontmatter description is substantive (>30 chars)',
    check: (fm) => !fm || !fm.description || fm.description.length > 30,
    fix: 'Expand the description to better describe what the skill does and when to use it',
  },
  {
    id: 'name-matches-dir',
    level: 'WARN',
    description: 'frontmatter name matches directory name',
    check: (fm, body, skillName) => !fm || !fm.name || fm.name === skillName,
    fix: `Update the frontmatter 'name:' field to match the skill's directory name`,
  },
  {
    id: 'has-when-to-use',
    level: 'WARN',
    description: 'describes when to use (or not to use) the skill',
    check: (fm, body) => /when to (use|route|invoke)|use.*when|do not use|don.t use|orientation|if the (user|task|input)/i.test(body),
    fix: 'Add a section explaining when to use this skill vs. alternatives',
  },
  {
    id: 'line-budget',
    level: 'WARN',
    description: `SKILL.md body within ${LINE_BUDGET}-line budget`,
    check: (fm, body, skillName) => {
      const lineCount = body.split(/\r?\n/).length;
      if (lineCount <= LINE_BUDGET) return true;
      return `skills/${skillName}/SKILL.md body is ${lineCount} lines (budget: ${LINE_BUDGET}); see docs/SKILL_LIFECYCLE.md#line-budget`;
    },
    fix: 'Trim the skill: protocol and gates stay in SKILL.md; move rationale and reference material to a docs companion (docs/SKILL_LIFECYCLE.md#line-budget)',
  },
];

// ── Frontmatter parser ────────────────────────────────────────────────────────

/**
 * Extract key-value pairs from a YAML-like frontmatter block.
 * Handles: string values, booleans, multiline (>-), and simple lists.
 *
 * @param {string} content - Full SKILL.md content
 * @returns {{ frontmatter: object|null, body: string }}
 */
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

// ── Skill discovery ───────────────────────────────────────────────────────────

function discoverSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  return fs.readdirSync(SKILLS_DIR)
    .filter(name => {
      const skillFile = path.join(SKILLS_DIR, name, 'SKILL.md');
      return fs.existsSync(skillFile) && fs.statSync(skillFile).isFile();
    })
    .sort();
}

// ── Lint one skill ────────────────────────────────────────────────────────────

function lintSkill(skillName) {
  const filePath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  const content  = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(content);

  const results = [];

  for (const checkDef of CHECKS) {
    let outcome;
    try {
      outcome = checkDef.check(frontmatter, body, skillName);
    } catch (err) {
      outcome = `check threw: ${err.message}`;
    }

    if (outcome === null) continue; // not applicable — skip

    const passed = outcome === true || outcome === undefined;
    const detail = typeof outcome === 'string' ? outcome : null;

    results.push({
      id:          checkDef.id,
      level:       checkDef.level,
      description: checkDef.description,
      passed,
      detail,
      fix:         passed ? null : checkDef.fix,
    });
  }

  const failCount  = results.filter(r => !r.passed && r.level === 'FAIL').length;
  const warnCount  = results.filter(r => !r.passed && r.level === 'WARN').length;
  const passCount  = results.filter(r => r.passed).length;
  const skipCount  = CHECKS.length - results.length;

  return { skillName, filePath, results, failCount, warnCount, passCount, skipCount };
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function pad(str, len) {
  return String(str).padEnd(len, ' ');
}

function printResults(skillResults) {
  const maxNameLen = Math.max(...skillResults.map(r => r.skillName.length), 10);

  console.log('\nCitadel Skill Lint\n' + '='.repeat(40));

  let totalFail = 0;
  let totalWarn = 0;
  let totalPass = 0;

  for (const sr of skillResults) {
    const hasIssues = sr.failCount > 0 || sr.warnCount > 0;
    const tag = sr.failCount > 0 ? 'FAIL' : sr.warnCount > 0 ? 'WARN' : 'PASS';
    const detail = sr.failCount > 0
      ? `(${sr.failCount} fail, ${sr.warnCount} warn)`
      : sr.warnCount > 0
        ? `(${sr.warnCount} warn)`
        : `(${sr.passCount} checks)`;

    console.log(`  ${pad(tag, 5)} ${pad(sr.skillName, maxNameLen)}  ${detail}`);

    if (hasIssues) {
      for (const r of sr.results) {
        if (r.passed) continue;
        const prefix = `    [${r.level}]`;
        const desc   = r.detail ? `${r.description} — ${r.detail}` : r.description;
        console.log(`${prefix} ${desc}`);
        if (r.fix) console.log(`           Fix: ${r.fix}`);
      }
    }

    totalFail += sr.failCount;
    totalWarn += sr.warnCount;
    totalPass += sr.passCount;
  }

  console.log('\n' + '='.repeat(40));
  const skillCount  = skillResults.length;
  const failSkills  = skillResults.filter(r => r.failCount > 0).length;
  const warnSkills  = skillResults.filter(r => r.warnCount > 0 && r.failCount === 0).length;
  const cleanSkills = skillResults.filter(r => r.failCount === 0 && r.warnCount === 0).length;

  console.log(`Skills: ${skillCount} total  |  ${cleanSkills} clean, ${warnSkills} warn, ${failSkills} fail`);
  console.log(`Checks: ${totalPass} passed, ${totalWarn} warned, ${totalFail} failed`);

  const overBudget = skillResults.filter(
    sr => sr.results.some(r => r.id === 'line-budget' && !r.passed)
  ).length;
  console.log(`Line budget: ${overBudget} skill(s) exceed ${LINE_BUDGET} lines (see docs/SKILL_LIFECYCLE.md#line-budget)\n`);

  if (totalFail > 0) {
    console.log('Fix all FAIL items before shipping. WARNs are advisory.\n');
  } else if (totalWarn > 0) {
    console.log('All skills structurally valid. WARNs are advisory — address before declaring skills production-ready.\n');
  } else {
    console.log('All skills pass lint.\n');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`Error: skills/ directory not found at ${SKILLS_DIR}`);
    console.error('Is this script running from inside a Citadel installation?');
    process.exit(1);
  }

  let skillNames = discoverSkills();

  if (skillNames.length === 0) {
    console.log('No skills found in skills/. Nothing to lint.');
    process.exit(0);
  }

  // Filter to a single skill if requested
  if (SKILL_FILTER) {
    skillNames = skillNames.filter(n => n === SKILL_FILTER || n.includes(SKILL_FILTER));
    if (skillNames.length === 0) {
      console.error(`No skill found matching "${SKILL_FILTER}". Available: ${discoverSkills().join(', ')}`);
      process.exit(1);
    }
  }

  const skillResults = skillNames.map(lintSkill);

  if (JSON_MODE) {
    console.log(JSON.stringify(skillResults, null, 2));
  } else {
    printResults(skillResults);
  }

  const anyFail = skillResults.some(r => r.failCount > 0);
  const anyWarn = skillResults.some(r => r.warnCount > 0);

  if (STRICT_MODE) {
    process.exit(anyFail || anyWarn ? 1 : 0);
  } else {
    process.exit(anyFail ? 1 : 0);
  }
}

main();

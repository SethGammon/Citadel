#!/usr/bin/env node
'use strict';

/**
 * generate-routing.js: single source of truth for /do routing keywords.
 *
 * Reads trigger_keywords frontmatter from every skills/STAR/SKILL.md and
 * regenerates three surfaces:
 *   1. core/skills/routing-table.json          (canonical machine-readable table)
 *   2. skills/do/SKILL.md                       (Tier 2 markdown table, between markers)
 *   3. docs/index.html                          (demo TIER2 routing data, between markers)
 *
 * Usage:
 *   node scripts/generate-routing.js            # regenerate all surfaces in place
 *   node scripts/generate-routing.js --check    # exit 1 with a diff summary if any surface is stale
 */

const fs = require('fs');
const path = require('path');

const { buildSkillCatalog } = require('../core/skills/catalog');

// The router cannot route to itself.
const EXCLUDED_SKILLS = ['do'];

// Route labels that differ from a plain /{name} invocation.
const ROUTE_LABELS = { fleet: '/fleet --quick' };

// The demo page renders these via its hard-coded Tier 3 intent classifier,
// so they are kept out of the generated Tier 2 keyword data there.
const DEMO_TIER3_SKILLS = ['archon', 'create-app', 'fleet', 'marshal'];

const DEMO_ICONS = {
  architect: '🏗',
  'doc-gen': '📄',
  experiment: '⚗',
  postmortem: '📊',
  prd: '📋',
  refactor: '↻',
  research: '⌕',
  review: '◆',
  scaffold: '⬡',
  'systematic-debugging': '⚡',
  'test-gen': '⚗',
  triage: '📌',
  wiki: '▤',
};
const DEMO_DEFAULT_ICON = '◇';

const GENERATED_NOTE =
  'Derived from trigger_keywords frontmatter in skills/*/SKILL.md. Do not edit by hand; run node scripts/generate-routing.js.';

const MARKERS = {
  skillTable: {
    begin: '<!-- BEGIN GENERATED: routing-table -->',
    end: '<!-- END GENERATED: routing-table -->',
  },
  demoData: {
    begin: '// <!-- BEGIN GENERATED: routing-data -->',
    end: '// <!-- END GENERATED: routing-data -->',
  },
};

function buildRoutingTable(projectRoot) {
  const catalog = buildSkillCatalog(projectRoot);
  const missing = [];
  const skills = [];

  for (const skill of catalog.skills) {
    if (EXCLUDED_SKILLS.includes(skill.name)) continue;
    if (!Array.isArray(skill.triggerKeywords) || skill.triggerKeywords.length === 0) {
      missing.push(skill.name);
      continue;
    }
    skills.push({
      name: skill.name,
      keywords: skill.triggerKeywords,
      description: skill.description,
    });
  }

  if (missing.length > 0) {
    throw new Error(`skills missing trigger_keywords frontmatter: ${missing.join(', ')}`);
  }

  // Code-point comparison keeps the sort identical across machines and locales.
  skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { schemaVersion: 1, generated: GENERATED_NOTE, skills };
}

function routeFor(name) {
  return ROUTE_LABELS[name] || `/${name}`;
}

function renderJson(table, eol = '\n') {
  return JSON.stringify(table, null, 2).split('\n').join(eol) + eol;
}

function renderSkillTable(table) {
  const lines = ['| Input Contains | Route To |', '|---|---|'];
  for (const skill of table.skills) {
    const keywords = skill.keywords.map((keyword) => `"${keyword}"`).join(', ');
    lines.push(`| ${keywords} | \`${routeFor(skill.name)}\` |`);
  }
  return lines;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function renderDemoData(table) {
  const lines = ['const TIER2 = ['];
  for (const skill of table.skills) {
    if (DEMO_TIER3_SKILLS.includes(skill.name)) continue;
    const pattern = `/\\b(${skill.keywords.map(escapeRegExp).join('|')})\\b/i`;
    const icon = DEMO_ICONS[skill.name] || DEMO_DEFAULT_ICON;
    lines.push(`  { re: ${pattern}, skill: '/${skill.name}',`);
    lines.push(`    desc: ${JSON.stringify(skill.description)}, icon: '${icon}' },`);
  }
  lines.push('];');
  return lines;
}

function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function detectIndent(content, beginMarker) {
  const index = content.indexOf(beginMarker);
  if (index === -1) return '';
  const lineStart = content.lastIndexOf('\n', index) + 1;
  return content.slice(lineStart, index);
}

function replaceBlock(content, markers, bodyLines, label) {
  const beginIndex = content.indexOf(markers.begin);
  const endIndex = content.indexOf(markers.end);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error(`markers not found in ${label}: ${markers.begin} ... ${markers.end}`);
  }
  const eol = detectEol(content);
  const indent = detectIndent(content, markers.begin);
  const blockStart = beginIndex + markers.begin.length;
  const body = bodyLines.map((line) => (line ? indent + line : line)).join(eol);
  return content.slice(0, blockStart) + eol + body + eol + indent + content.slice(endIndex);
}

function surfacePaths(projectRoot) {
  return {
    json: path.join(projectRoot, 'core', 'skills', 'routing-table.json'),
    skillTable: path.join(projectRoot, 'skills', 'do', 'SKILL.md'),
    demoData: path.join(projectRoot, 'docs', 'index.html'),
  };
}

function expectedSurfaces(projectRoot) {
  const table = buildRoutingTable(projectRoot);
  const paths = surfacePaths(projectRoot);
  const skillContent = fs.readFileSync(paths.skillTable, 'utf8');
  const demoContent = fs.readFileSync(paths.demoData, 'utf8');
  const jsonContent = fs.existsSync(paths.json) ? fs.readFileSync(paths.json, 'utf8') : null;

  return {
    table,
    surfaces: [
      {
        name: 'routing-table.json',
        filePath: paths.json,
        actual: jsonContent,
        // Match the EOL already on disk so checkouts materialized with CRLF
        // (core.autocrlf) compare clean, the same way replaceBlock does.
        expected: renderJson(table, jsonContent === null ? '\n' : detectEol(jsonContent)),
      },
      {
        name: 'skills/do/SKILL.md',
        filePath: paths.skillTable,
        actual: skillContent,
        expected: replaceBlock(skillContent, MARKERS.skillTable, renderSkillTable(table), 'skills/do/SKILL.md'),
      },
      {
        name: 'docs/index.html',
        filePath: paths.demoData,
        actual: demoContent,
        expected: replaceBlock(demoContent, MARKERS.demoData, renderDemoData(table), 'docs/index.html'),
      },
    ],
  };
}

// Pure comparison: returns null when in sync, otherwise a drift descriptor.
function diffTexts(name, expected, actual) {
  if (expected === actual) return null;
  if (actual === null || actual === undefined) {
    return { name, reason: 'file missing' };
  }
  const expectedLines = expected.split(/\r?\n/);
  const actualLines = actual.split(/\r?\n/);
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < max; index++) {
    if (expectedLines[index] !== actualLines[index]) {
      return {
        name,
        reason: `first difference at line ${index + 1}`,
        expectedLine: expectedLines[index],
        actualLine: actualLines[index],
      };
    }
  }
  return { name, reason: 'line-ending difference' };
}

function checkProject(projectRoot) {
  const { surfaces } = expectedSurfaces(projectRoot);
  return surfaces
    .map((surface) => diffTexts(surface.name, surface.expected, surface.actual))
    .filter(Boolean);
}

function generate(projectRoot) {
  const { table, surfaces } = expectedSurfaces(projectRoot);
  const results = [];
  for (const surface of surfaces) {
    if (surface.actual === surface.expected) {
      results.push({ name: surface.name, changed: false });
      continue;
    }
    fs.writeFileSync(surface.filePath, surface.expected);
    results.push({ name: surface.name, changed: true });
  }
  return { table, results };
}

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');
  const projectRoot = path.resolve(__dirname, '..');

  if (checkMode) {
    const drift = checkProject(projectRoot);
    if (drift.length === 0) {
      console.log('routing surfaces in sync (routing-table.json, skills/do/SKILL.md, docs/index.html)');
      return;
    }
    console.error('routing surfaces out of sync:');
    for (const item of drift) {
      console.error(`  ${item.name}: ${item.reason}`);
      if (item.expectedLine !== undefined) {
        console.error(`    expected: ${String(item.expectedLine).slice(0, 120)}`);
        console.error(`    actual:   ${String(item.actualLine).slice(0, 120)}`);
      }
    }
    console.error('Run: node scripts/generate-routing.js');
    process.exit(1);
  }

  const { table, results } = generate(projectRoot);
  for (const result of results) {
    console.log(`${result.changed ? 'updated  ' : 'unchanged'} ${result.name}`);
  }
  console.log(`${table.skills.length} skills in routing table`);
}

if (require.main === module) main();

module.exports = {
  DEMO_TIER3_SKILLS,
  EXCLUDED_SKILLS,
  MARKERS,
  ROUTE_LABELS,
  buildRoutingTable,
  checkProject,
  diffTexts,
  renderDemoData,
  renderJson,
  renderSkillTable,
  replaceBlock,
};

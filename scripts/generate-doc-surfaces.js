#!/usr/bin/env node
'use strict';

/**
 * generate-doc-surfaces.js: single source of truth for doc-facing counts.
 *
 * Computes three numbers from the repo itself:
 *   skillCount       directories under skills/ that contain SKILL.md
 *   hookScriptCount  hooks_src/*.js minus the smoke test and the shared util
 *   hookEventCount   distinct top-level event keys in hooks/hooks-template.json
 *
 * Then rewrites small inline generated regions in three docs, between
 * HTML comment markers that can sit inside a sentence:
 *
 *   <!-- GENERATED: skill-count -->46<!-- /GENERATED -->
 *
 * Surfaces:
 *   README.md             skill-count
 *   docs/SKILLS.md        skill-count
 *   docs/ARCHITECTURE.md  hook-script-count, hook-event-count
 *   INSTALL.md            skill-count
 *
 * Usage:
 *   node scripts/generate-doc-surfaces.js            # regenerate in place
 *   node scripts/generate-doc-surfaces.js --check    # exit 1 with a summary if any surface is stale
 */

const fs = require('fs');
const path = require('path');

// hooks_src files that are not lifecycle hook scripts.
const NON_HOOK_FILES = ['smoke-test.js', 'harness-health-util.js'];

const MARKER_PATTERN = /<!-- GENERATED: ([a-z-]+) -->([\s\S]*?)<!-- \/GENERATED -->/g;

function computeCounts(projectRoot) {
  const skillsDir = path.join(projectRoot, 'skills');
  const skillCount = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))).length;

  const hooksSrcDir = path.join(projectRoot, 'hooks_src');
  const hookScriptCount = fs
    .readdirSync(hooksSrcDir)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => !NON_HOOK_FILES.includes(name)).length;

  const templatePath = path.join(projectRoot, 'hooks', 'hooks-template.json');
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const events = template.hooks && typeof template.hooks === 'object' ? template.hooks : template;
  const hookEventCount = Object.keys(events).length;

  return {
    'skill-count': skillCount,
    'hook-script-count': hookScriptCount,
    'hook-event-count': hookEventCount,
  };
}

// Each surface declares which marker names it must contain so a deleted
// marker is caught instead of silently passing.
function surfaceSpecs(projectRoot) {
  return [
    {
      name: 'README.md',
      filePath: path.join(projectRoot, 'README.md'),
      required: ['skill-count'],
    },
    {
      name: 'docs/SKILLS.md',
      filePath: path.join(projectRoot, 'docs', 'SKILLS.md'),
      required: ['skill-count'],
    },
    {
      name: 'docs/ARCHITECTURE.md',
      filePath: path.join(projectRoot, 'docs', 'ARCHITECTURE.md'),
      required: ['hook-script-count', 'hook-event-count'],
    },
    {
      name: 'INSTALL.md',
      filePath: path.join(projectRoot, 'INSTALL.md'),
      required: ['skill-count'],
    },
  ];
}

// Inline replacement preserves the file's own line endings because markers
// never span the value across lines; only the digits between markers change.
function renderSurface(content, counts, label, required) {
  const seen = new Set();
  const rendered = content.replace(MARKER_PATTERN, (match, key) => {
    if (!(key in counts)) {
      throw new Error(`unknown generated marker "${key}" in ${label}`);
    }
    seen.add(key);
    return `<!-- GENERATED: ${key} -->${counts[key]}<!-- /GENERATED -->`;
  });
  for (const key of required) {
    if (!seen.has(key)) {
      throw new Error(`required marker "${key}" not found in ${label}`);
    }
  }
  return rendered;
}

function expectedSurfaces(projectRoot) {
  const counts = computeCounts(projectRoot);
  const surfaces = surfaceSpecs(projectRoot).map((spec) => {
    const actual = fs.readFileSync(spec.filePath, 'utf8');
    return {
      name: spec.name,
      filePath: spec.filePath,
      actual,
      expected: renderSurface(actual, counts, spec.name, spec.required),
    };
  });
  return { counts, surfaces };
}

// Pure comparison: returns null when in sync, otherwise a drift descriptor.
function diffTexts(name, expected, actual) {
  if (expected === actual) return null;
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
  const { counts, surfaces } = expectedSurfaces(projectRoot);
  const results = [];
  for (const surface of surfaces) {
    if (surface.actual === surface.expected) {
      results.push({ name: surface.name, changed: false });
      continue;
    }
    fs.writeFileSync(surface.filePath, surface.expected);
    results.push({ name: surface.name, changed: true });
  }
  return { counts, results };
}

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');
  const projectRoot = path.resolve(__dirname, '..');

  if (checkMode) {
    const drift = checkProject(projectRoot);
    if (drift.length === 0) {
      console.log('doc surfaces in sync (README.md, docs/SKILLS.md, docs/ARCHITECTURE.md, INSTALL.md)');
      return;
    }
    console.error('doc surfaces out of sync:');
    for (const item of drift) {
      console.error(`  ${item.name}: ${item.reason}`);
      if (item.expectedLine !== undefined) {
        console.error(`    expected: ${String(item.expectedLine).slice(0, 120)}`);
        console.error(`    actual:   ${String(item.actualLine).slice(0, 120)}`);
      }
    }
    console.error('Run: node scripts/generate-doc-surfaces.js');
    process.exit(1);
  }

  const { counts, results } = generate(projectRoot);
  for (const result of results) {
    console.log(`${result.changed ? 'updated  ' : 'unchanged'} ${result.name}`);
  }
  console.log(
    `counts: ${counts['skill-count']} skills, ${counts['hook-script-count']} hook scripts, ${counts['hook-event-count']} hook events`
  );
}

if (require.main === module) main();

module.exports = {
  MARKER_PATTERN,
  NON_HOOK_FILES,
  checkProject,
  computeCounts,
  diffTexts,
  renderSurface,
  surfaceSpecs,
};

#!/usr/bin/env node
'use strict';

/**
 * test-doc-surfaces.js: verifies generate-doc-surfaces.js and its surfaces.
 *
 * Checks, against the current tree:
 *   1. --check exits 0 (surfaces are in sync)
 *   2. generator counts match independent recounts done here
 *   3. marker values embedded in the docs match those recounts
 *   4. marker pairs are balanced in all three docs
 *   5. running the generator changes nothing (idempotence, byte-compared)
 *
 * Usage: node scripts/test-doc-surfaces.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const generatorPath = path.join(__dirname, 'generate-doc-surfaces.js');
const { computeCounts } = require('./generate-doc-surfaces');

const DOC_PATHS = [
  path.join(projectRoot, 'README.md'),
  path.join(projectRoot, 'docs', 'SKILLS.md'),
  path.join(projectRoot, 'docs', 'ARCHITECTURE.md'),
];

let failures = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

// Independent recounts: deliberately not calling generator internals.
function recountSkills() {
  const skillsDir = path.join(projectRoot, 'skills');
  let count = 0;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))) count += 1;
  }
  return count;
}

function recountHookScripts() {
  const excluded = new Set(['smoke-test.js', 'harness-health-util.js']);
  let count = 0;
  for (const name of fs.readdirSync(path.join(projectRoot, 'hooks_src'))) {
    if (name.endsWith('.js') && !excluded.has(name)) count += 1;
  }
  return count;
}

function recountHookEvents() {
  const raw = fs.readFileSync(path.join(projectRoot, 'hooks', 'hooks-template.json'), 'utf8');
  const parsed = JSON.parse(raw);
  const events = parsed.hooks && typeof parsed.hooks === 'object' ? parsed.hooks : parsed;
  return Object.keys(events).length;
}

function markerValues(content) {
  const values = {};
  const pattern = /<!-- GENERATED: ([a-z-]+) -->([\s\S]*?)<!-- \/GENERATED -->/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    if (!(match[1] in values)) values[match[1]] = [];
    values[match[1]].push(match[2]);
  }
  return values;
}

function countOccurrences(content, needle) {
  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}

function main() {
  // 1. --check exits 0 on the current tree.
  const checkRun = spawnSync(process.execPath, [generatorPath, '--check'], { encoding: 'utf8' });
  check(
    '--check exits 0 on current tree',
    checkRun.status === 0,
    `exit ${checkRun.status}; stderr: ${(checkRun.stderr || '').trim()}`
  );

  // 2. Generator counts match independent recounts.
  const counts = computeCounts(projectRoot);
  const expected = {
    'skill-count': recountSkills(),
    'hook-script-count': recountHookScripts(),
    'hook-event-count': recountHookEvents(),
  };
  for (const key of Object.keys(expected)) {
    check(
      `computeCounts ${key} matches independent recount`,
      counts[key] === expected[key],
      `generator says ${counts[key]}, recount says ${expected[key]}`
    );
  }

  // 3 + 4. Marker values in docs match recounts; marker pairs balanced.
  for (const docPath of DOC_PATHS) {
    const rel = path.relative(projectRoot, docPath).split(path.sep).join('/');
    const content = fs.readFileSync(docPath, 'utf8');

    const opens = countOccurrences(content, '<!-- GENERATED:');
    const closes = countOccurrences(content, '<!-- /GENERATED -->');
    check(`${rel} marker pairs balanced`, opens === closes && opens > 0, `${opens} open vs ${closes} close`);

    const values = markerValues(content);
    const matchedRegions = Object.values(values).reduce((sum, list) => sum + list.length, 0);
    check(`${rel} every open marker has a parsed region`, matchedRegions === opens, `${matchedRegions} regions vs ${opens} opens`);

    for (const [key, list] of Object.entries(values)) {
      const allMatch = key in expected && list.every((value) => value === String(expected[key]));
      check(`${rel} marker ${key} equals recount`, allMatch, `values [${list.join(', ')}], expected ${expected[key]}`);
    }
  }

  // 5. Idempotence: generator run changes no bytes on disk.
  const before = DOC_PATHS.map((docPath) => fs.readFileSync(docPath, 'utf8'));
  const genRun = spawnSync(process.execPath, [generatorPath], { encoding: 'utf8' });
  check('generator run exits 0', genRun.status === 0, `exit ${genRun.status}; stderr: ${(genRun.stderr || '').trim()}`);
  const after = DOC_PATHS.map((docPath) => fs.readFileSync(docPath, 'utf8'));
  DOC_PATHS.forEach((docPath, index) => {
    const rel = path.relative(projectRoot, docPath).split(path.sep).join('/');
    check(`${rel} unchanged by regeneration`, before[index] === after[index]);
  });

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall doc-surface tests passed');
}

main();

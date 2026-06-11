#!/usr/bin/env node
'use strict';

/**
 * test-routing-sync.js: guards the generated /do routing surfaces.
 *
 * Asserts:
 *   (a) generate-routing --check exits 0 on the committed tree
 *   (b) every skill in routing-table.json maps to an existing skills/<name>/ directory
 *   (c) every user-invocable skill appears in the table (minus documented exclusions)
 *   (d) keywords are non-empty arrays of non-empty strings
 *   (e) the checker's pure comparison detects a tampered in-memory copy
 *
 * Run: node scripts/test-routing-sync.js
 */

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { buildSkillCatalog } = require('../core/skills/catalog');
const {
  EXCLUDED_SKILLS,
  buildRoutingTable,
  diffTexts,
  renderJson,
} = require('./generate-routing');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TABLE_PATH = path.join(PROJECT_ROOT, 'core', 'skills', 'routing-table.json');

// (a) the committed tree is in sync
{
  const result = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, 'generate-routing.js'),
    '--check',
  ], { encoding: 'utf8' });
  assert.equal(
    result.status,
    0,
    `generate-routing --check failed:\n${result.stdout}${result.stderr}`
  );
}

const table = JSON.parse(fs.readFileSync(TABLE_PATH, 'utf8'));
assert.equal(table.schemaVersion, 1, 'routing-table.json schemaVersion must be 1');
assert(Array.isArray(table.skills) && table.skills.length > 0, 'routing-table.json must list skills');

// (b) every table entry maps to an existing skill directory
for (const skill of table.skills) {
  const skillFile = path.join(PROJECT_ROOT, 'skills', skill.name, 'SKILL.md');
  assert(fs.existsSync(skillFile), `routing-table.json lists "${skill.name}" but ${skillFile} does not exist`);
}

// (c) every user-invocable skill appears in the table, minus documented exclusions
{
  const tableNames = new Set(table.skills.map((skill) => skill.name));
  const catalog = buildSkillCatalog(PROJECT_ROOT);
  for (const skill of catalog.skills) {
    if (EXCLUDED_SKILLS.includes(skill.name)) {
      assert(!tableNames.has(skill.name), `excluded skill "${skill.name}" must not appear in routing-table.json`);
      continue;
    }
    if (skill.userInvocable !== true) continue;
    assert(tableNames.has(skill.name), `user-invocable skill "${skill.name}" missing from routing-table.json`);
  }
}

// (d) keywords are non-empty arrays of non-empty strings
for (const skill of table.skills) {
  assert(Array.isArray(skill.keywords) && skill.keywords.length > 0, `"${skill.name}" must have a non-empty keywords array`);
  for (const keyword of skill.keywords) {
    assert(typeof keyword === 'string' && keyword.trim().length > 0, `"${skill.name}" has an empty or non-string keyword`);
  }
}

// (e) tampering is detected by the checker's pure comparison
{
  const expected = renderJson(buildRoutingTable(PROJECT_ROOT));
  assert.equal(diffTexts('routing-table.json', expected, expected), null, 'identical surfaces must report no drift');

  const tampered = JSON.parse(expected);
  tampered.skills[0].keywords[0] = 'tampered-keyword-xyz';
  const tamperedText = `${JSON.stringify(tampered, null, 2)}\n`;
  const drift = diffTexts('routing-table.json', expected, tamperedText);
  assert(drift !== null, 'tampered keyword must be detected');
  assert(drift.reason.includes('line'), `drift must point at the first differing line, got: ${drift.reason}`);

  const missing = diffTexts('routing-table.json', expected, null);
  assert(missing !== null && missing.reason === 'file missing', 'missing surface must be detected');
}

// CRLF checkouts (core.autocrlf) must not register as drift: renderJson adopts
// the EOL found on disk, so a CRLF copy compares equal to a CRLF render.
{
  const lf = renderJson(buildRoutingTable(PROJECT_ROOT));
  const crlfOnDisk = lf.replace(/\n/g, '\r\n');
  const crlfExpected = renderJson(buildRoutingTable(PROJECT_ROOT), '\r\n');
  assert.equal(
    diffTexts('routing-table.json', crlfExpected, crlfOnDisk),
    null,
    'a CRLF checkout of routing-table.json must compare clean against a CRLF render'
  );
}

console.log('routing sync tests passed');

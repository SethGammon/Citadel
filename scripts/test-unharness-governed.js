#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'unharness.js');
const suite = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-unharness-governed-'));

function run(root, args = []) {
  return spawnSync(process.execPath, [SCRIPT, root, ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

try {
  const legacy = path.join(suite, 'legacy');
  fs.mkdirSync(path.join(legacy, '.planning', 'campaigns'), { recursive: true });
  fs.writeFileSync(path.join(legacy, '.planning', 'sentinel.txt'), 'user state\n');
  const legacyResult = run(legacy);
  assert.equal(legacyResult.status, 2);
  assert.match(legacyResult.stderr, /exact ownership is unknown/i);
  assert.match(legacyResult.stderr, /adopt\.js.*import plan/i);
  assert.equal(
    fs.readFileSync(path.join(legacy, '.planning', 'sentinel.txt'), 'utf8'),
    'user state\n',
    'legacy compatibility command must not delete inferred paths by default',
  );

  // Derived receipts are per runtime, plus an optional pre-split shared file.
  const legacyApply = path.join(suite, 'legacy-apply');
  const receipts = path.join(legacyApply, '.citadel', 'effective-config');
  fs.mkdirSync(receipts, { recursive: true });
  for (const runtime of ['claude-code', 'codex']) {
    fs.writeFileSync(path.join(receipts, `${runtime}.json`), '{}\n');
  }
  fs.writeFileSync(path.join(legacyApply, '.citadel', 'effective-config.json'), '{}\n');
  const legacyApplyResult = run(legacyApply, ['--legacy-apply']);
  assert.equal(legacyApplyResult.status, 0, legacyApplyResult.stderr);
  assert.equal(
    fs.existsSync(path.join(legacyApply, '.citadel')),
    false,
    'legacy cleanup must remove per-runtime and pre-split effective config receipts',
  );

  const governed = path.join(suite, 'governed');
  fs.mkdirSync(path.join(governed, '.citadel', 'adoption'), { recursive: true });
  fs.writeFileSync(
    path.join(governed, '.citadel', 'adoption', 'active.json'),
    '{"fixture":"presence-only"}\n',
  );
  const governedResult = run(governed);
  assert.equal(governedResult.status, 2);
  assert.match(governedResult.stderr, /governed adoption receipt/i);
  assert.match(governedResult.stderr, /leave plan/i);
  assert(fs.existsSync(path.join(governed, '.citadel', 'adoption', 'active.json')));

  const exportOnly = path.join(suite, 'export-only');
  fs.mkdirSync(path.join(exportOnly, '.planning', 'research'), { recursive: true });
  fs.writeFileSync(path.join(exportOnly, '.planning', 'research', 'note.md'), '# Finding\n');
  const exportResult = run(exportOnly, ['--export-only']);
  assert.equal(exportResult.status, 0, exportResult.stderr);
  assert(fs.existsSync(path.join(exportOnly, 'docs', 'citadel', 'research.md')));
  assert(fs.existsSync(path.join(exportOnly, '.planning', 'research', 'note.md')));

  process.stdout.write('governed unharness compatibility tests passed\n');
} finally {
  fs.rmSync(suite, { recursive: true, force: true });
}

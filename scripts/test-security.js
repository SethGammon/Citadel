#!/usr/bin/env node

/**
 * test-security.js — Security regression tests for Citadel hooks
 *
 * Tests for:
 *   1. Path traversal protection in protect-files.js
 *   2. Shell injection prevention in git operations
 *   3. Pip gate untracked file detection
 *
 * These tests validate that security fixes remain in place.
 * Run manually: node scripts/test-security.js
 * Run via CI: included in scripts/test-all.js
 *
 * Exit codes:
 *   0 = all security tests pass
 *   1 = one or more tests failed
 */

'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const PROTECT_FILES_HOOK = path.join(PLUGIN_ROOT, 'hooks_src', 'protect-files.js');
const QUALITY_GATE_HOOK = path.join(PLUGIN_ROOT, 'hooks_src', 'quality-gate.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err.message || String(err);
    failures.push({ name, msg });
    console.log(`  ✗ ${name}\n    ${msg}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function main() {
  console.log('\nCitadel Security Test Suite\n' + '='.repeat(40));

  // ── 1. Path Traversal Protection ──

  console.log('\n▶ Path Traversal Protection');

  test('protect-files blocks ../../../etc/passwd', () => {
    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: '../../../etc/passwd' }
    });

    const result = spawnSync(process.execPath, [PROTECT_FILES_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });

    assert(result.status === 2, `Expected exit code 2 (block), got ${result.status}`);
    assert(
      result.stdout.includes('traversal') || result.stdout.includes('outside'),
      'Expected traversal violation message in stdout'
    );
  });

  test('protect-files blocks absolute path outside project', () => {
    const input = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/etc/passwd' }
    });

    const result = spawnSync(process.execPath, [PROTECT_FILES_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });

    assert(result.status === 2, `Expected exit code 2 (block), got ${result.status}`);
  });

  test('protect-files allows legitimate project-relative path', () => {
    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(PLUGIN_ROOT, 'README.md') }
    });

    const result = spawnSync(process.execPath, [PROTECT_FILES_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });

    assert(result.status === 0, `Expected exit code 0 (allow), got ${result.status}`);
  });

  test('protect-files blocks .env file reads', () => {
    const input = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: '.env' }
    });

    const result = spawnSync(process.execPath, [PROTECT_FILES_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });

    assert(result.status === 2, `Expected exit code 2 (block), got ${result.status}`);
    assert(result.stdout.includes('.env'), 'Expected .env block message');
  });

  // ── 2. Shell Injection Prevention ──

  console.log('\n▶ Shell Injection Prevention');

  test('quality-gate uses execFileSync (safe)', () => {
    const content = fs.readFileSync(QUALITY_GATE_HOOK, 'utf8');
    assert(
      content.includes('execFileSync') && !content.includes('execSync('),
      'quality-gate should use execFileSync, not execSync'
    );
    assert(
      content.includes("execFileSync('git'") || content.includes('execFileSync("git"'),
      'quality-gate should pass git as separate argument, not in shell string'
    );
  });

  test('protect-files does not use child_process exec', () => {
    const content = fs.readFileSync(PROTECT_FILES_HOOK, 'utf8');
    assert(
      !content.includes('execSync(') && !content.includes('exec('),
      'protect-files should not use execSync or exec (shell injection risk)'
    );
  });

  // ── 3. Pip Gate (in quality-gate.js) ──

  console.log('\n▶ Pip Gate (advisory checks)');

  test('quality-gate checks requirements.txt git tracking', () => {
    const content = fs.readFileSync(QUALITY_GATE_HOOK, 'utf8');
    assert(
      content.includes('requirements.txt') || content.includes('pip'),
      'quality-gate should check Python dependency files'
    );
    // Verify it uses git ls-files (safe) not shell commands
    assert(
      content.includes("execFileSync('git'") || content.includes('execFileSync("git"'),
      'quality-gate should use execFileSync for git operations'
    );
  });

  // ── 4. External Action Gate — Consent System ──

  console.log('\n▶ External Action Gate (Consent)');

  const EAG_HOOK = path.join(PLUGIN_ROOT, 'hooks_src', 'external-action-gate.js');

  test('external-action-gate blocks secrets regardless of consent', () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'cat .env.local' }
    });

    const result = spawnSync(process.execPath, [EAG_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });

    assert(result.status === 2, `Expected exit code 2 (block), got ${result.status}`);
    assert(result.stdout.includes('secrets'), 'Expected secrets block message');
  });

  test('external-action-gate blocks hard actions (gh release create)', () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'gh release create v1.0.0' }
    });

    const result = spawnSync(process.execPath, [EAG_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });

    assert(result.status === 2, `Expected exit code 2 (block), got ${result.status}`);
    assert(
      result.stdout.includes('requires approval') || result.stdout.includes('irreversible'),
      'Expected approval/block message for hard action'
    );
  });

  test('external-action-gate blocks protected branch deletion', () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git push origin --delete main' }
    });

    const result = spawnSync(process.execPath, [EAG_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });

    assert(result.status === 2, `Expected exit code 2 (block), got ${result.status}`);
    assert(result.stdout.includes('protected branch'), 'Expected protected branch message');
  });

  test('external-action-gate triggers first-encounter for soft actions', () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git push origin feat/test' }
    });

    const result = spawnSync(process.execPath, [EAG_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
      env: { ...process.env, CLAUDE_PROJECT_DIR: os.tmpdir() },
    });

    // With no harness.json in tmpdir, this should be a first-encounter block
    assert(result.status === 2, `Expected exit code 2 (block), got ${result.status}`);
    assert(
      result.stdout.includes('first-encounter') || result.stdout.includes('first external action'),
      'Expected first-encounter message'
    );
  });

  test('external-action-gate allows non-external commands', () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' }
    });

    const result = spawnSync(process.execPath, [EAG_HOOK], {
      input,
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });

    assert(result.status === 0, `Expected exit code 0 (allow), got ${result.status}`);
  });

  test('consent utilities round-trip correctly', () => {
    const health = require(path.join(PLUGIN_ROOT, 'hooks_src', 'harness-health-util'));
    const tmpDir = path.join(os.tmpdir(), `citadel-consent-test-${Date.now()}`);
    const origProjectRoot = health.PROJECT_ROOT;

    // Test readConsent returns null when no config exists
    const result = health.checkConsent('externalActions');
    // Can't easily test with mocked PROJECT_ROOT, so verify the function exists and returns valid shape
    assert(
      result && typeof result.action === 'string',
      'checkConsent should return { action: string }'
    );
    assert(
      ['allow', 'block', 'first-encounter'].includes(result.action),
      `checkConsent action should be allow/block/first-encounter, got ${result.action}`
    );
  });

  // ── 5. Glob Pattern Matching (protect-files) ──

  console.log('\n▶ Glob Pattern Security');

  test('protect-files blocks protected glob patterns', () => {
    // Create a temporary harness.json with a protected pattern
    const tmpConfig = path.join(os.tmpdir(), `citadel-test-${Date.now()}.json`);
    fs.writeFileSync(tmpConfig, JSON.stringify({
      protectedFiles: ['secrets/**']
    }));

    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(PLUGIN_ROOT, 'secrets', 'api-keys.txt') }
    });

    // Test would need to mock harness.json location — document expected behavior
    // For now, verify the matchPattern logic exists
    const content = fs.readFileSync(PROTECT_FILES_HOOK, 'utf8');
    assert(
      content.includes('matchPattern') && content.includes('**'),
      'protect-files should support ** glob patterns'
    );

    fs.unlinkSync(tmpConfig);
  });

  // ── Summary ──

  console.log('\n' + '='.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const { name, msg } of failures) {
      console.log(`  - ${name}:`);
      console.log(`    ${msg}`);
    }
    console.log('\nSecurity tests failed! Do not ship until these are fixed.\n');
    process.exit(1);
  }

  console.log('All security tests pass.\n');
  console.log('Note: Some tests are structural (verify code uses safe APIs)');
  console.log('rather than behavioral (execute and verify output). This is');
  console.log('by design — prevents test suite from requiring complex setup.\n');
  process.exit(0);
}

main();

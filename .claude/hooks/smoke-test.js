#!/usr/bin/env node

/**
 * smoke-test.js — Validates all hooks load and execute without errors.
 *
 * Run manually: node .claude/hooks/smoke-test.js
 * Run via setup: automatically invoked during /setup
 *
 * Tests:
 *   1. Every hook file referenced in settings.json exists and parses (require())
 *   2. Settings.json is valid JSON with expected structure
 *   3. Hook commands use relative paths (not $CLAUDE_PROJECT_DIR)
 *   4. All hook utility imports resolve
 *   5. No platform-specific assumptions that would break cross-platform
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed (details printed to stdout)
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const SETTINGS_PATH = path.join(PROJECT_ROOT, '.claude', 'settings.json');
const HOOKS_DIR = path.join(PROJECT_ROOT, '.claude', 'hooks');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      passed++;
      console.log(`  PASS  ${name}`);
    } else {
      failed++;
      const msg = typeof result === 'string' ? result : 'returned falsy';
      failures.push({ name, msg });
      console.log(`  FAIL  ${name}: ${msg}`);
    }
  } catch (err) {
    failed++;
    const msg = err.message || String(err);
    failures.push({ name, msg });
    console.log(`  FAIL  ${name}: ${msg}`);
  }
}

function main() {
  console.log('\nCitadel Hook Smoke Test\n' + '='.repeat(40));

  // ── 1. Settings.json exists and is valid JSON ──

  let settings;
  check('settings.json exists', () => {
    if (!fs.existsSync(SETTINGS_PATH)) return 'File not found';
    return true;
  });

  check('settings.json is valid JSON', () => {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return true;
  });

  check('settings.json has hooks object', () => {
    if (!settings || !settings.hooks) return 'No "hooks" key found';
    if (typeof settings.hooks !== 'object') return '"hooks" is not an object';
    return true;
  });

  if (!settings || !settings.hooks) {
    console.log('\nCannot continue — settings.json is invalid.\n');
    process.exit(1);
  }

  // ── 2. No $CLAUDE_PROJECT_DIR in commands ──

  check('no $CLAUDE_PROJECT_DIR in hook commands', () => {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    if (raw.includes('$CLAUDE_PROJECT_DIR')) {
      return '$CLAUDE_PROJECT_DIR found — this breaks on Windows. Use relative paths instead.';
    }
    return true;
  });

  // ── 3. Every referenced hook file exists ──

  const hookCommands = [];
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const hooks = entry.hooks || [];
      for (const hook of hooks) {
        if (hook.command) {
          hookCommands.push({ event, command: hook.command });
        }
      }
    }
  }

  const hookFiles = new Set();
  for (const { event, command } of hookCommands) {
    // Extract the JS file path from commands like "node .claude/hooks/foo.js"
    const match = command.match(/node\s+(.+\.js)/);
    if (match) {
      const relPath = match[1].replace(/"/g, '');
      hookFiles.add(relPath);
      const fullPath = path.join(PROJECT_ROOT, relPath);

      check(`${event}: ${relPath} exists`, () => {
        if (!fs.existsSync(fullPath)) return `File not found: ${fullPath}`;
        return true;
      });
    }
  }

  // ── 4. Every hook file parses without syntax errors ──

  for (const relPath of hookFiles) {
    const fullPath = path.join(PROJECT_ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;

    check(`${relPath} has valid syntax`, () => {
      const content = fs.readFileSync(fullPath, 'utf8');
      // Use Node's built-in syntax check
      new (require('vm').Script)(content, { filename: relPath });
      return true;
    });
  }

  // ── 5. harness-health-util.js loads ──

  check('harness-health-util.js loads', () => {
    const utilPath = path.join(HOOKS_DIR, 'harness-health-util.js');
    if (!fs.existsSync(utilPath)) return 'File not found';
    // Clear cache to test fresh load
    delete require.cache[require.resolve(utilPath)];
    const util = require(utilPath);
    if (!util.PROJECT_ROOT) return 'MODULE_ROOT not exported';
    if (!util.readConfig) return 'readConfig not exported';
    if (!util.validatePath) return 'validatePath not exported';
    return true;
  });

  // ── 6. Check for hooks that require() harness-health-util ──

  for (const relPath of hookFiles) {
    const fullPath = path.join(PROJECT_ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');

    if (content.includes("require('./harness-health-util')")) {
      check(`${relPath} can resolve harness-health-util`, () => {
        const utilPath = path.join(path.dirname(fullPath), 'harness-health-util.js');
        if (!fs.existsSync(utilPath)) return `Cannot find harness-health-util.js relative to ${relPath}`;
        return true;
      });
    }
  }

  // ── 7. Cross-platform checks ──

  for (const relPath of hookFiles) {
    const fullPath = path.join(PROJECT_ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');

    // Check for hardcoded Unix-only commands used unsafely
    check(`${relPath} no hardcoded /bin/ paths`, () => {
      if (/\/bin\/(bash|sh|zsh)\b/.test(content)) {
        return 'Hardcoded Unix shell path — will fail on Windows';
      }
      return true;
    });
  }

  // ── Summary ──

  console.log('\n' + '='.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const { name, msg } of failures) {
      console.log(`  - ${name}: ${msg}`);
    }
    console.log('');
    process.exit(1);
  }

  console.log('All hooks are healthy.\n');
  process.exit(0);
}

main();

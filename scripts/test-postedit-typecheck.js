#!/usr/bin/env node

/**
 * test-postedit-typecheck.js -- Regression tests for the post-edit TypeScript typecheck.
 *
 * Guards the four documented outcomes (pass, errors, unavailable, timeout) and the
 * silent-pass regressions that motivated the rewrite:
 *   - spawn failures (missing binary) must surface a DID-NOT-RUN advisory, not pass
 *   - timeouts must surface a DID-NOT-RUN advisory, not pass
 *   - typecheckConfig.command must be honored (no bare npx)
 *   - incremental flags are appended when tsconfig.json exists, with a bare retry
 *     when the checker rejects them
 *
 * Offline, stdlib only. Builds a temp project per case and points the hook at it
 * via CLAUDE_PROJECT_DIR (harness-health-util derives PROJECT_ROOT from that env
 * var, falling back to cwd). Fake tsc binaries are local node scripts.
 *
 * Run manually: node scripts/test-postedit-typecheck.js
 *
 * Exit codes:
 *   0 = all tests pass
 *   1 = one or more tests failed
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const POST_EDIT_HOOK = path.join(PLUGIN_ROOT, 'hooks_src', 'post-edit.js');

let passed = 0;
let failed = 0;
const failures = [];
const tempDirs = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    const msg = err.message || String(err);
    failures.push({ name, msg });
    console.log(`  FAIL  ${name}\n    ${msg}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Build a throwaway project the hook can treat as PROJECT_ROOT.
 * Always contains src/a.ts; extra files (fake tsc scripts, tsconfig) come from `files`.
 */
function makeTempProject(harnessConfig, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-typecheck-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'harness.json'), JSON.stringify(harnessConfig, null, 2));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a: number = 1;\n');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/**
 * Spawn the hook the way Claude Code does: JSON event on stdin.
 * Same pattern as scripts/test-security.js.
 */
function runHook(projectRoot, filePath, extraEnv = {}) {
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: filePath },
  });
  const env = { ...process.env };
  delete env.CITADEL_UI;
  delete env.CITADEL_DEBUG;
  delete env.CITADEL_TSC_PATH;
  env.CLAUDE_PROJECT_DIR = projectRoot;
  Object.assign(env, extraEnv);

  return spawnSync(process.execPath, [POST_EDIT_HOOK], {
    input,
    encoding: 'utf8',
    cwd: projectRoot,
    env,
    timeout: 60000,
  });
}

function main() {
  console.log('\nCitadel Post-Edit Typecheck Test Suite\n' + '='.repeat(40));

  // ── (a) errors outcome: fake tsc reports a type error ──

  test('errors: fake tsc failure surfaces error and blocks when hotBlockOnErrors', () => {
    const fakeTsc = [
      "const fs = require('fs');",
      "const path = require('path');",
      "fs.writeFileSync(path.join(__dirname, 'invoked.txt'), 'yes');",
      "process.stdout.write('src/a.ts(1,1): error TS2304: x\\n');",
      "process.stdout.write('src/b.ts(2,2): error TS2304: y\\n');",
      'process.exit(2);',
    ].join('\n');

    const root = makeTempProject({
      language: 'typescript',
      typecheck: { command: 'node fake-tsc.js', perFile: true },
      verification: { hotBlockOnErrors: true },
    }, { 'fake-tsc.js': fakeTsc });

    const result = runHook(root, path.join(root, 'src', 'a.ts'));

    assert(fs.existsSync(path.join(root, 'invoked.txt')), 'fake tsc was never invoked');
    assert(result.status === 2, `Expected exit 2 (hotBlockOnErrors), got ${result.status}: ${result.stdout} ${result.stderr}`);
    assert(result.stdout.includes('error TS2304'), `Expected TS error in output, got: ${result.stdout}`);
    assert(result.stdout.includes('1 error(s) in src/a.ts'), `Expected per-file error count, got: ${result.stdout}`);
    assert(result.stdout.includes('2 total in project'), `Expected project total count, got: ${result.stdout}`);
    assert(result.stdout.includes('perFile mode is not supported'), `Expected perFile advisory, got: ${result.stdout}`);
  });

  test('errors: advisory only (exit 0) when hotBlockOnErrors is unset', () => {
    const fakeTsc = [
      "process.stdout.write('src/a.ts(1,1): error TS2304: x\\n');",
      'process.exit(2);',
    ].join('\n');

    const root = makeTempProject({
      language: 'typescript',
      typecheck: { command: 'node fake-tsc.js' },
    }, { 'fake-tsc.js': fakeTsc });

    const result = runHook(root, path.join(root, 'src', 'a.ts'));

    assert(result.status === 0, `Expected exit 0 (advisory), got ${result.status}`);
    assert(result.stdout.includes('error TS2304'), `Expected TS error advisory in output, got: ${result.stdout}`);
  });

  // ── (b) unavailable outcome: missing binary must NOT pass silently ──

  test('unavailable: CITADEL_TSC_PATH at a missing file emits did-not-run advisory, exit 0', () => {
    const root = makeTempProject({
      language: 'typescript',
      typecheck: { command: 'npx tsc --noEmit' },
      verification: { hotBlockOnErrors: true },
    });

    const result = runHook(root, path.join(root, 'src', 'a.ts'), {
      CITADEL_TSC_PATH: path.join(root, 'missing-tsc.js'),
    });

    assert(result.status === 0, `Expected exit 0 (never block on infrastructure failure), got ${result.status}: ${result.stderr}`);
    // The silent-pass regression guard: the advisory MUST be present
    assert(result.stdout.includes('DID NOT RUN'), `Expected explicit DID NOT RUN advisory, got: ${JSON.stringify(result.stdout)}`);
    assert(result.stdout.includes('unavailable'), `Expected unavailable outcome in advisory, got: ${result.stdout}`);
    assert(result.stdout.includes('missing-tsc.js'), `Expected the missing path named in the advisory, got: ${result.stdout}`);
  });

  // ── (c) timeout outcome: slow checker must NOT pass silently ──

  test('timeout: checker exceeding timeoutMs emits did-not-run advisory, exit 0', () => {
    const fakeTsc = 'setTimeout(() => process.exit(0), 5000);\n';

    const root = makeTempProject({
      language: 'typescript',
      typecheck: { command: 'node fake-tsc.js', timeoutMs: 500 },
      verification: { hotBlockOnErrors: true },
    }, { 'fake-tsc.js': fakeTsc });

    const result = runHook(root, path.join(root, 'src', 'a.ts'));

    assert(result.status === 0, `Expected exit 0 (never block on timeout), got ${result.status}: ${result.stderr}`);
    assert(result.stdout.includes('DID NOT RUN'), `Expected explicit DID NOT RUN advisory, got: ${JSON.stringify(result.stdout)}`);
    assert(result.stdout.includes('timed out'), `Expected timeout reason in advisory, got: ${result.stdout}`);
    assert(result.stdout.includes('500ms'), `Expected configured timeoutMs in advisory, got: ${result.stdout}`);
  });

  // ── (d) language gate: javascript projects skip the TS branch entirely ──

  test('skip: language javascript never invokes the typecheck command', () => {
    const fakeTsc = [
      "const fs = require('fs');",
      "const path = require('path');",
      "fs.writeFileSync(path.join(__dirname, 'invoked.txt'), 'yes');",
      "process.stdout.write('src/a.ts(1,1): error TS2304: x\\n');",
      'process.exit(2);',
    ].join('\n');

    const root = makeTempProject({
      language: 'javascript',
      typecheck: { command: 'node fake-tsc.js' },
      verification: { hotBlockOnErrors: true },
    }, { 'fake-tsc.js': fakeTsc });

    const result = runHook(root, path.join(root, 'src', 'a.ts'));

    assert(result.status === 0, `Expected exit 0, got ${result.status}`);
    assert(!fs.existsSync(path.join(root, 'invoked.txt')), 'Typecheck command was invoked despite language=javascript');
    assert(!result.stdout.includes('error TS'), `Expected no TS error output, got: ${result.stdout}`);
  });

  // ── (e) incremental: flags appended when tsconfig.json exists ──

  test('incremental: tsconfig.json adds --incremental and --tsBuildInfoFile', () => {
    const fakeTsc = [
      "const fs = require('fs');",
      "const path = require('path');",
      "fs.writeFileSync(path.join(__dirname, 'args.json'), JSON.stringify(process.argv.slice(2)));",
      'process.exit(0);',
    ].join('\n');

    const root = makeTempProject({
      language: 'typescript',
      typecheck: { command: 'node fake-tsc.js' },
    }, { 'fake-tsc.js': fakeTsc, 'tsconfig.json': '{}\n' });

    const result = runHook(root, path.join(root, 'src', 'a.ts'));

    assert(result.status === 0, `Expected exit 0 (pass), got ${result.status}`);
    const argsFile = path.join(root, 'args.json');
    assert(fs.existsSync(argsFile), 'fake tsc was never invoked');
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    assert(args.includes('--incremental'), `Expected --incremental in args, got: ${args.join(' ')}`);
    const buildInfoIdx = args.indexOf('--tsBuildInfoFile');
    assert(buildInfoIdx !== -1, `Expected --tsBuildInfoFile in args, got: ${args.join(' ')}`);
    assert(
      (args[buildInfoIdx + 1] || '').includes('tsbuildinfo.json'),
      `Expected tsbuildinfo.json path after --tsBuildInfoFile, got: ${args[buildInfoIdx + 1]}`
    );
    assert(fs.existsSync(path.join(root, '.planning', 'cache')), 'Expected .planning/cache directory to be created');
  });

  // ── (f) incremental: retried once without flags when the checker rejects them ──

  test('incremental: retries bare when checker rejects the flags (TS5023)', () => {
    const fakeTsc = [
      "const fs = require('fs');",
      "const path = require('path');",
      "const counter = path.join(__dirname, 'calls.txt');",
      "const calls = fs.existsSync(counter) ? parseInt(fs.readFileSync(counter, 'utf8'), 10) : 0;",
      'fs.writeFileSync(counter, String(calls + 1));',
      "if (process.argv.includes('--incremental')) {",
      "  process.stdout.write(\"error TS5023: Unknown compiler option '--incremental'.\\n\");",
      '  process.exit(1);',
      '}',
      'process.exit(0);',
    ].join('\n');

    const root = makeTempProject({
      language: 'typescript',
      typecheck: { command: 'node fake-tsc.js' },
      verification: { hotBlockOnErrors: true },
    }, { 'fake-tsc.js': fakeTsc, 'tsconfig.json': '{}\n' });

    const result = runHook(root, path.join(root, 'src', 'a.ts'));

    assert(result.status === 0, `Expected exit 0 (retry passed), got ${result.status}: ${result.stdout}`);
    const calls = fs.readFileSync(path.join(root, 'calls.txt'), 'utf8').trim();
    assert(calls === '2', `Expected exactly 2 invocations (flagged + bare retry), got ${calls}`);
    assert(!result.stdout.includes('DID NOT RUN'), `Retry should succeed without did-not-run advisory, got: ${result.stdout}`);
  });

  // ── Summary ──

  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log('\n' + '='.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const { name, msg } of failures) {
      console.log(`  - ${name}:`);
      console.log(`    ${msg}`);
    }
    console.log('');
    process.exit(1);
  }

  console.log('All post-edit typecheck tests pass.\n');
  process.exit(0);
}

main();

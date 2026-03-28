#!/usr/bin/env node

/**
 * test-organize-enforce.js -- Unit tests for hooks_src/organize-enforce.js
 *
 * Creates sandbox projects with various organization manifests, fires synthetic
 * Edit/Write events at the hook, and verifies correct warn/block/pass behavior.
 *
 * No LLM or Claude Code runtime needed -- hooks are scripts that read JSON from stdin.
 *
 * Usage:
 *   node scripts/test-organize-enforce.js
 *   node scripts/test-organize-enforce.js --verbose
 *
 * Exit codes:
 *   0 = all tests pass
 *   1 = one or more tests failed
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CITADEL_ROOT = path.resolve(__dirname, '..');
const HOOK_SCRIPT = path.join(CITADEL_ROOT, 'hooks_src', 'organize-enforce.js');
const VERBOSE = process.argv.includes('--verbose');

// ── Utilities ────────────────────────────────────────────────────────────────

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-org-test-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.planning', 'telemetry'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeConfig(sandboxDir, config) {
  fs.writeFileSync(
    path.join(sandboxDir, '.claude', 'harness.json'),
    JSON.stringify(config, null, 2)
  );
}

function writeFile(sandboxDir, relPath, content) {
  const full = path.join(sandboxDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content || '// placeholder');
}

function fireHook(payload, sandboxDir) {
  const input = JSON.stringify(payload);
  const result = spawnSync('node', [HOOK_SCRIPT], {
    input,
    cwd: sandboxDir,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: sandboxDir,
      CLAUDE_PLUGIN_DATA: path.join(sandboxDir, '.claude'),
    },
    encoding: 'utf8',
    timeout: 10000,
  });

  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function editEvent(sandboxDir, relPath) {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(sandboxDir, relPath) },
  };
}

function writeEvent(sandboxDir, relPath) {
  return {
    tool_name: 'Write',
    tool_input: { file_path: path.join(sandboxDir, relPath) },
  };
}

// ── Test runner ──────────────────────────────────────────────────────────────

const results = [];
let currentSandbox = null;

function test(name, fn) {
  const start = Date.now();
  let passed = false;
  let detail = '';
  currentSandbox = sandbox();
  try {
    const result = fn(currentSandbox);
    passed = result === true || result === undefined;
    if (typeof result === 'string') { passed = false; detail = result; }
  } catch (e) {
    detail = e.message;
  }
  cleanup(currentSandbox);
  const ms = Date.now() - start;
  results.push({ name, passed, detail, ms });
  const icon = passed ? 'PASS' : 'FAIL';
  const suffix = detail ? `\n         ${detail}` : '';
  console.log(`  ${icon}  ${name} (${ms}ms)${suffix}`);
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\nOrganize Enforce Hook Tests');
console.log('='.repeat(50));

// -- Basic behavior --

console.log('\n  Basic behavior');
console.log('  ' + '-'.repeat(40));

test('exits 0 when no organization config exists', (dir) => {
  writeConfig(dir, { language: 'typescript' });
  writeFile(dir, 'src/foo.ts');
  const r = fireHook(editEvent(dir, 'src/foo.ts'), dir);
  if (r.exitCode !== 0) return `expected exit 0, got ${r.exitCode}`;
});

test('exits 0 for non-Edit/Write tools', (dir) => {
  writeConfig(dir, { organization: { placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }] } });
  const r = fireHook({ tool_name: 'Read', tool_input: { file_path: path.join(dir, 'lib/x.ts') } }, dir);
  if (r.exitCode !== 0) return `expected exit 0, got ${r.exitCode}`;
});

test('exits 0 for excluded directories (.planning)', (dir) => {
  writeConfig(dir, { organization: { placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }] } });
  writeFile(dir, '.planning/foo.ts');
  const r = fireHook(editEvent(dir, '.planning/foo.ts'), dir);
  if (r.exitCode !== 0) return `expected exit 0 for excluded dir, got ${r.exitCode}`;
});

test('exits 0 for excluded directories (node_modules)', (dir) => {
  writeConfig(dir, { organization: { placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }] } });
  writeFile(dir, 'node_modules/foo/bar.ts');
  const r = fireHook(editEvent(dir, 'node_modules/foo/bar.ts'), dir);
  if (r.exitCode !== 0) return `expected exit 0 for node_modules, got ${r.exitCode}`;
});

test('exits 0 when no placement rules match the file', (dir) => {
  writeConfig(dir, { organization: { placement: [{ glob: '*.py', rule: 'root-dir', target: 'src' }] } });
  writeFile(dir, 'src/foo.ts');
  const r = fireHook(editEvent(dir, 'src/foo.ts'), dir);
  if (r.exitCode !== 0) return `expected exit 0 for non-matching glob, got ${r.exitCode}`;
});

// -- root-dir rule --

console.log('\n  root-dir rule');
console.log('  ' + '-'.repeat(40));

test('root-dir: passes when file is under target', (dir) => {
  writeConfig(dir, { organization: { placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }] } });
  writeFile(dir, 'src/utils/helper.ts');
  const r = fireHook(editEvent(dir, 'src/utils/helper.ts'), dir);
  if (r.exitCode !== 0) return `expected pass, got exit ${r.exitCode}: ${r.stdout}`;
});

test('root-dir: warns when file is outside target (unlocked)', (dir) => {
  writeConfig(dir, { organization: { locked: false, placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }] } });
  writeFile(dir, 'lib/helper.ts');
  const r = fireHook(editEvent(dir, 'lib/helper.ts'), dir);
  if (r.exitCode !== 0) return `expected exit 0 (advisory), got ${r.exitCode}`;
  if (!r.stdout.includes('WARN')) return `expected WARN in output, got: ${r.stdout.slice(0, 200)}`;
});

test('root-dir: blocks when file is outside target (locked)', (dir) => {
  writeConfig(dir, { organization: { locked: true, placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }] } });
  writeFile(dir, 'lib/helper.ts');
  const r = fireHook(editEvent(dir, 'lib/helper.ts'), dir);
  if (r.exitCode !== 2) return `expected exit 2 (block), got ${r.exitCode}`;
  if (!r.stdout.includes('BLOCK')) return `expected BLOCK in output, got: ${r.stdout.slice(0, 200)}`;
});

// -- within-root rule --

console.log('\n  within-root rule');
console.log('  ' + '-'.repeat(40));

test('within-root: passes when file is under a declared root', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' }, 'lib': { purpose: 'library' } },
      placement: [{ glob: '*.ts', rule: 'within-root' }],
    },
  });
  writeFile(dir, 'src/foo.ts');
  const r = fireHook(editEvent(dir, 'src/foo.ts'), dir);
  if (r.exitCode !== 0) return `expected pass, got exit ${r.exitCode}: ${r.stdout}`;
});

test('within-root: warns when file is outside all declared roots', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [{ glob: '*.ts', rule: 'within-root' }],
    },
  });
  writeFile(dir, 'random/foo.ts');
  const r = fireHook(editEvent(dir, 'random/foo.ts'), dir);
  if (!r.stdout.includes('WARN')) return `expected WARN, got: ${r.stdout.slice(0, 200)}`;
});

// -- sibling-dir rule --

console.log('\n  sibling-dir rule');
console.log('  ' + '-'.repeat(40));

test('sibling-dir: passes when file is in the expected sibling', (dir) => {
  writeConfig(dir, {
    organization: {
      placement: [{ glob: '*.test.ts', rule: 'sibling-dir', target: '__tests__' }],
    },
  });
  writeFile(dir, 'src/__tests__/foo.test.ts');
  const r = fireHook(editEvent(dir, 'src/__tests__/foo.test.ts'), dir);
  if (r.exitCode !== 0) return `expected pass, got exit ${r.exitCode}: ${r.stdout}`;
});

test('sibling-dir: warns when file is not in sibling dir', (dir) => {
  writeConfig(dir, {
    organization: {
      placement: [{ glob: '*.test.ts', rule: 'sibling-dir', target: '__tests__' }],
    },
  });
  writeFile(dir, 'src/components/foo.test.ts');
  const r = fireHook(editEvent(dir, 'src/components/foo.test.ts'), dir);
  if (!r.stdout.includes('WARN')) return `expected WARN, got: ${r.stdout.slice(0, 200)}`;
});

// -- colocated rule --

console.log('\n  colocated rule');
console.log('  ' + '-'.repeat(40));

test('colocated: passes when test file is next to its source', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [{ glob: '*.test.ts', rule: 'colocated' }],
    },
  });
  // Create source file first, then test file
  writeFile(dir, 'src/components/Button.ts', 'export const Button = () => {}');
  writeFile(dir, 'src/components/Button.test.ts', 'test("Button", () => {})');
  const r = fireHook(editEvent(dir, 'src/components/Button.test.ts'), dir);
  if (r.exitCode !== 0) return `expected pass, got exit ${r.exitCode}: ${r.stdout}`;
  if (r.stdout.includes('WARN')) return `unexpected WARN: ${r.stdout.slice(0, 200)}`;
});

test('colocated: warns when test file is in collector directory (__tests__)', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [{ glob: '*.test.ts', rule: 'colocated' }],
    },
  });
  writeFile(dir, 'src/components/Button.ts', 'export const Button = () => {}');
  writeFile(dir, 'src/components/__tests__/Button.test.ts', 'test("Button", () => {})');
  const r = fireHook(editEvent(dir, 'src/components/__tests__/Button.test.ts'), dir);
  if (!r.stdout.includes('WARN') && !r.stdout.includes('BLOCK'))
    return `expected violation for collector dir, got: ${r.stdout.slice(0, 300)}`;
  if (!r.stdout.includes('collector directory'))
    return `expected "collector directory" in message, got: ${r.stdout.slice(0, 300)}`;
});

test('colocated: warns when test file is in top-level tests/ dir', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [{ glob: '*.test.ts', rule: 'colocated' }],
    },
  });
  writeFile(dir, 'src/utils/math.ts', 'export function add(a, b) { return a + b; }');
  writeFile(dir, 'tests/math.test.ts', 'test("add", () => {})');
  const r = fireHook(editEvent(dir, 'tests/math.test.ts'), dir);
  if (!r.stdout.includes('WARN') && !r.stdout.includes('BLOCK'))
    return `expected violation for tests/ collector, got: ${r.stdout.slice(0, 300)}`;
});

test('colocated: warns when source found in different directory', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [{ glob: '*.test.ts', rule: 'colocated' }],
    },
  });
  // Source is in src/auth/, but test is in src/utils/
  writeFile(dir, 'src/auth/login.ts', 'export function login() {}');
  writeFile(dir, 'src/utils/login.test.ts', 'test("login", () => {})');
  const r = fireHook(editEvent(dir, 'src/utils/login.test.ts'), dir);
  if (!r.stdout.includes('WARN') && !r.stdout.includes('BLOCK'))
    return `expected violation for misplaced test, got: ${r.stdout.slice(0, 300)}`;
});

test('colocated: no false positive when source does not exist anywhere', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [{ glob: '*.test.ts', rule: 'colocated' }],
    },
  });
  // Brand new test file with no corresponding source yet
  writeFile(dir, 'src/new-feature/widget.test.ts', 'test("widget", () => {})');
  const r = fireHook(editEvent(dir, 'src/new-feature/widget.test.ts'), dir);
  if (r.exitCode !== 0) return `expected exit 0 (no false positive), got ${r.exitCode}`;
  if (r.stdout.includes('WARN')) return `false positive: ${r.stdout.slice(0, 300)}`;
});

test('colocated: handles .spec suffix', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [{ glob: '*.spec.ts', rule: 'colocated' }],
    },
  });
  writeFile(dir, 'src/components/Modal.ts', 'export const Modal = {}');
  writeFile(dir, '__tests__/Modal.spec.ts', 'test("Modal", () => {})');
  const r = fireHook(editEvent(dir, '__tests__/Modal.spec.ts'), dir);
  if (!r.stdout.includes('collector directory'))
    return `expected collector dir violation for .spec, got: ${r.stdout.slice(0, 300)}`;
});

// -- locked vs unlocked --

console.log('\n  locked vs unlocked enforcement');
console.log('  ' + '-'.repeat(40));

test('unlocked: violations produce exit 0 (advisory)', (dir) => {
  writeConfig(dir, {
    organization: {
      locked: false,
      placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }],
    },
  });
  writeFile(dir, 'wrong/place.ts');
  const r = fireHook(editEvent(dir, 'wrong/place.ts'), dir);
  if (r.exitCode !== 0) return `expected exit 0, got ${r.exitCode}`;
  if (!r.stdout.includes('advisory')) return `expected "advisory" hint, got: ${r.stdout.slice(0, 200)}`;
});

test('locked: violations produce exit 2 (block)', (dir) => {
  writeConfig(dir, {
    organization: {
      locked: true,
      placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }],
    },
  });
  writeFile(dir, 'wrong/place.ts');
  const r = fireHook(editEvent(dir, 'wrong/place.ts'), dir);
  if (r.exitCode !== 2) return `expected exit 2, got ${r.exitCode}`;
  if (!r.stdout.includes('Move the file')) return `expected move instruction, got: ${r.stdout.slice(0, 200)}`;
});

// -- general root enforcement --

console.log('\n  general root enforcement');
console.log('  ' + '-'.repeat(40));

test('source files outside declared roots trigger root-enforcement warning', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' }, 'lib': { purpose: 'library' } },
      placement: [],  // no specific rules, but roots are declared
    },
  });
  writeFile(dir, 'random/deep/file.ts');
  const r = fireHook(editEvent(dir, 'random/deep/file.ts'), dir);
  if (!r.stdout.includes('outside all declared root'))
    return `expected root-enforcement warning, got: ${r.stdout.slice(0, 300)}`;
});

test('config files at project root are not flagged', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [],
    },
  });
  // Root-level config files should be ignored
  writeFile(dir, 'tsconfig.json', '{}');
  const r = fireHook(writeEvent(dir, 'tsconfig.json'), dir);
  if (r.exitCode !== 0) return `expected exit 0 for root config, got ${r.exitCode}`;
});

test('non-source files in subdirs are not flagged by root-enforcement', (dir) => {
  writeConfig(dir, {
    organization: {
      roots: { 'src': { purpose: 'source' } },
      placement: [],
    },
  });
  writeFile(dir, 'docs/guide.md', '# Guide');
  const r = fireHook(writeEvent(dir, 'docs/guide.md'), dir);
  if (r.exitCode !== 0) return `expected exit 0 for .md file, got ${r.exitCode}`;
  if (r.stdout.includes('WARN')) return `unexpected warning for non-source file: ${r.stdout.slice(0, 200)}`;
});

// -- glob matching --

console.log('\n  glob pattern matching');
console.log('  ' + '-'.repeat(40));

test('brace expansion: *.{ts,tsx} matches both extensions', (dir) => {
  writeConfig(dir, {
    organization: {
      placement: [{ glob: '*.{ts,tsx}', rule: 'root-dir', target: 'src' }],
    },
  });
  writeFile(dir, 'lib/foo.ts');
  writeFile(dir, 'lib/bar.tsx');
  const r1 = fireHook(editEvent(dir, 'lib/foo.ts'), dir);
  const r2 = fireHook(editEvent(dir, 'lib/bar.tsx'), dir);
  if (!r1.stdout.includes('WARN')) return `.ts not matched by *.{ts,tsx}`;
  if (!r2.stdout.includes('WARN')) return `.tsx not matched by *.{ts,tsx}`;
});

test('glob does not match unrelated extensions', (dir) => {
  writeConfig(dir, {
    organization: {
      placement: [{ glob: '*.test.ts', rule: 'root-dir', target: 'src' }],
    },
  });
  writeFile(dir, 'lib/foo.ts');  // not a test file
  const r = fireHook(editEvent(dir, 'lib/foo.ts'), dir);
  if (r.stdout.includes('WARN')) return `*.test.ts should not match foo.ts`;
});

// -- Write tool event --

console.log('\n  Write tool support');
console.log('  ' + '-'.repeat(40));

test('Write events are checked (not just Edit)', (dir) => {
  writeConfig(dir, {
    organization: {
      placement: [{ glob: '*.ts', rule: 'root-dir', target: 'src' }],
    },
  });
  writeFile(dir, 'wrong/new-file.ts');
  const r = fireHook(writeEvent(dir, 'wrong/new-file.ts'), dir);
  if (!r.stdout.includes('WARN')) return `Write event not enforced: ${r.stdout.slice(0, 200)}`;
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\nFailed tests:');
  for (const r of results.filter(r => !r.passed)) {
    console.log(`  FAIL  ${r.name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
  process.exit(1);
} else {
  console.log('\nAll organize-enforce tests pass.');
  process.exit(0);
}

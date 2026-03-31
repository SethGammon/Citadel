#!/usr/bin/env node

/**
 * verify-hooks.js — Hook install + runtime verification
 *
 * Creates a clean sandbox project, installs Citadel hooks into it, then fires
 * synthetic event payloads at each hook script directly (no Claude Code runtime
 * needed — hooks are just scripts that receive JSON on stdin).
 *
 * Usage:
 *   node scripts/verify-hooks.js             # run all tests
 *   node scripts/verify-hooks.js --verbose   # show per-test output
 *   node scripts/verify-hooks.js --report    # write RESULTS.md
 *
 * Exit codes:
 *   0 = all tests pass
 *   1 = one or more tests failed
 *
 * Three phases:
 *   Phase 1: Install — run install-hooks.js, verify settings.json structure
 *   Phase 2: Init   — fire init-project.js, verify .planning/ scaffolding
 *   Phase 3: Runtime — fire each hook with synthetic payload, assert side effects
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawnSync, execFileSync } = require('child_process');

const CITADEL_ROOT  = path.resolve(__dirname, '..');
const HOOKS_SRC     = path.join(CITADEL_ROOT, 'hooks_src');
const VERBOSE       = process.argv.includes('--verbose');
const WRITE_REPORT  = process.argv.includes('--report');

// ── Utilities ─────────────────────────────────────────────────────────────────

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-verify-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Fire a hook script with a synthetic payload.
 * Returns { exitCode, stdout, stderr, timedOut }
 */
function fireHook(hookName, payload, sandboxDir, extraEnv = {}) {
  const script = path.join(HOOKS_SRC, hookName);
  const input  = typeof payload === 'string' ? payload : JSON.stringify(payload);

  const result = spawnSync('node', [script], {
    input,
    cwd: sandboxDir,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: sandboxDir,
      CLAUDE_PLUGIN_DATA: path.join(sandboxDir, '.claude'),
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 10000,
  });

  return {
    exitCode: result.status ?? -1,
    stdout:   result.stdout || '',
    stderr:   result.stderr || '',
    timedOut: result.signal === 'SIGTERM',
  };
}

function fileExists(sandboxDir, relPath) {
  return fs.existsSync(path.join(sandboxDir, relPath));
}

function readJsonl(sandboxDir, relPath) {
  const full = path.join(sandboxDir, relPath);
  if (!fs.existsSync(full)) return [];
  return fs.readFileSync(full, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function countLines(sandboxDir, relPath) {
  return readJsonl(sandboxDir, relPath).length;
}

// ── Test runner ──────────────────────────────────────────────────────────────

const results = [];

function test(name, fn) {
  const start = Date.now();
  let passed = false;
  let detail = '';
  try {
    const result = fn();
    passed = result === true || result === undefined;
    if (typeof result === 'string') { passed = false; detail = result; }
  } catch (e) {
    detail = e.message;
  }
  const ms = Date.now() - start;
  results.push({ name, passed, detail, ms });
  const icon = passed ? 'PASS' : 'FAIL';
  const suffix = detail ? `\n         ${detail}` : '';
  console.log(`  ${icon}  ${name}${suffix}`);
  if (VERBOSE && detail) console.log(`         ${detail}`);
}

// ── Phase 1: Install verification ─────────────────────────────────────────────

console.log('\nPhase 1: Install');
console.log('─'.repeat(40));

let installDir = sandbox();

test('install-hooks.js exits 0', () => {
  const r = spawnSync('node', [path.join(CITADEL_ROOT, 'scripts', 'install-hooks.js'), installDir, '--hook-profile', 'latest'], {
    encoding: 'utf8', timeout: 10000,
  });
  if (r.status !== 0) return `exit ${r.status}: ${r.stderr.slice(0, 200)}`;
});

test('settings.json created', () => {
  if (!fileExists(installDir, '.claude/settings.json'))
    return '.claude/settings.json not found after install';
});

test('settings.json is valid JSON', () => {
  try {
    const raw = fs.readFileSync(path.join(installDir, '.claude/settings.json'), 'utf8');
    JSON.parse(raw);
  } catch (e) {
    return `invalid JSON: ${e.message}`;
  }
});

test('all expected hook events registered', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(installDir, '.claude/settings.json'), 'utf8'));
  const registered = Object.keys(settings.hooks || {});
  const expected = [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'PreCompact', 'PostCompact', 'Stop', 'StopFailure',
    'SessionStart', 'SessionEnd',
    'SubagentStop', 'TaskCreated', 'TaskCompleted',
    'WorktreeCreate', 'WorktreeRemove',
  ];
  const missing = expected.filter(e => !registered.includes(e));
  if (missing.length) return `missing events: ${missing.join(', ')}`;
});

test('hook commands reference real files', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(installDir, '.claude/settings.json'), 'utf8'));
  const bad = [];
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    for (const entry of entries) {
      for (const hook of (entry.hooks || [])) {
        if (!hook.command) continue;
        // Extract script path from: node "path" or node path
        const match = hook.command.match(/node\s+"?([^"\s]+\.js)"?/);
        if (match && !fs.existsSync(match[1])) {
          bad.push(`${event}: ${match[1]}`);
        }
      }
    }
  }
  if (bad.length) return `broken paths:\n  ${bad.join('\n  ')}`;
});

test('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB injected', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(installDir, '.claude/settings.json'), 'utf8'));
  if (settings.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB !== '1')
    return 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB missing from env';
});

cleanup(installDir);

// ── Phase 2: Init project ────────────────────────────────────────────────────

console.log('\nPhase 2: Init project (SessionStart → init-project.js)');
console.log('─'.repeat(40));

const initDir = sandbox();

test('init-project.js exits 0', () => {
  const r = fireHook('init-project.js', {}, initDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
});

test('.planning/ directory tree created', () => {
  const dirs = [
    '.planning/campaigns',
    '.planning/campaigns/completed',
    '.planning/intake',
    '.planning/telemetry',
    '.planning/fleet',
    '.planning/research',
  ];
  const missing = dirs.filter(d => !fileExists(initDir, d));
  if (missing.length) return `missing dirs: ${missing.join(', ')}`;
});

test('.citadel/scripts/ populated', () => {
  const scripts = path.join(initDir, '.citadel', 'scripts');
  if (!fs.existsSync(scripts)) return '.citadel/scripts/ not created';
  const files = fs.readdirSync(scripts);
  if (files.length === 0) return '.citadel/scripts/ is empty';
});

test('.citadel/plugin-root.txt written', () => {
  if (!fileExists(initDir, '.citadel/plugin-root.txt'))
    return 'plugin-root.txt not created';
  const content = fs.readFileSync(path.join(initDir, '.citadel/plugin-root.txt'), 'utf8').trim();
  if (!content) return 'plugin-root.txt is empty';
});

test('_templates/ copied from plugin', () => {
  if (!fileExists(initDir, '.planning/_templates'))
    return '.planning/_templates/ not created';
  const files = fs.readdirSync(path.join(initDir, '.planning', '_templates'));
  if (files.length === 0) return '_templates/ is empty';
});

test('init-project.js is idempotent (safe to re-run)', () => {
  const r = fireHook('init-project.js', {}, initDir);
  if (r.exitCode !== 0) return `second run failed: exit ${r.exitCode}`;
});

// ── Phase 3: Runtime hook tests ───────────────────────────────────────────────

console.log('\nPhase 3: Runtime (synthetic payloads)');
console.log('─'.repeat(40));

// We reuse initDir (already has .planning/ structure) for all runtime tests.
const rDir = initDir;

// ── protect-files.js ──

test('protect-files: blocks edit to .claude/harness.json (exit 2)', () => {
  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(rDir, '.claude', 'harness.json') },
  };
  const r = fireHook('protect-files.js', payload, rDir);
  if (r.exitCode !== 2) return `expected exit 2, got ${r.exitCode}`;
  if (!r.stdout.includes('[protect-files]')) return 'no block message in stdout';
});

test('protect-files: allows edit to normal file (exit 0)', () => {
  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(rDir, 'src', 'index.ts') },
  };
  const r = fireHook('protect-files.js', payload, rDir);
  if (r.exitCode !== 0) return `expected exit 0, got ${r.exitCode}: ${r.stdout}`;
});

test('protect-files: blocks Read on .env file (exit 2)', () => {
  const payload = {
    tool_name: 'Read',
    tool_input: { file_path: path.join(rDir, '.env') },
  };
  const r = fireHook('protect-files.js', payload, rDir);
  if (r.exitCode !== 2) return `expected exit 2, got ${r.exitCode}`;
});

test('protect-files: allows Read on non-env file (exit 0)', () => {
  const payload = {
    tool_name: 'Read',
    tool_input: { file_path: path.join(rDir, 'README.md') },
  };
  const r = fireHook('protect-files.js', payload, rDir);
  if (r.exitCode !== 0) return `expected exit 0, got ${r.exitCode}`;
});

// ── governance.js ──

test('governance: writes audit.jsonl entry on Edit', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(rDir, 'src', 'app.ts') },
  };
  const r = fireHook('governance.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl not updated';
});

test('governance: writes audit.jsonl entry on Bash', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  const payload = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
  const r = fireHook('governance.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl not updated';
});

test('governance: skips Read tool (no audit entry)', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  const payload = { tool_name: 'Read', tool_input: { file_path: 'src/index.ts' } };
  fireHook('governance.js', payload, rDir);
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after !== before) return 'audit.jsonl should not grow for Read';
});

test('governance: audit entries have required fields', () => {
  const entries = readJsonl(rDir, '.planning/telemetry/audit.jsonl');
  if (entries.length === 0) return 'no audit entries found';
  const last = entries[entries.length - 1];
  const missing = ['event', 'tool', 'timestamp'].filter(f => !(f in last));
  if (missing.length) return `entry missing fields: ${missing.join(', ')}`;
});

// ── pre-compact.js ──

test('pre-compact: exits 0 on clean project', () => {
  const r = fireHook('pre-compact.js', {}, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
});

test('pre-compact: writes to hook-timing.jsonl', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('pre-compact.js', {}, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── post-compact.js ──

test('post-compact: exits 0 with no state file', () => {
  const r = fireHook('post-compact.js', {}, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
});

// ── quality-gate.js ──

test('quality-gate: exits 0 with stop_hook_active=true (no loop)', () => {
  const r = fireHook('quality-gate.js', { stop_hook_active: true }, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('quality-gate: exits 0 on clean project (no files to scan)', () => {
  const r = fireHook('quality-gate.js', {}, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
});

// ── circuit-breaker.js ──

test('circuit-breaker: exits 0 on first failure', () => {
  const payload = { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'exit 1' };
  const r = fireHook('circuit-breaker.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('circuit-breaker: state file written after failure', () => {
  const r = fireHook('circuit-breaker.js',
    { tool_name: 'Bash', tool_input: { command: 'x' }, error: 'exit 1' },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
  const stateFile = path.join(rDir, '.claude', 'circuit-breaker-state.json');
  if (!fs.existsSync(stateFile)) return 'circuit-breaker-state.json not created';
});

// ── stop-failure.js ──

test('stop-failure: exits 0', () => {
  const payload = { hook_name: 'quality-gate', error: 'hook timed out' };
  const r = fireHook('stop-failure.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('stop-failure: writes audit entry', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  fireHook('stop-failure.js', { hook_name: 'quality-gate', error: 'hook timed out' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl not updated';
});

// ── session-end.js ──

test('session-end: exits 0', () => {
  const r = fireHook('session-end.js', { session_id: 'test-session-1' }, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
});

test('session-end: writes hook-timing.jsonl entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('session-end.js', { session_id: 'test-session-2' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── task-events.js ──

test('task-events: exits 0 on TaskCreated', () => {
  const r = fireHook('task-events.js',
    { hook_event_name: 'TaskCreated', task_id: 'task-abc-1', title: 'Build auth' },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('task-events: writes telemetry on TaskCreated', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('task-events.js',
    { hook_event_name: 'TaskCreated', task_id: 'task-abc-2', title: 'Test suite' },
    rDir
  );
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

test('task-events: exits 0 on TaskCompleted', () => {
  const r = fireHook('task-events.js',
    { hook_event_name: 'TaskCompleted', task_id: 'task-abc-2', status: 'completed' },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

// ── subagent-stop.js ──

test('subagent-stop: exits 0', () => {
  const r = fireHook('subagent-stop.js',
    { agent_id: 'agent-xyz', status: 'success', subagent_type: 'marshal' },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('subagent-stop: writes audit entry on abnormal termination', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  fireHook('subagent-stop.js',
    { agent_id: 'agent-xyz-2', status: 'timeout', subagent_type: 'marshal' },
    rDir
  );
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl not updated';
});

// ── worktree-remove.js ──

test('worktree-remove: exits 0', () => {
  const r = fireHook('worktree-remove.js',
    { worktree_path: '/tmp/test-worktree', branch: 'fleet/agent-1' },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('worktree-remove: writes telemetry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('worktree-remove.js',
    { worktree_path: '/tmp/test-worktree-2', branch: 'fleet/agent-2' },
    rDir
  );
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── protect-files: campaign scope enforcement ──

test('protect-files: warns (not blocks) on out-of-scope edit', () => {
  // Create a campaign with declared scope
  const campaignsDir = path.join(rDir, '.planning', 'campaigns');
  fs.writeFileSync(path.join(campaignsDir, 'test-scope.md'), [
    '# Campaign: Test Scope',
    'Status: active',
    '',
    '## Claimed Scope',
    '- src/',
  ].join('\n'));

  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(rDir, 'docs', 'README.md') },
  };
  const r = fireHook('protect-files.js', payload, rDir);
  // Advisory warning — exits 0 but writes a message
  if (r.exitCode !== 0) return `expected exit 0 (advisory), got ${r.exitCode}`;
  if (!r.stdout.includes('outside the claimed scope'))
    return 'expected scope warning in stdout';
  fs.rmSync(path.join(campaignsDir, 'test-scope.md'));
});

test('protect-files: hard-blocks on Restricted Files edit', () => {
  const campaignsDir = path.join(rDir, '.planning', 'campaigns');
  fs.writeFileSync(path.join(campaignsDir, 'test-restricted.md'), [
    '# Campaign: Test Restricted',
    'Status: active',
    '',
    '## Claimed Scope',
    '- src/',
    '',
    '## Restricted Files',
    '- .env.production',
  ].join('\n'));

  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(rDir, '.env.production') },
  };
  const r = fireHook('protect-files.js', payload, rDir);
  if (r.exitCode !== 2) return `expected exit 2 (block), got ${r.exitCode}`;
  fs.rmSync(path.join(campaignsDir, 'test-restricted.md'));
});

// ── Cleanup ─────────────────────────────────────────────────────────────────

cleanup(rDir);

// ── Summary ──────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log('\n' + '='.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (WRITE_REPORT) {
  const dir = path.join(CITADEL_ROOT, '.planning', 'verification', 'hook-install');
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString();
  const lines = [
    `# Hook Verification Results`,
    ``,
    `> Date: ${date}`,
    `> Passed: ${passed} / ${results.length}`,
    ``,
    `## Results`,
    ``,
    `| Test | Result | Notes |`,
    `|---|---|---|`,
    ...results.map(r =>
      `| ${r.name} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.detail || ''} |`
    ),
    ``,
    failed === 0
      ? `## All tests passed. Hooks install and fire correctly.`
      : `## ${failed} test(s) failed. See table above for details.`,
  ];
  fs.writeFileSync(path.join(dir, 'RESULTS.md'), lines.join('\n') + '\n');
  console.log(`Results written: .planning/verification/hook-install/RESULTS.md`);
}

if (failed > 0) {
  console.log('\nFailed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.detail}`);
  });
  process.exit(1);
}

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
    'Setup',
    'PreToolUse', 'PostToolUse', 'PostToolBatch', 'PostToolUseFailure',
    'PreCompact', 'PostCompact', 'Stop', 'StopFailure',
    'UserPromptSubmit', 'UserPromptExpansion',
    'SessionStart', 'SessionEnd',
    'SubagentStart', 'SubagentStop', 'TeammateIdle',
    'PermissionRequest', 'PermissionDenied', 'InstructionsLoaded',
    'FileChanged', 'CwdChanged', 'ConfigChange',
    'Elicitation', 'ElicitationResult', 'Notification',
    'TaskCreated', 'TaskCompleted',
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

test('.citadel/scripts/ populated with delegates', () => {
  const scripts = path.join(initDir, '.citadel', 'scripts');
  if (!fs.existsSync(scripts)) return '.citadel/scripts/ not created';
  const files = fs.readdirSync(scripts);
  if (files.length === 0) return '.citadel/scripts/ is empty';
  // Each file should be a thin delegate (reads plugin-root.txt, not a verbatim copy)
  const delegateMarker = 'plugin-root.txt';
  const nonDelegate = files.filter(f => {
    if (!f.endsWith('.js') && !f.endsWith('.cjs')) return false;
    const content = fs.readFileSync(path.join(scripts, f), 'utf8');
    return !content.includes(delegateMarker);
  });
  if (nonDelegate.length > 0) return `non-delegate scripts found: ${nonDelegate.join(', ')}`;
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

test('protect-files: allows Read outside project root for non-env files (exit 0)', () => {
  const payload = {
    tool_name: 'Read',
    tool_input: { file_path: path.join(os.tmpdir(), `citadel-external-${process.pid}.md`) },
  };
  const r = fireHook('protect-files.js', payload, rDir);
  if (r.exitCode !== 0) return `expected exit 0, got ${r.exitCode}: ${r.stdout}`;
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

// ── post-tool-batch.js ──

test('post-tool-batch: exits 0', () => {
  const payload = { session_id: 'test-session', agent_id: null, agent_type: null };
  const r = fireHook('post-tool-batch.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
});

test('post-tool-batch: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('post-tool-batch.js', { session_id: 'test-batch-2' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── subagent-start.js ──

test('subagent-start: exits 0', () => {
  const payload = { agent_id: 'agent-abc', agent_type: 'marshal', description: 'Run audit' };
  const r = fireHook('subagent-start.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('subagent-start: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('subagent-start.js', { agent_id: 'agent-def', agent_type: 'fleet' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

test('subagent-start: writes audit entry for typed agents', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  fireHook('subagent-start.js',
    { agent_id: 'agent-ghi', agent_type: 'Explore', description: 'Search codebase' },
    rDir
  );
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl not updated for typed agent spawn';
});

// ── permission-request.js ──

test('permission-request: exits 0', () => {
  const payload = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
  const r = fireHook('permission-request.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('permission-request: writes audit entry', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  const payload = { tool_name: 'Bash', tool_input: { command: 'git push' } };
  fireHook('permission-request.js', payload, rDir);
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl not updated';
});

test('permission-request: auto-approves citadel script (stdout has allow decision)', () => {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'node .citadel/scripts/telemetry-log.cjs --event test' },
  };
  const r = fireHook('permission-request.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
  if (!r.stdout.includes('"behavior":"allow"') && !r.stdout.includes('"behavior": "allow"'))
    return 'expected auto-approve decision in stdout';
});

test('permission-request: auto-approves known verification commands', () => {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'npm run test' },
  };
  const r = fireHook('permission-request.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
  if (!r.stdout.includes('"behavior":"allow"') && !r.stdout.includes('"behavior": "allow"'))
    return 'expected auto-approve decision in stdout';
});

test('permission-request: auto-approves generated codex artifact writes', () => {
  const payload = {
    tool_name: 'Write',
    tool_input: { file_path: path.join(rDir, '.codex', 'config.toml') },
  };
  const r = fireHook('permission-request.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
  if (!r.stdout.includes('"behavior":"allow"') && !r.stdout.includes('"behavior": "allow"'))
    return 'expected auto-approve decision in stdout';
});

test('permission-request: defers unknown command (no decision in stdout)', () => {
  const payload = {
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
  };
  const r = fireHook('permission-request.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
  if (r.stdout.includes('"behavior":"allow"')) return 'should not auto-approve dangerous command';
});

// ── instructions-loaded.js ──

test('instructions-loaded: exits 0 with no file path', () => {
  const r = fireHook('instructions-loaded.js', {}, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('instructions-loaded: exits 0 with file path', () => {
  const payload = {
    file_path: path.join(rDir, 'CLAUDE.md'),
    session_id: 'test-session',
  };
  const r = fireHook('instructions-loaded.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('instructions-loaded: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('instructions-loaded.js',
    { file_path: path.join(rDir, 'CLAUDE.md'), session_id: 'test-timing' },
    rDir
  );
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── user-prompt-submit.js ──

test('user-prompt-submit: exits 0', () => {
  const r = fireHook('user-prompt-submit.js', { session_id: 'test-session' }, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('user-prompt-submit: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('user-prompt-submit.js', { session_id: 'test-prompt-2' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── file-changed.js ──

test('file-changed: exits 0 with no file', () => {
  const r = fireHook('file-changed.js', {}, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('file-changed: exits 0 on regular file', () => {
  const payload = { file_path: path.join(rDir, 'src', 'app.ts'), change_type: 'modified' };
  const r = fireHook('file-changed.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('file-changed: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('file-changed.js', { file_path: path.join(rDir, 'src', 'x.ts') }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

test('file-changed: queues doc-sync for CLAUDE.md change', () => {
  const payload = { file_path: path.join(rDir, 'CLAUDE.md'), change_type: 'modified' };
  fireHook('file-changed.js', payload, rDir);
  const queue = readJsonl(rDir, '.planning/telemetry/doc-sync-queue.jsonl');
  const entry = queue.find(e => e.event === 'file-changed');
  if (!entry) return 'no doc-sync-queue entry for CLAUDE.md change';
});

test('file-changed: queues skill-lint for SKILL.md change', () => {
  const payload = {
    file_path: path.join(rDir, 'skills', 'marshal', 'SKILL.md'),
    change_type: 'modified',
  };
  fireHook('file-changed.js', payload, rDir);
  const queue = readJsonl(rDir, '.planning/telemetry/skill-lint-queue.jsonl');
  if (queue.length === 0) return 'skill-lint-queue.jsonl not updated';
});

// ── user-prompt-expansion.js ──

test('user-prompt-expansion: exits 0 with no prompt', () => {
  const r = fireHook('user-prompt-expansion.js', {}, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('user-prompt-expansion: exits 0 with skill name', () => {
  const r = fireHook('user-prompt-expansion.js',
    { skill_name: 'marshal', original_prompt: '/marshal fix auth' },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('user-prompt-expansion: writes skill-usage.jsonl entry', () => {
  const before = countLines(rDir, '.planning/telemetry/skill-usage.jsonl');
  fireHook('user-prompt-expansion.js',
    { skill_name: 'fleet', original_prompt: '/fleet build auth' },
    rDir
  );
  const after = countLines(rDir, '.planning/telemetry/skill-usage.jsonl');
  if (after <= before) return 'skill-usage.jsonl not updated';
});

// ── notification.js ──

test('notification: exits 0', () => {
  const r = fireHook('notification.js', { notification_type: 'idle' }, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('notification: writes audit entry for auth_failure', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  fireHook('notification.js', { notification_type: 'auth_failure', message: 'Token expired' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl not updated for auth_failure';
});

test('notification: writes hook-timing for any notification', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('notification.js', { notification_type: 'permission' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── config-change.js ──

test('config-change: exits 0', () => {
  const r = fireHook('config-change.js', {}, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('config-change: exits 0 with file path', () => {
  const r = fireHook('config-change.js',
    { file_path: path.join(rDir, '.claude', 'settings.json') },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('config-change: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('config-change.js', { file_path: path.join(rDir, '.claude', 'settings.json') }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── cwd-changed.js ──

test('cwd-changed: exits 0', () => {
  const r = fireHook('cwd-changed.js',
    { old_cwd: rDir, cwd: path.join(rDir, 'src') },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('cwd-changed: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('cwd-changed.js', { old_cwd: rDir, cwd: path.join(rDir, 'src') }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

test('cwd-changed: logs audit entry when moving outside project', () => {
  const before = countLines(rDir, '.planning/telemetry/audit.jsonl');
  fireHook('cwd-changed.js', { old_cwd: rDir, cwd: '/tmp/outside' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl not updated for outside-project cwd';
});

// ── teammate-idle.js ──

test('teammate-idle: exits 0', () => {
  const r = fireHook('teammate-idle.js',
    { teammate_id: 'agent-xyz', reason: 'no-work' },
    rDir
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('teammate-idle: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('teammate-idle.js', { teammate_id: 'agent-abc' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

// ── elicitation.js (Elicitation + ElicitationResult) ──

test('elicitation: exits 0 on Elicitation event', () => {
  const payload = {
    hook_event_name: 'Elicitation',
    server_name: 'my-mcp-server',
  };
  const r = fireHook('elicitation.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('elicitation: exits 0 on ElicitationResult event', () => {
  const payload = {
    hook_event_name: 'ElicitationResult',
    server_name: 'my-mcp-server',
    accepted: true,
  };
  const r = fireHook('elicitation.js', payload, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}`;
});

test('elicitation: writes hook-timing entry', () => {
  const before = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  fireHook('elicitation.js', { hook_event_name: 'Elicitation', server_name: 'test' }, rDir);
  const after = countLines(rDir, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl not updated';
});

test('elicitation: no auto-response (empty stdout)', () => {
  const payload = { hook_event_name: 'Elicitation', server_name: 'unknown-server' };
  const r = fireHook('elicitation.js', payload, rDir);
  // Should NOT emit hookSpecificOutput (no auto-response)
  if (r.stdout.trim()) return `expected empty stdout, got: ${r.stdout.slice(0, 100)}`;
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

test('protect-files: warns on Restricted Files edit by default', () => {
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
  if (r.exitCode !== 0) return `expected exit 0 (advisory), got ${r.exitCode}`;
  if (!r.stdout.includes('RESTRICTED')) return 'expected restricted warning in stdout';
  fs.rmSync(path.join(campaignsDir, 'test-restricted.md'));
});

test('protect-files: hard-blocks on Restricted Files edit when strict policy is enabled', () => {
  const campaignsDir = path.join(rDir, '.planning', 'campaigns');
  const harnessPath = path.join(rDir, '.claude', 'harness.json');
  fs.mkdirSync(path.dirname(harnessPath), { recursive: true });
  const hadHarness = fs.existsSync(harnessPath);
  const originalHarness = hadHarness ? fs.readFileSync(harnessPath, 'utf8') : null;
  fs.writeFileSync(harnessPath, JSON.stringify({
    policy: { campaignRestrictions: { blockRestrictedFiles: true } },
  }, null, 2));
  fs.writeFileSync(path.join(campaignsDir, 'test-restricted.md'), [
    '# Campaign: Test Restricted',
    'Status: active',
    '',
    '## Restricted Files',
    '- .env.production',
  ].join('\n'));

  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(rDir, '.env.production') },
  };
  const r = fireHook('protect-files.js', payload, rDir);
  if (hadHarness) fs.writeFileSync(harnessPath, originalHarness);
  else fs.rmSync(harnessPath, { force: true });
  fs.rmSync(path.join(campaignsDir, 'test-restricted.md'));
  if (r.exitCode !== 2) return `expected exit 2 (block), got ${r.exitCode}`;
});

// ── Audit integrity (harness-health-util) ──

test('audit integrity: writeAuditLog produces _hash field', () => {
  const health = require(path.join(CITADEL_ROOT, 'hooks_src', 'harness-health-util'));
  health.writeAuditLog('test-event', { detail: 'verify-hooks test' });
  const auditFile = path.join(rDir, '.planning', 'telemetry', 'audit.jsonl');
  if (!fs.existsSync(auditFile)) return 'audit.jsonl not created';
  const lines = fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  if (!last._hash) return 'no _hash field on audit record';
  if (last._hash_v !== 1) return `expected _hash_v 1, got ${last._hash_v}`;
  if (typeof last._hash !== 'string' || last._hash.length !== 64) return `unexpected _hash value: ${last._hash}`;
});

test('audit integrity: verifyAuditIntegrity detects clean records', () => {
  const health = require(path.join(CITADEL_ROOT, 'hooks_src', 'harness-health-util'));
  const auditFile = path.join(rDir, '.planning', 'telemetry', 'audit.jsonl');
  const result = health.verifyAuditIntegrity(auditFile);
  if (result.tampered.length > 0) return `${result.tampered.length} records flagged as tampered (should be 0)`;
  if (result.verified === 0 && result.legacy.length === 0) return 'no records verified and none legacy — file may be empty';
});

test('audit integrity: verifyAuditIntegrity detects tampered record', () => {
  const health = require(path.join(CITADEL_ROOT, 'hooks_src', 'harness-health-util'));
  const tamperedFile = path.join(rDir, '.planning', 'telemetry', 'audit-tampered-test.jsonl');
  // Write a record, then corrupt its hash
  const base = { schema: 1, event: 'test', timestamp: new Date().toISOString(), project: 'test' };
  const record = { ...base, _hash: 'deadbeef'.repeat(8), _hash_v: 1 };
  fs.writeFileSync(tamperedFile, JSON.stringify(record) + '\n', 'utf8');
  const result = health.verifyAuditIntegrity(tamperedFile);
  if (result.tampered.length !== 1) return `expected 1 tampered record, got ${result.tampered.length}`;
  fs.unlinkSync(tamperedFile);
});

test('audit integrity: logTiming produces _hash field', () => {
  const health = require(path.join(CITADEL_ROOT, 'hooks_src', 'harness-health-util'));
  health.logTiming('verify-hooks-test', 0, { test: true });
  const timingFile = path.join(rDir, '.planning', 'telemetry', 'hook-timing.jsonl');
  if (!fs.existsSync(timingFile)) return 'hook-timing.jsonl not created';
  const lines = fs.readFileSync(timingFile, 'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);
  if (!last._hash) return 'no _hash field on timing record';
  if (last._hash_v !== 1) return `expected _hash_v 1, got ${last._hash_v}`;
});

test('audit integrity: hashRecord is deterministic', () => {
  const health = require(path.join(CITADEL_ROOT, 'hooks_src', 'harness-health-util'));
  const record = { b: 2, a: 1, c: { z: 26, y: 25 } };
  const h1 = health.hashRecord(record);
  const h2 = health.hashRecord(record);
  if (h1 !== h2) return 'hashRecord is not deterministic';
  // Key order should not matter
  const reordered = { c: { z: 26, y: 25 }, a: 1, b: 2 };
  const h3 = health.hashRecord(reordered);
  if (h1 !== h3) return 'hashRecord is not key-order-independent';
});

// ── intake-scanner.js ──

test('intake-scanner: exits 0 with no intake items or staged wiki', () => {
  const r = fireHook('intake-scanner.js', { session_id: 'test-session' }, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
});

test('intake-scanner: surfaces staged wiki findings message', () => {
  // Create a staging file that is newer than any wiki index
  const stagingDir = path.join(rDir, '.planning', 'wiki', '_staging');
  fs.mkdirSync(stagingDir, { recursive: true });
  const stagingFile = path.join(stagingDir, 'test-cycle-0000000000000.jsonl');
  fs.writeFileSync(stagingFile, JSON.stringify({ type: 'pattern', name: 'test-pattern', topic: 'test' }) + '\n');

  const r = fireHook('intake-scanner.js', { session_id: 'test-session-2' }, rDir);
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
  if (!r.stdout.includes('wiki') && !r.stdout.includes('staged')) {
    return `expected wiki staging message in stdout, got: ${r.stdout.slice(0, 200)}`;
  }

  // Cleanup
  fs.rmSync(stagingDir, { recursive: true, force: true });
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

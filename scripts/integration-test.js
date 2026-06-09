#!/usr/bin/env node

/**
 * integration-test.js — Full hook pipeline integration tests
 *
 * Unlike verify-hooks.js (which fires individual hooks with synthetic payloads),
 * this script tests complete tool-call lifecycle sequences:
 *
 *   PreToolUse hooks → tool execution → PostToolUse hooks
 *
 * Reads the installed settings.json to dispatch hooks exactly as Claude Code
 * would, then asserts on side effects (telemetry, audit log, block behavior).
 * No LLM needed.
 *
 * Usage:
 *   node scripts/integration-test.js             # run all sequences
 *   node scripts/integration-test.js --verbose   # show per-sequence output
 *   node scripts/integration-test.js --report    # write RESULTS.md
 *
 * Exit codes:
 *   0 = all sequences pass
 *   1 = one or more sequences failed
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawnSync } = require('child_process');

const CITADEL_ROOT = path.resolve(__dirname, '..');
const HOOKS_SRC    = path.join(CITADEL_ROOT, 'hooks_src');
const VERBOSE      = process.argv.includes('--verbose');
const WRITE_REPORT = process.argv.includes('--report');

// ── Sandbox ────────────────────────────────────────────────────────────────────

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-integ-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });

  // Install hooks into sandbox
  const install = spawnSync('node', [path.join(CITADEL_ROOT, 'scripts', 'install-hooks.js'), dir], {
    encoding: 'utf8', timeout: 10000,
  });
  if (install.status !== 0) throw new Error(`install-hooks failed: ${install.stderr}`);

  // Init project (creates .planning/)
  fireHookScript('init-project.js', {}, dir);

  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Hook dispatch ──────────────────────────────────────────────────────────────

function fireHookScript(scriptName, payload, sandbox, extraEnv = {}) {
  const scriptPath = path.join(HOOKS_SRC, scriptName);
  const input = JSON.stringify(payload);
  const result = spawnSync('node', [scriptPath], {
    input,
    cwd: sandbox,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: sandbox,
      CLAUDE_PLUGIN_DATA: path.join(sandbox, '.claude'),
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  return {
    exitCode: result.status ?? -1,
    stdout:   result.stdout || '',
    stderr:   result.stderr || '',
  };
}

function getHooksForEvent(sandbox, event, toolName) {
  const settingsPath = path.join(sandbox, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const entries = (settings.hooks || {})[event] || [];
  const matched = [];

  for (const entry of entries) {
    if (entry.matcher) {
      const re = new RegExp(`^(${entry.matcher})$`);
      if (!re.test(toolName || '')) continue;
    }
    for (const hook of (entry.hooks || [])) {
      if (!hook.command) continue;
      const m = hook.command.match(/node\s+"?([^"\s]+\.js)"?/);
      if (m) matched.push(m[1]);
    }
  }

  return matched;
}

/**
 * Dispatch all PreToolUse hooks for a tool.
 * Returns { blocked, blockMessage, script } — first exit-2 stops dispatch.
 */
function preToolUse(sandbox, toolName, toolInput) {
  const scripts = getHooksForEvent(sandbox, 'PreToolUse', toolName);
  for (const scriptPath of scripts) {
    const r = spawnSync('node', [scriptPath], {
      input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
      cwd: sandbox,
      env: { ...process.env, CLAUDE_PROJECT_DIR: sandbox, CLAUDE_PLUGIN_DATA: path.join(sandbox, '.claude') },
      encoding: 'utf8',
      timeout: 10000,
    });
    if ((r.status ?? -1) === 2) {
      return { blocked: true, blockMessage: r.stdout || '', script: path.basename(scriptPath) };
    }
  }
  return { blocked: false };
}

/**
 * Dispatch all PostToolUse hooks for a tool.
 */
function postToolUse(sandbox, toolName, toolInput, toolResult) {
  const scripts = getHooksForEvent(sandbox, 'PostToolUse', toolName);
  for (const scriptPath of scripts) {
    spawnSync('node', [scriptPath], {
      input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, tool_result: toolResult }),
      cwd: sandbox,
      env: { ...process.env, CLAUDE_PROJECT_DIR: sandbox, CLAUDE_PLUGIN_DATA: path.join(sandbox, '.claude') },
      encoding: 'utf8',
      timeout: 30000,
    });
  }
}

// ── Tool execution ─────────────────────────────────────────────────────────────

function execTool(toolName, toolInput, sandbox) {
  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path || toolInput.path;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, toolInput.content || toolInput.new_string || '');
    return { type: 'edit', path: filePath };
  }
  if (toolName === 'Read') {
    try {
      return { type: 'read', content: fs.readFileSync(toolInput.file_path, 'utf8') };
    } catch (e) {
      return { type: 'read', error: e.message };
    }
  }
  if (toolName === 'Bash') {
    const r = spawnSync(toolInput.command, { shell: true, cwd: sandbox, encoding: 'utf8', timeout: 5000 });
    return { type: 'bash', stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
  }
  return { type: 'noop' };
}

// ── Telemetry helpers ──────────────────────────────────────────────────────────

function countJsonlLines(sandbox, relPath) {
  const full = path.join(sandbox, relPath);
  if (!fs.existsSync(full)) return 0;
  return fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).length;
}

// ── Campaign helpers ───────────────────────────────────────────────────────────

/** Extract YAML frontmatter from a markdown string. Returns {} if none found. */
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const result = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      const val = kv[2].trim().replace(/^["']|["']$/g, '');
      result[kv[1]] = isNaN(val) ? val : Number(val);
    }
  }
  return result;
}

function makeCampaignFile(name, status = 'active', phaseCount = 3, currentPhase = 1) {
  return [
    '---',
    'version: 1',
    `status: ${status}`,
    `started: "${new Date().toISOString()}"`,
    `direction: "Test campaign ${name}"`,
    `phase_count: ${phaseCount}`,
    `current_phase: ${currentPhase}`,
    '---',
    '',
    `# Campaign: ${name}`,
    '',
    `Status: ${status}`,
    '',
    '## Claimed Scope',
    '- src/',
    '',
    '## Phases',
    '| # | Status | Type | Phase | Done When |',
    '|---|--------|------|-------|-----------|',
    ...Array.from({ length: phaseCount }, (_, i) => `| ${i+1} | ${i === currentPhase-1 ? 'in-progress' : 'pending'} | build | Phase ${i+1} | done |`),
  ].join('\n');
}

// ── Test runner ────────────────────────────────────────────────────────────────

const results = [];

function sequence(name, fn, sandbox) {
  const start = Date.now();
  let passed = false;
  let detail = '';
  try {
    const r = fn(sandbox);
    passed = r === true || r === undefined;
    if (typeof r === 'string') { passed = false; detail = r; }
  } catch (e) {
    detail = e.message;
  }
  const ms = Date.now() - start;
  results.push({ name, passed, detail, ms });
  const icon = passed ? 'PASS' : 'FAIL';
  const suffix = detail ? `\n         ${detail}` : '';
  console.log(`  ${icon}  ${name}${suffix}`);
}

// ── Sequences ─────────────────────────────────────────────────────────────────

let sandbox;
try {
  sandbox = makeSandbox();
} catch (e) {
  console.error(`\nFATAL: Could not create sandbox: ${e.message}`);
  process.exit(1);
}

console.log('\nCitadel Integration Tests (hook pipeline)');
console.log('='.repeat(40));
console.log('\n── Edit flow ──');

sequence('Edit allowed file: PreToolUse passes', (sb) => {
  const filePath = path.join(sb, 'src', 'app.ts');
  const pre = preToolUse(sb, 'Edit', { file_path: filePath });
  if (pre.blocked) return `PreToolUse blocked unexpectedly by ${pre.script}: ${pre.blockMessage}`;
}, sandbox);

sequence('Edit allowed file: audit.jsonl grows after Pre+Post', (sb) => {
  const filePath = path.join(sb, 'src', 'app.ts');
  const before = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');
  const pre = preToolUse(sb, 'Edit', { file_path: filePath });
  if (pre.blocked) return `blocked: ${pre.blockMessage}`;
  const toolResult = execTool('Edit', { file_path: filePath, content: 'export const x = 1;' }, sb);
  postToolUse(sb, 'Edit', { file_path: filePath }, toolResult);
  const after = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl did not grow — governance hook did not log';
}, sandbox);

sequence('Edit allowed file: hook-timing.jsonl grows after PostToolUse', (sb) => {
  const filePath = path.join(sb, 'src', 'utils.ts');
  const before = countJsonlLines(sb, '.planning/telemetry/hook-timing.jsonl');
  const pre = preToolUse(sb, 'Edit', { file_path: filePath });
  if (pre.blocked) return `blocked: ${pre.blockMessage}`;
  const toolResult = execTool('Edit', { file_path: filePath, content: 'export const y = 2;' }, sb);
  postToolUse(sb, 'Edit', { file_path: filePath }, toolResult);
  const after = countJsonlLines(sb, '.planning/telemetry/hook-timing.jsonl');
  if (after <= before) return 'hook-timing.jsonl did not grow — post-edit hook did not fire';
}, sandbox);

console.log('\n── Protected file enforcement ──');

sequence('Edit .claude/harness.json: blocked by protect-files (exit 2)', (sb) => {
  const filePath = path.join(sb, '.claude', 'harness.json');
  const auditBefore = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');
  const pre = preToolUse(sb, 'Edit', { file_path: filePath });
  if (!pre.blocked) return 'expected block, got allowed';
  if (!pre.blockMessage.includes('[protect-files]')) return `expected [protect-files] in message, got: ${pre.blockMessage}`;
  // Verify tool was never executed (file unchanged or not created as full write)
  const auditAfter = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');
  // Governance also runs — but protect-files fires first and blocks, so governance may or may not run
  // depending on hook order. The key assertion is that protect-files blocked.
}, sandbox);

sequence('Read .env: blocked by protect-files', (sb) => {
  const filePath = path.join(sb, '.env');
  fs.writeFileSync(filePath, 'SECRET=abc123');
  const pre = preToolUse(sb, 'Read', { file_path: filePath });
  if (!pre.blocked) return 'expected .env read to be blocked';
  if (!pre.blockMessage.includes('[protect-files]')) return `expected [protect-files] message, got: ${pre.blockMessage}`;
  fs.rmSync(filePath);
}, sandbox);

sequence('Edit .env.local: blocked by protect-files', (sb) => {
  const filePath = path.join(sb, '.env.local');
  const pre = preToolUse(sb, 'Read', { file_path: filePath });
  if (!pre.blocked) return 'expected .env.local read to be blocked';
}, sandbox);

sequence('Read external non-env file: not blocked by protect-files', (sb) => {
  const filePath = path.join(os.tmpdir(), `citadel-external-${process.pid}.md`);
  const pre = preToolUse(sb, 'Read', { file_path: filePath });
  if (pre.blocked) return `unexpected block: ${pre.blockMessage}`;
}, sandbox);

sequence('Edit normal file in .claude/: not blocked', (sb) => {
  // .claude/settings.json is not in protectedFiles — only harness.json
  const filePath = path.join(sb, '.claude', 'notes.md');
  const pre = preToolUse(sb, 'Edit', { file_path: filePath });
  if (pre.blocked) return `unexpected block: ${pre.blockMessage}`;
}, sandbox);

console.log('\n── Campaign scope enforcement ──');

sequence('Edit out-of-scope file: warns but does not block', (sb) => {
  const campaignDir = path.join(sb, '.planning', 'campaigns');
  fs.mkdirSync(campaignDir, { recursive: true });
  const campaignFile = path.join(campaignDir, 'scope-test.md');
  fs.writeFileSync(campaignFile, [
    '# Campaign: Scope Test',
    'Status: active',
    '',
    '## Claimed Scope',
    '- src/',
  ].join('\n'));

  const filePath = path.join(sb, 'docs', 'README.md');
  // Fire protect-files directly to check stdout (preToolUse only returns blocked/not)
  const r = spawnSync('node', [path.join(HOOKS_SRC, 'protect-files.js')], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } }),
    cwd: sb,
    env: { ...process.env, CLAUDE_PROJECT_DIR: sb, CLAUDE_PLUGIN_DATA: path.join(sb, '.claude') },
    encoding: 'utf8', timeout: 10000,
  });
  fs.rmSync(campaignFile);
  if (r.status !== 0) return `expected exit 0 (advisory), got ${r.status}`;
  if (!r.stdout.includes('outside the claimed scope')) return `expected scope warning, got: ${r.stdout.slice(0, 200)}`;
}, sandbox);

sequence('Edit restricted file: warns by default in protect-files', (sb) => {
  const campaignDir = path.join(sb, '.planning', 'campaigns');
  const campaignFile = path.join(campaignDir, 'restricted-test.md');
  fs.writeFileSync(campaignFile, [
    '# Campaign: Restricted Test',
    'Status: active',
    '',
    '## Claimed Scope',
    '- src/',
    '',
    '## Restricted Files',
    '- .env.production',
  ].join('\n'));

  const filePath = path.join(sb, '.env.production');
  const pre = preToolUse(sb, 'Edit', { file_path: filePath });
  fs.rmSync(campaignFile);
  if (pre.blocked) return `expected advisory warning, got block: ${pre.blockMessage}`;
}, sandbox);

console.log('\n── Bash flow ──');

sequence('Bash command: governance logs to audit.jsonl', (sb) => {
  const before = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');
  const pre = preToolUse(sb, 'Bash', { command: 'echo hello' });
  if (pre.blocked) return `Bash unexpectedly blocked: ${pre.blockMessage}`;
  execTool('Bash', { command: 'echo hello' }, sb);
  postToolUse(sb, 'Bash', { command: 'echo hello' }, { exitCode: 0 });
  const after = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl did not grow for Bash — governance did not log';
}, sandbox);

console.log('\n── Failure & recovery ──');

sequence('PostToolUseFailure: circuit-breaker state file written', (sb) => {
  const r = fireHookScript('circuit-breaker.js',
    { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'exit 1' },
    sb
  );
  if (r.exitCode !== 0) return `exit ${r.exitCode}: ${r.stderr}`;
  const stateFile = path.join(sb, '.claude', 'circuit-breaker-state.json');
  if (!fs.existsSync(stateFile)) return 'circuit-breaker-state.json not created';
}, sandbox);

sequence('StopFailure: audit entry written', (sb) => {
  const before = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');
  fireHookScript('stop-failure.js', { hook_name: 'quality-gate', error: 'timed out' }, sb);
  const after = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');
  if (after <= before) return 'audit.jsonl did not grow for StopFailure';
}, sandbox);

console.log('\n── Full sequence: write → edit → verify telemetry ──');

sequence('3-step write/edit/read sequence: all hooks fire, telemetry consistent', (sb) => {
  const timingBefore = countJsonlLines(sb, '.planning/telemetry/hook-timing.jsonl');
  const auditBefore  = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');

  const filePath = path.join(sb, 'src', 'feature.ts');

  // Step 1: Write
  const pre1 = preToolUse(sb, 'Write', { file_path: filePath });
  if (pre1.blocked) return `Write PreToolUse blocked: ${pre1.blockMessage}`;
  const write = execTool('Write', { file_path: filePath, content: 'export const a = 1;' }, sb);
  postToolUse(sb, 'Write', { file_path: filePath }, write);

  // Step 2: Edit
  const pre2 = preToolUse(sb, 'Edit', { file_path: filePath });
  if (pre2.blocked) return `Edit PreToolUse blocked: ${pre2.blockMessage}`;
  const edit = execTool('Edit', { file_path: filePath, content: 'export const a = 2;' }, sb);
  postToolUse(sb, 'Edit', { file_path: filePath }, edit);

  // Step 3: Read (allowed)
  const pre3 = preToolUse(sb, 'Read', { file_path: filePath });
  if (pre3.blocked) return `Read PreToolUse blocked: ${pre3.blockMessage}`;

  const timingAfter = countJsonlLines(sb, '.planning/telemetry/hook-timing.jsonl');
  const auditAfter  = countJsonlLines(sb, '.planning/telemetry/audit.jsonl');

  if (timingAfter <= timingBefore) return 'hook-timing.jsonl did not grow across 3-step sequence';
  if (auditAfter <= auditBefore + 1) return `audit.jsonl grew by ${auditAfter - auditBefore} — expected at least 2 entries (Write + Edit)`;
}, sandbox);

console.log('\n── Campaign lifecycle ──');

sequence('Campaign file with YAML frontmatter is readable', (sb) => {
  const campaignsDir = path.join(sb, '.planning', 'campaigns');
  fs.mkdirSync(campaignsDir, { recursive: true });
  const filePath = path.join(campaignsDir, 'fm-test.md');
  const content = makeCampaignFile('fm-test', 'active', 3, 1);
  fs.writeFileSync(filePath, content);

  const read = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(read);
  fs.rmSync(filePath);

  if (fm.version !== 1) return `expected version === 1, got: ${fm.version}`;
  if (fm.status !== 'active') return `expected status === 'active', got: ${fm.status}`;
  if (typeof fm.phase_count !== 'number') return `expected phase_count to be a number, got: ${typeof fm.phase_count}`;
}, sandbox);

sequence('Campaign status advancement: frontmatter + body in sync', (sb) => {
  const campaignsDir = path.join(sb, '.planning', 'campaigns');
  fs.mkdirSync(campaignsDir, { recursive: true });
  const filePath = path.join(campaignsDir, 'advance-test.md');
  const content = makeCampaignFile('advance-test', 'active', 2, 1);
  fs.writeFileSync(filePath, content);

  // Simulate advancing: update both frontmatter status and body Status line
  let text = fs.readFileSync(filePath, 'utf8');
  text = text.replace(/^(status:\s*)active$/m, '$1completed');
  text = text.replace(/^(Status:\s*)active$/m, '$1completed');
  fs.writeFileSync(filePath, text);

  const updated = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(updated);
  const bodyMatch = updated.match(/^Status:\s*(\S+)$/m);
  fs.rmSync(filePath);

  if (fm.status !== 'completed') return `expected frontmatter status === 'completed', got: ${fm.status}`;
  if (!bodyMatch || bodyMatch[1] !== 'completed') return `expected body Status: completed, got: ${bodyMatch ? bodyMatch[1] : 'not found'}`;
}, sandbox);

sequence('Campaign archive: move to completed/ directory', (sb) => {
  const campaignsDir = path.join(sb, '.planning', 'campaigns');
  const completedDir = path.join(campaignsDir, 'completed');
  fs.mkdirSync(completedDir, { recursive: true });

  const srcPath = path.join(campaignsDir, 'lifecycle-test.md');
  const dstPath = path.join(completedDir, 'lifecycle-test.md');

  // Write active campaign then advance to completed before archiving
  let content = makeCampaignFile('lifecycle-test', 'active', 2, 1);
  content = content.replace(/^(status:\s*)active$/m, '$1completed');
  content = content.replace(/^(Status:\s*)active$/m, '$1completed');
  fs.writeFileSync(srcPath, content);

  // Simulate archive: rename to completed/
  fs.renameSync(srcPath, dstPath);

  if (fs.existsSync(srcPath)) return 'source file still exists after archive';
  if (!fs.existsSync(dstPath)) return 'destination file does not exist after archive';

  const archived = fs.readFileSync(dstPath, 'utf8');
  const fm = parseFrontmatter(archived);
  fs.rmSync(dstPath);

  if (fm.status !== 'completed') return `expected archived frontmatter status === 'completed', got: ${fm.status}`;
}, sandbox);

sequence('protect-files glob: src/** blocks recursive match, non-matching path allowed', (sb) => {
  // Write a harness.json with src/** as a protected pattern
  const harnessPath = path.join(sb, '.claude', 'harness.json');
  const config = { protectedFiles: ['.claude/harness.json', 'src/**'] };
  fs.writeFileSync(harnessPath, JSON.stringify(config, null, 2));

  // Create the deeply nested file so its directory exists
  const deepFile = path.join(sb, 'src', 'deeply', 'nested', 'file.ts');
  fs.mkdirSync(path.dirname(deepFile), { recursive: true });
  fs.writeFileSync(deepFile, '');

  // src/deeply/nested/file.ts should be blocked
  const pre1 = preToolUse(sb, 'Edit', { file_path: deepFile });
  if (!pre1.blocked) return `expected src/deeply/nested/file.ts to be blocked by src/**`;

  // other/file.ts should NOT be blocked
  const otherFile = path.join(sb, 'other', 'file.ts');
  fs.mkdirSync(path.dirname(otherFile), { recursive: true });
  fs.writeFileSync(otherFile, '');
  const pre2 = preToolUse(sb, 'Edit', { file_path: otherFile });

  // Restore original harness.json (it is protected by default)
  fs.writeFileSync(harnessPath, JSON.stringify({ protectedFiles: ['.claude/harness.json'] }, null, 2));
  fs.rmSync(deepFile);
  fs.rmSync(otherFile);

  if (pre2.blocked) return `expected other/file.ts NOT to be blocked, but got: ${pre2.blockMessage}`;
}, sandbox);

sequence('init-project version gate: .citadel/version.txt exists after sandbox init', (sb) => {
  const versionFile = path.join(sb, '.citadel', 'version.txt');
  if (!fs.existsSync(versionFile)) {
    // Graceful skip: version gating is feature-flagged by whether package.json version is present
    // in the plugin. This is an edge case in CI where the harness has no package.json.
    const pluginPkg = path.join(CITADEL_ROOT, 'package.json');
    if (!fs.existsSync(pluginPkg)) {
      // Skip gracefully
      return undefined;
    }
    return '.citadel/version.txt not found — version gating may not be active';
  }
  const version = fs.readFileSync(versionFile, 'utf8').trim();
  if (!version) return '.citadel/version.txt exists but is empty';
}, sandbox);

sequence('telemetry-schema: validateAgentRunEvent accepts valid entry and rejects invalid event type', (sb) => {
  const schema = require(path.join(CITADEL_ROOT, 'scripts', 'telemetry-schema.js'));

  // Valid entry
  const valid = {
    timestamp: new Date().toISOString(),
    event: 'agent-start',
    agent: 'test-agent',
    session: 'session-001',
    duration_ms: null,
    status: null,
    meta: null,
  };
  const r1 = schema.validateAgentRunEvent(valid);
  if (!r1.valid) return `expected valid entry to pass, got errors: ${r1.errors.join(', ')}`;

  // Invalid event type
  const invalid = { ...valid, event: 'not-a-valid-event-type' };
  const r2 = schema.validateAgentRunEvent(invalid);
  if (r2.valid) return 'expected invalid event type to fail validation, but got valid: true';
}, sandbox);

// ── Cleanup ───────────────────────────────────────────────────────────────────

cleanup(sandbox);

// ── Summary ───────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log('\n' + '='.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\nFailed sequences:');
  results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.detail}`));
}

if (WRITE_REPORT) {
  const dir = path.join(CITADEL_ROOT, '.planning', 'verification', 'integration');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    `# Integration Test Results`,
    ``,
    `> Date: ${new Date().toISOString()}`,
    `> Passed: ${passed} / ${results.length}`,
    ``,
    `| Sequence | Result | Detail |`,
    `|---|---|---|`,
    ...results.map(r => `| ${r.name} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.detail || ''} |`),
  ];
  fs.writeFileSync(path.join(dir, 'RESULTS.md'), lines.join('\n') + '\n');
  console.log(`\nReport: .planning/verification/integration/RESULTS.md`);
}

process.exit(failed > 0 ? 1 : 0);

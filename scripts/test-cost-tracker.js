#!/usr/bin/env node

/**
 * test-cost-tracker.js — Unit tests for cost-tracker.js
 *
 * Tests phase-length warning (35-min cliff) and threshold alert behavior
 * by writing fake session JSONL into a controlled HOME directory so the
 * real session-tokens adapter reads it.
 *
 * Run: node scripts/test-cost-tracker.js
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { spawnSync } = require('child_process');

const CITADEL_ROOT  = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function pass(name) { console.log(`  PASS  ${name}`); passed++; }
function fail(name, msg) { console.log(`  FAIL  ${name}: ${msg}`); failed++; }

// ── Sandbox ───────────────────────────────────────────────────────────────────

/**
 * Mirror the slug logic from runtimes/claude-code/adapters/session-tokens.js
 * so we write JSONL to the exact path the adapter will look for.
 */
function projectSlug(projectDir) {
  const normalized = projectDir.replace(/\\/g, '/');
  return normalized.replace(/^\//, '').replace(/:/g, '-').replace(/\//g, '-');
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-cost-'));
  const slug = projectSlug(path.join(dir, 'project'));
  fs.mkdirSync(path.join(dir, 'home', '.claude', 'projects', slug), { recursive: true });
  fs.mkdirSync(path.join(dir, 'project', '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'project', '.planning', 'telemetry'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'project', '.claude', 'harness.json'),
    JSON.stringify({ version: 1 })
  );
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/**
 * Write a fake session JSONL with the given token counts and timestamps.
 * The session-tokens adapter reads from:
 *   HOME/.claude/projects/{slug}/{sessionId}.jsonl
 *
 * slug is derived from CLAUDE_PROJECT_DIR = sandbox/project
 */
function writeSessionJSONL(sandbox, sessionId, { outputTokens, durationMinutes }) {
  const slug = projectSlug(path.join(sandbox, 'project'));
  const sessionsDir = path.join(sandbox, 'home', '.claude', 'projects', slug);
  const now = Date.now();
  const firstTs = new Date(now - durationMinutes * 60 * 1000).toISOString();
  const lastTs  = new Date(now).toISOString();

  // Two message entries: first at session start, last at session end
  const entry1 = JSON.stringify({
    timestamp: firstTs,
    message: {
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 500, output_tokens: 0,
               cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
  const entry2 = JSON.stringify({
    timestamp: lastTs,
    message: {
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 0, output_tokens: outputTokens,
               cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });

  fs.writeFileSync(path.join(sessionsDir, `${sessionId}.jsonl`), entry1 + '\n' + entry2 + '\n');
}

function runCostTracker(sandbox, sessionId, stateOverride) {
  const stateFile = path.join(sandbox, 'project', '.planning', 'telemetry', 'cost-tracker-state.json');
  if (stateOverride !== undefined) {
    if (stateOverride === null) {
      try { fs.unlinkSync(stateFile); } catch {}
    } else {
      fs.writeFileSync(stateFile, JSON.stringify(stateOverride));
    }
  }

  // On Windows, HOME may not be set; use USERPROFILE
  const homeKey = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';

  const result = spawnSync('node', [path.join(CITADEL_ROOT, 'hooks_src', 'cost-tracker.js')], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: {} }),
    cwd: path.join(sandbox, 'project'),
    env: {
      ...process.env,
      [homeKey]:            path.join(sandbox, 'home'),
      HOME:                 path.join(sandbox, 'home'),
      CLAUDE_PROJECT_DIR:   path.join(sandbox, 'project'),
      CLAUDE_PLUGIN_DATA:   path.join(sandbox, 'project', '.claude'),
      CLAUDE_SESSION_ID:    sessionId,
    },
    encoding: 'utf8',
    timeout: 5000,
  });

  return {
    stdout:   result.stdout || '',
    stderr:   result.stderr || '',
    exitCode: result.status ?? -1,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nCost-Tracker Tests\n' + '='.repeat(40));

// Sonnet pricing: $15/MTok output → 1M tokens = $15
// $1 cost = ~66,667 output tokens
// $6 cost = ~400,000 output tokens

// Test 1: Silent when below all thresholds, short session
{
  const sandbox = makeSandbox();
  try {
    writeSessionJSONL(sandbox, 'sess-1', { outputTokens: 10000, durationMinutes: 5 });
    const { stdout } = runCostTracker(sandbox, 'sess-1', null);
    if (stdout.trim() === '') pass('silent below threshold, short session');
    else fail('silent below threshold, short session', `unexpected output: ${stdout.trim()}`);
  } finally { cleanup(sandbox); }
}

// Test 2: Phase-length warning fires when duration >= 35 min (no prior state)
{
  const sandbox = makeSandbox();
  try {
    writeSessionJSONL(sandbox, 'sess-2', { outputTokens: 10000, durationMinutes: 38 });
    const { stdout } = runCostTracker(sandbox, 'sess-2', null);
    if (stdout.includes('[phase]')) pass('phase-length warning fires at 38 min (first time)');
    else fail('phase-length warning fires at 38 min (first time)', `no [phase] in: ${JSON.stringify(stdout)}`);
  } finally { cleanup(sandbox); }
}

// Test 3: Phase-length warning does NOT fire twice for same session
{
  const sandbox = makeSandbox();
  try {
    writeSessionJSONL(sandbox, 'sess-3', { outputTokens: 10000, durationMinutes: 40 });
    const state = { lastCheckMs: 0, sessionId: 'sess-3', lastThresholdIndex: -1, phaseLengthWarned: true };
    const { stdout } = runCostTracker(sandbox, 'sess-3', state);
    if (!stdout.includes('[phase]')) pass('phase-length warning suppressed for same session (phaseLengthWarned=true)');
    else fail('phase-length warning suppressed', 'fired again when phaseLengthWarned=true');
  } finally { cleanup(sandbox); }
}

// Test 4: Phase-length warning fires for a new session even if prior session was warned
{
  const sandbox = makeSandbox();
  try {
    writeSessionJSONL(sandbox, 'sess-4-new', { outputTokens: 10000, durationMinutes: 36 });
    const state = { lastCheckMs: 0, sessionId: 'sess-4-old', lastThresholdIndex: -1, phaseLengthWarned: true };
    const { stdout } = runCostTracker(sandbox, 'sess-4-new', state);
    if (stdout.includes('[phase]')) pass('phase-length warning resets for new session');
    else fail('phase-length warning resets for new session', `no [phase] in: ${JSON.stringify(stdout)}`);
  } finally { cleanup(sandbox); }
}

// Test 5: Cost threshold alert fires when cost crosses $5 (~333K output tokens)
{
  const sandbox = makeSandbox();
  try {
    writeSessionJSONL(sandbox, 'sess-5', { outputTokens: 400000, durationMinutes: 10 });
    const { stdout } = runCostTracker(sandbox, 'sess-5', null);
    if (stdout.includes('[cost]') || stdout.includes('[usage]')) pass('cost threshold alert fires at $6');
    else fail('cost threshold alert fires at $6', `no [cost]/[usage] in: ${JSON.stringify(stdout)}`);
  } finally { cleanup(sandbox); }
}

// Test 6: No duplicate threshold alert for same threshold
{
  const sandbox = makeSandbox();
  try {
    writeSessionJSONL(sandbox, 'sess-6', { outputTokens: 440000, durationMinutes: 12 });
    // Already at threshold index 0 ($5), still under $15 (index 1)
    const state = { lastCheckMs: 0, sessionId: 'sess-6', lastThresholdIndex: 0, phaseLengthWarned: false };
    const { stdout } = runCostTracker(sandbox, 'sess-6', state);
    const hasCost  = stdout.includes('[cost]') || stdout.includes('[usage]');
    const hasPhase = stdout.includes('[phase]');
    if (!hasCost && !hasPhase) pass('no duplicate threshold alert for same threshold');
    else fail('no duplicate threshold alert', `unexpected output: ${stdout.trim()}`);
  } finally { cleanup(sandbox); }
}

// Test 7: Phase warning and threshold alert appear together
{
  const sandbox = makeSandbox();
  try {
    // $16 cost (~1.07M output tokens) at 37 minutes — crosses $15 threshold AND phase warning
    writeSessionJSONL(sandbox, 'sess-7', { outputTokens: 1070000, durationMinutes: 37 });
    // Prior state: already at $5 threshold (index 0), not yet warned for phase
    const state = { lastCheckMs: 0, sessionId: 'sess-7', lastThresholdIndex: 0, phaseLengthWarned: false };
    const { stdout } = runCostTracker(sandbox, 'sess-7', state);
    const hasCost  = stdout.includes('[cost]') || stdout.includes('[usage]');
    const hasPhase = stdout.includes('[phase]');
    if (hasCost && hasPhase) pass('phase warning and threshold alert appear together');
    else fail('phase warning and threshold alert appear together',
      `hasCost=${hasCost} hasPhase=${hasPhase} output=${JSON.stringify(stdout)}`);
  } finally { cleanup(sandbox); }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All cost-tracker tests pass.');
  process.exit(0);
}

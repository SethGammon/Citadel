#!/usr/bin/env node

/**
 * Circuit Breaker — PostToolUseFailure + PostToolUse Hook
 *
 * Two modes:
 * 1. PostToolUseFailure: tracks consecutive tool failures. After 3 failures,
 *    injects a message suggesting a different approach. After 5 trips in a
 *    session, escalates to a hard "stop and rethink" message.
 * 2. PostToolUse (Bash only): checks last-command-result.json for commands
 *    that exceeded the hang threshold (default 300s from harness.json
 *    agentTimeouts.command). Treats long-running commands as soft failures.
 *
 * State file: .claude/circuit-breaker-state.json
 * Counter resets when the threshold is hit (self-contained state).
 */

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const CITADEL_UI = process.env.CITADEL_UI === 'true';

function hookOutput(hookName, action, message, data = {}) {
  if (CITADEL_UI) {
    process.stdout.write(JSON.stringify({
      hook: hookName,
      action,
      message,
      timestamp: new Date().toISOString(),
      data,
    }));
  } else {
    process.stdout.write(message);
  }
}

const PLUGIN_DATA_DIR = health.PLUGIN_DATA_DIR;
const PROJECT_ROOT = health.PROJECT_ROOT;
const STATE_FILE = path.join(PLUGIN_DATA_DIR, 'circuit-breaker-state.json');
const LEGACY_STATE_FILE = path.join(PROJECT_ROOT, '.claude', 'circuit-breaker-state.json');
const THRESHOLD = 3;
const LAST_CMD_RESULT = path.join(PROJECT_ROOT, '.planning', 'telemetry', 'last-command-result.json');

function getHangThreshold() {
  try {
    const harnessPath = path.join(PROJECT_ROOT, '.claude', 'harness.json');
    if (fs.existsSync(harnessPath)) {
      const harness = JSON.parse(fs.readFileSync(harnessPath, 'utf8'));
      const t = harness?.agentTimeouts?.command;
      if (typeof t === 'number' && t > 0) return t;
    }
  } catch { /* fall through */ }
  return 300; // default: 5 minutes
}

function readState() {
  // Try PLUGIN_DATA_DIR first, fall back to legacy .claude/ location
  const stateFile = fs.existsSync(STATE_FILE) ? STATE_FILE
    : fs.existsSync(LEGACY_STATE_FILE) ? LEGACY_STATE_FILE
    : null;
  try {
    if (stateFile) return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch { /* fall through */ }
  return { consecutiveFailures: 0, lifetimeTrips: 0, lastFailedTool: null, lastFailureTime: null };
}

function writeState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpFile = STATE_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, STATE_FILE);
}

/**
 * Handle PostToolUseFailure: track consecutive failures, trip on threshold.
 */
function handleFailure(event) {
  const toolName = event.tool_name || 'unknown';
  const error = (event.error || event.tool_error || '').toString().slice(0, 200);

  health.increment('circuit-breaker', 'count');

  const state = readState();
  state.consecutiveFailures += 1;
  state.lastFailedTool = toolName;
  state.lastFailureTime = new Date().toISOString();
  state.lastError = error || null;

  writeState(state);

  if (state.consecutiveFailures >= THRESHOLD) {
    health.increment('circuit-breaker', 'trips');
    const lifetimeTrips = (state.lifetimeTrips || 0) + 1;
    // Reset consecutive counter, preserve lifetime trips
    writeState({
      consecutiveFailures: 0,
      lifetimeTrips,
      lastFailedTool: null,
      lastFailureTime: null,
      lastError: null,
    });

    const lines = [
      `[Circuit Breaker] The "${toolName}" tool has failed ${THRESHOLD} times in a row (trip #${lifetimeTrips} this session).`,
      error ? `  Error: ${error}` : null,
      `  What this means: Citadel detected a repeated failure pattern and is suggesting you change approach.`,
    ];

    if (lifetimeTrips >= 5) {
      lines.push(
        ``,
        `  WARNING: ${lifetimeTrips} trips this session. You are stuck in a failure loop.`,
        `  STOP trying variations of the same approach. Step back and:`,
        `  1. Re-read the relevant files from scratch — something may have changed`,
        `  2. Consider whether the approach is fundamentally wrong`,
        `  3. Try a completely different strategy, not a minor variation`,
        `  4. If stuck: describe the problem to the user and ask for guidance`,
      );
    } else {
      lines.push(
        ``,
        `  Try a different approach:`,
        `  - "${toolName}" + Edit/Write failing? Re-read the file first — content may have changed`,
        `  - "${toolName}" + Bash failing? Check if a prerequisite step was missed`,
        `  - "${toolName}" + Grep/Glob failing? Try broader patterns or different paths`,
        `  - Same tool keeps failing? Switch to an alternative tool or approach`,
      );
    }

    const msg = lines.filter(Boolean).join('\n');
    hookOutput('circuit-breaker', 'warned', msg, {
      consecutiveFailures: THRESHOLD,
      lifetimeTrips,
      lastFailedTool: toolName,
      lastError: error || null,
    });
  }
}

/**
 * Handle PostToolUse for Bash: check last-command-result.json for hangs.
 * Only fires a warning -- does not trip the breaker or block execution.
 */
function handleBashHangCheck() {
  try {
    if (!fs.existsSync(LAST_CMD_RESULT)) return;

    const result = JSON.parse(fs.readFileSync(LAST_CMD_RESULT, 'utf8'));

    // Only check recent results (within last 10 seconds -- this run)
    const resultAge = Date.now() - new Date(result.timestamp).getTime();
    if (resultAge > 10000) return;

    const threshold = getHangThreshold();
    const duration = result.durationSec || 0;

    if (result.timedOut) {
      health.increment('circuit-breaker', 'hangs');
      const state = readState();
      state.consecutiveFailures += 1;
      state.lastFailedTool = 'Bash (timeout)';
      state.lastFailureTime = new Date().toISOString();
      state.lastError = `Command killed after ${result.timeoutLimit}s: ${(result.command || '').slice(0, 100)}`;
      writeState(state);

      hookOutput('circuit-breaker', 'warned',
        `[Circuit Breaker] Command timed out after ${result.timeoutLimit}s and was killed.\n` +
        `  Command: ${(result.command || '').slice(0, 150)}\n` +
        `  This is a hard timeout. The command was terminated.\n` +
        `  Consider: Is this command expected to take this long? If not, check for hangs.`,
        { timedOut: true, command: result.command, duration: result.timeoutLimit }
      );
    } else if (duration > threshold) {
      health.increment('circuit-breaker', 'hangs');
      const state = readState();
      state.consecutiveFailures += 1;
      state.lastFailedTool = 'Bash (slow)';
      state.lastFailureTime = new Date().toISOString();
      state.lastError = `Command ran for ${duration}s (threshold: ${threshold}s): ${(result.command || '').slice(0, 100)}`;
      writeState(state);

      hookOutput('circuit-breaker', 'warned',
        `[Circuit Breaker] Command ran for ${duration}s (threshold: ${threshold}s). ` +
        `This may indicate a hang. Consider adding a timeout to the command.\n` +
        `  Command: ${(result.command || '').slice(0, 150)}\n` +
        `  Use: node scripts/run-with-timeout.js ${threshold} <command>`,
        { slow: true, command: result.command, duration, threshold }
      );
    }
  } catch {
    // Non-fatal -- don't break the hook pipeline over telemetry reads
  }
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event;
    try {
      event = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const toolName = event.tool_name || 'unknown';

    // Detect which hook event triggered us
    // PostToolUseFailure always has error/tool_error; PostToolUse for Bash hang check
    const isFailure = !!(event.error || event.tool_error);

    if (isFailure) {
      handleFailure(event);
    } else if (toolName === 'Bash') {
      handleBashHangCheck();
    }
    // For non-Bash PostToolUse success, do nothing (no overhead)

    process.exit(0);
  });
}

main();

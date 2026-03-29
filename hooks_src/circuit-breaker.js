#!/usr/bin/env node

/**
 * Circuit Breaker — PostToolUseFailure Hook
 *
 * Tracks consecutive tool failures. After 3 failures, injects a message
 * suggesting a different approach. After 5 trips in a session, escalates
 * to a hard "stop and rethink" message.
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
const STATE_FILE = path.join(PLUGIN_DATA_DIR, 'circuit-breaker-state.json');
const LEGACY_STATE_FILE = path.join(health.PROJECT_ROOT, '.claude', 'circuit-breaker-state.json');
const THRESHOLD = 3;

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

    process.exit(0);
  });
}

main();

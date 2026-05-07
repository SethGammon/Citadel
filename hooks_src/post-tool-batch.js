#!/usr/bin/env node

/**
 * post-tool-batch.js — PostToolBatch hook
 *
 * Fires once after ALL parallel tool calls in a turn's wave settle.
 * More efficient than per-tool quality checks — fires once per reasoning
 * step rather than once per tool.
 *
 * Design:
 *   - Lightweight: <100ms budget (fires frequently mid-turn)
 *   - Fail-safe: always exit 0 (never blocks the turn)
 *   - Telemetry: logs wave boundaries for turn reconstruction
 *   - AdditionalContext: surfaces typecheck failures from the wave into
 *     Claude's context window so they're visible without forcing a Stop
 *
 * For heavy checks (full typecheck, test runs), use quality-gate.js on
 * Stop with asyncRewake: true.
 *
 * Exit codes:
 *   0 = always (wave checkpoint, never blocks)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;
const CITADEL_UI = process.env.CITADEL_UI === 'true';

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let event = {};
    try { event = JSON.parse(input); } catch { /* partial input ok */ }

    const agentId = event.agent_id || null;
    const agentType = event.agent_type || null;
    const sessionId = event.session_id || null;

    health.increment('post-tool-batch', 'count');

    health.logTiming('post-tool-batch', 0, {
      event: 'wave-settled',
      agent_id: agentId,
      agent_type: agentType,
      session_id: sessionId,
    });

    // Scan recent post-edit telemetry to find wave-level signals
    const signals = collectWaveSignals();

    if (signals.length > 0) {
      const contextMsg = `[post-tool-batch] wave check:\n${signals.map(s => `  ${s}`).join('\n')}`;

      if (CITADEL_UI) {
        process.stdout.write(JSON.stringify({
          hook: 'post-tool-batch',
          action: 'wave-check',
          message: contextMsg,
          timestamp: new Date().toISOString(),
          data: { signals },
        }));
      } else {
        // Inject quality signals directly into Claude's context window
        process.stdout.write(JSON.stringify({ additionalContext: contextMsg }));
      }
    }

    process.exit(0);
  });
}

/**
 * Read the last 20 hook-timing entries and surface anything from the
 * last 30 seconds that Claude should know about.
 *
 * Surfaces:
 *   - Typecheck failures from post-edit (exits 2) in this wave
 *   - Large wave size (>3 files modified) as a summary
 */
function collectWaveSignals() {
  const signals = [];

  try {
    const timingPath = path.join(PROJECT_ROOT, '.planning', 'telemetry', 'hook-timing.jsonl');
    if (!fs.existsSync(timingPath)) return signals;

    const lines = fs.readFileSync(timingPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-20);

    const recentEdits = new Set();
    const now = Date.now();
    const WAVE_WINDOW_MS = 30000;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.hook !== 'post-edit') continue;
        const entryTime = new Date(entry.timestamp).getTime();
        if (now - entryTime > WAVE_WINDOW_MS) continue;

        if (entry.file) recentEdits.add(entry.file);

        if (entry.typecheck === 'fail') {
          signals.push(`typecheck: FAIL in ${entry.file}`);
        }
      } catch { continue; }
    }

    if (recentEdits.size > 3) {
      const fileList = [...recentEdits].slice(0, 3).join(', ');
      const overflow = recentEdits.size > 3 ? ` (+${recentEdits.size - 3} more)` : '';
      signals.push(`wave: ${recentEdits.size} files modified — ${fileList}${overflow}`);
    }
  } catch { /* fail-safe: never block */ }

  return signals;
}

main();

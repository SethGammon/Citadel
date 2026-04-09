#!/usr/bin/env node

/**
 * momentum-read.cjs — Read momentum.json and print the formatted context block.
 *
 * Called by Fleet Commander at session start (Step 1) to inject prior
 * session context into Wave 1 agents. Read-only — does NOT update momentum.json.
 * To update momentum, use momentum-synthesize.cjs after session completion.
 *
 * Usage:
 *   node .citadel/scripts/momentum-read.cjs
 *
 * Exits 0 with output when momentum exists.
 * Exits 0 with no output when momentum.json is missing or empty.
 */

'use strict';

const { readMomentum, formatMomentumContext } = require('../core/momentum/synthesizer');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function main() {
  const momentum = readMomentum(PROJECT_ROOT);
  const ctx = formatMomentumContext(momentum);
  if (ctx) process.stdout.write(ctx + '\n');
}

main();

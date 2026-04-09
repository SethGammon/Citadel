#!/usr/bin/env node

/**
 * momentum-synthesize.cjs — Synthesize cross-session discoveries into momentum.json.
 *
 * Reads all .planning/discoveries/*.jsonl records and produces
 * .planning/momentum.json with:
 *   - Active work scopes (recency + frequency weighted)
 *   - Recurring decisions (seen in multiple sessions)
 *   - Recent failures (anti-patterns to avoid)
 *   - Recent handoff items (what was recently built)
 *
 * Fleet calls this after every session completes. Fleet also reads momentum.json
 * at session start to inject prior context into Wave 1 agents.
 *
 * Usage:
 *   node .citadel/scripts/momentum-synthesize.cjs
 *   node .citadel/scripts/momentum-synthesize.cjs --print   # also print formatted context block
 */

'use strict';

const { writeMomentum, formatMomentumContext } = require('../core/momentum/synthesizer');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function main() {
  const printContext = process.argv.includes('--print');
  const { file, momentum } = writeMomentum(PROJECT_ROOT);
  console.log(`Momentum updated: ${momentum.discovery_count} discoveries → ${file}`);

  if (printContext) {
    const ctx = formatMomentumContext(momentum);
    if (ctx) {
      process.stdout.write('\n' + ctx + '\n');
    } else {
      console.log('(no momentum context yet — need more discoveries)');
    }
  }
}

main();

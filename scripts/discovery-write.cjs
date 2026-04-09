#!/usr/bin/env node

/**
 * discovery-write.cjs — Write a structured agent discovery record to the persistent store.
 *
 * Called by Fleet Commander after each agent completes. Records accumulate
 * across sessions and are synthesized by momentum-synthesize.cjs into a
 * cross-session context signal.
 *
 * Usage:
 *   node .citadel/scripts/discovery-write.cjs \
 *     --session "fleet-auth-refactor" \
 *     --agent "api-auth-builder" \
 *     --wave 1 \
 *     --status "success" \
 *     --scope "src/api/auth/" \
 *     --handoff '["Built JWT middleware", "Wired auth routes"]' \
 *     --decisions '["Used jose library over jsonwebtoken"]' \
 *     --files '["src/api/auth/middleware.ts"]' \
 *     --failures '[]'
 *
 * --scope accepts comma-separated directory paths.
 * --handoff, --decisions, --files, --failures accept JSON arrays.
 */

'use strict';

const { writeDiscovery, parseArgs } = require('../core/fleet/discovery-writer');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function main() {
  const args = parseArgs(process.argv);
  const { file, record } = writeDiscovery(PROJECT_ROOT, args);
  console.log(`Discovery written: ${record.agent} (wave ${record.wave ?? '?'}) → ${file}`);
}

main();

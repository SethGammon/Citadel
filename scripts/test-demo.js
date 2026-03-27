#!/usr/bin/env node
/**
 * test-demo.js — Demo page embarrassment check
 *
 * Extracts the routing logic from docs/index.html and verifies:
 *   1. All generator POOLS examples route to the tier/color they advertise
 *   2. All how-section examples route to the tier/color they advertise
 *   3. Spot-checks common "obviously wrong" inputs (regression guard)
 *
 * Run: node scripts/test-demo.js
 * Exit 0 = clean, Exit 1 = embarrassing bugs found
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const HTML_PATH = path.resolve(__dirname, '..', 'docs', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

// ── Extract routing JS from HTML ──────────────────────────────────────────────

function extractBetween(src, startMarker, endMarker) {
  let si = src.indexOf(startMarker);
  if (si === -1) return null;
  si = src.indexOf('\n', si); // skip past the comment line's trailing chars
  const ei = src.indexOf(endMarker, si);
  if (ei === -1) return null;
  return src.slice(si + 1, ei);
}

// TIER0, TIER2, TIER3, and route() live between these two comment anchors
const routeBlock = extractBetween(html, '// ─── Routing logic ─', '// ─── Live preview ─');
if (!routeBlock) {
  console.error('FATAL: Could not locate routing block in docs/index.html');
  process.exit(1);
}

let route, POOLS;
try {
  route = new Function(routeBlock + '\nreturn route;')();
} catch (e) {
  console.error('FATAL: Could not eval routing block:', e.message);
  process.exit(1);
}

// POOLS lives nearby — find it
const poolsBlock = extractBetween(html, 'const POOLS = {', '};');
if (!poolsBlock) {
  console.error('FATAL: Could not locate POOLS in docs/index.html');
  process.exit(1);
}
try {
  POOLS = new Function('return {' + poolsBlock + '};')();
} catch (e) {
  console.error('FATAL: Could not eval POOLS:', e.message);
  process.exit(1);
}

// ── Expected tier per generator category ─────────────────────────────────────

// Pool keys map to the tier/color they should all route to
const POOL_EXPECTATIONS = {
  instant:  { tier: 0, color: 'var(--green)',  label: 'Tier 0 Direct Edit' },
  skill:    { tier: 2, color: 'var(--cyan)',    label: 'Tier 2 Skill'       },
  fleet:    { tier: 3, color: 'var(--purple)',  label: 'Tier 3 /fleet'      },
  campaign: { tier: 3, color: 'var(--orange)',  label: 'Tier 3 /archon'     },
};

// ── How-section examples ──────────────────────────────────────────────────────
// Parse data-cmd attributes and their expected color from style="--ex-color:..."

// Attributes appear in either order in the HTML, so match both
const HOW_EXAMPLE_RE = /(?:data-cmd="([^"]+)"[^>]*style="--ex-color:([^"]+)"|style="--ex-color:([^"]+)"[^>]*data-cmd="([^"]+)")/g;
const howExamples = [];
let m;
while ((m = HOW_EXAMPLE_RE.exec(html)) !== null) {
  // Groups 1+2 = data-cmd first; groups 4+3 = style first
  const cmd   = (m[1] || m[4]).trim();
  const color = (m[2] || m[3]).trim();
  howExamples.push({ cmd, expectedColor: color });
}

// ── Spot-check regressions ────────────────────────────────────────────────────
// Hard-coded sanity cases: [input, expectedTool, expectedColor, description]
const SPOT_CHECKS = [
  // Tier 0 — should be Direct Edit (green)
  ['typecheck',              'Direct Edit', 'var(--green)',  '"typecheck" → Tier 0'],
  ['build',                  'Direct Edit', 'var(--green)',  '"build" alone → Tier 0'],
  ['commit my changes',      'Direct Edit', 'var(--green)',  '"commit" → Tier 0'],
  ['rename Foo to Bar',      'Direct Edit', 'var(--green)',  '"rename X to Y" → Tier 0'],
  // Tier 3 Archon (orange) — common create-app shapes
  ['build me a recipe app',  '/archon',     'var(--orange)', '"build me a recipe app" → Archon'],
  ['build a recipe app',     '/archon',     'var(--orange)', '"build a recipe app" → Archon'],
  ['create a real-time chat feature',        '/archon', 'var(--orange)', '"create a real-time chat feature" → Archon'],
  ['create a real-time notification system', '/archon', 'var(--orange)', '"create a real-time notification system" → Archon'],
  ['make a todo app',        '/archon',     'var(--orange)', '"make a todo app" → Archon'],
  ['generate a SaaS tool',   '/archon',     'var(--orange)', '"generate a SaaS tool" → Archon'],
  // Tier 3 /marshal (purple) — add/implement
  ['add a dark mode toggle', '/create-app', 'var(--orange)', '"add a dark mode toggle" → create-app (orange)'],
  // Tier 2 — skill keyword hits (cyan)
  ['review this code',       '/review',     'var(--cyan)',   '"review" → Tier 2 skill'],
  ['generate tests',         '/test-gen',   'var(--cyan)',   '"generate tests" → Tier 2 skill'],
];

// ── Run checks ────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
const failures = [];

function check(cmd, expectedColor, expectedTool, label, source) {
  const result = route(cmd);
  const colorOk = result.color === expectedColor;
  const toolOk  = !expectedTool || result.tool === expectedTool;
  if (colorOk && toolOk) {
    pass++;
  } else {
    fail++;
    const got = `${result.tool} ${result.color}`;
    const want = `${expectedTool || '?'} ${expectedColor}`;
    failures.push(`  ✗ [${source}] "${cmd}"\n    got:  ${got}\n    want: ${want}\n    → ${label}`);
  }
}

// Pool checks
for (const [pool, exp] of Object.entries(POOL_EXPECTATIONS)) {
  const items = POOLS[pool];
  if (!items) { console.warn(`WARN: POOLS.${pool} not found — skipping`); continue; }
  for (const cmd of items) {
    check(cmd, exp.color, null, exp.label, `pool:${pool}`);
  }
}

// How-section example checks
for (const { cmd, expectedColor } of howExamples) {
  check(cmd, expectedColor, null, `how-section expects ${expectedColor}`, 'how-section');
}

// Spot-check regressions
for (const [cmd, tool, color, desc] of SPOT_CHECKS) {
  check(cmd, color, tool, desc, 'spot-check');
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\nDemo page routing check');
console.log('='.repeat(40));
console.log(`  Pool examples:     ${Object.values(POOLS).flat().length}`);
console.log(`  How-section cards: ${howExamples.length}`);
console.log(`  Spot-checks:       ${SPOT_CHECKS.length}`);
console.log('');

if (fail === 0) {
  console.log(`  ✓ All ${pass} checks pass — nothing embarrassing found.\n`);
  process.exit(0);
} else {
  console.log(`  ${pass} passed, ${fail} FAILED\n`);
  for (const f of failures) console.log(f);
  console.log('\nFix the routing rules in docs/index.html before shipping.\n');
  process.exit(1);
}

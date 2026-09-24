#!/usr/bin/env node

/**
 * test-quality-gate.js -- Offline tests for quality-gate inline suppression.
 *
 * Verifies the <!-- citadel:ignore ... --> marker contract:
 *   (a) named lenses are filtered per file while other lenses still run
 *   (b) a bare marker disables every lens for that file
 *   (c) comma and space separated lists both parse
 *   (d) files without a marker are unaffected
 *   (e) the cross-reference lens itself is unchanged (marker lives upstream)
 *
 * Stdlib only. No network, no LLM.
 *
 * Usage: node scripts/test-quality-gate.js
 */

'use strict';

// quality-gate reads harness.json via harness-health-util, which requires a
// resolvable runtime. Pin one so dual-marker checkouts stay hermetic.
process.env.CITADEL_RUNTIME = 'claude-code';

const path = require('path');
const {
  parseInlineIgnores,
  selectColdPathLenses,
  lensCrossReference,
} = require(path.join(__dirname, '..', 'hooks_src', 'quality-gate.js'));

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

console.log('quality-gate inline suppression tests\n');

const refDoc = 'See `planned/feature.ts` for the design.';
const markedDoc = '<!-- citadel:ignore cross-reference -->\n' + refDoc;
const bareMarkedDoc = '<!-- citadel:ignore -->\n' + refDoc;
const multiMarkedDoc = '<!-- citadel:ignore cross-reference, secrets -->\n' + refDoc;

const withMarker = selectColdPathLenses('docs/plan.md', markedDoc);
check('named marker drops only that lens',
  !withMarker.includes('cross-reference') && withMarker.includes('contractual'),
  JSON.stringify(withMarker));

const withoutMarker = selectColdPathLenses('docs/plan.md', refDoc);
check('unmarked file keeps all lenses',
  withoutMarker.includes('cross-reference') && withoutMarker.includes('contractual'),
  JSON.stringify(withoutMarker));

check('bare marker disables every lens',
  selectColdPathLenses('docs/plan.md', bareMarkedDoc).length === 0);

check('comma-separated list parses',
  parseInlineIgnores(multiMarkedDoc).has('cross-reference')
  && parseInlineIgnores(multiMarkedDoc).has('secrets'));

check('space-separated list parses',
  parseInlineIgnores('<!-- citadel:ignore cross-reference secrets -->').has('secrets'));

check('unrelated comment is ignored',
  parseInlineIgnores('<!-- ignore this -->' + refDoc).size === 0);

check('lens itself still reports missing refs',
  lensCrossReference('docs/plan.md', refDoc).length === 1,
  'marker must filter at dispatch, not inside the lens');

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed.');

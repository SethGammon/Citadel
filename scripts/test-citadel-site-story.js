'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
const contract = fs.readFileSync(path.join(root, 'docs', 'interactive-story-contract.md'), 'utf8');

const checks = [
  ['story section exists', html.includes('id="product-story"')],
  ['campaign scenario exists', html.includes('data-story-scenario="campaign"')],
  ['review scenario exists', html.includes('data-story-scenario="review"')],
  ['fleet scenario exists', html.includes('data-story-scenario="fleet"')],
  ['evidence challenge exists', html.includes('data-story-scenario="evidence"') && html.includes('expected source absent')],
  ['deploy replay exists', html.includes('data-story-scenario="deploy"') && html.includes('waitingEvents: 59')],
  ['repository inspector exists', html.includes('aria-label="Repository state inspector"')],
  ['playback controls exist', ['story-prev', 'story-play', 'story-next', 'story-reset'].every(id => html.includes(`id="${id}"`))],
  ['fresh session step exists', html.includes('fresh process restored')],
  ['unknown evidence state exists', html.includes('production-source  UNKNOWN')],
  ['fleet worktrees exist', html.includes('wt-fleet-api') && html.includes('wt-fleet-components') && html.includes('wt-fleet-utils')],
  ['reduced motion participates in playback', html.includes("prefers-reduced-motion: reduce")],
  ['mobile story layout exists', html.includes('.story-layout { grid-template-columns: 1fr; }')],
  ['experience contract names all acceptance questions', (contract.match(/^\d+\. /gm) || []).length >= 7],
  ['public story copy contains no em dash', !html.slice(html.indexOf('<section class="story-section"'), html.indexOf('<!-- Vertical tier cascade -->')).includes('—')]
];

for (const [name, pass] of checks) {
  assert.equal(pass, true, name);
  console.log(`PASS ${name}`);
}

console.log(`Citadel site story contract passed: ${checks.length}/${checks.length}`);

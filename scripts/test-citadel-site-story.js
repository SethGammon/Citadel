'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
const contract = fs.readFileSync(path.join(root, 'docs', 'interactive-story-contract.md'), 'utf8');

const checks = [
  ['story section exists', html.includes('id="product-story"')],
  ['hero shows the first-success path', html.includes('Citadel first-success path') && html.includes('/do next')],
  ['screen transition names its value', html.includes('See the work survive a session')],
  ['short screens remove the duplicate cue chevron', html.includes('.scroll-cue svg:last-child { display: none; }')],
  ['campaign scenario exists', html.includes('data-story-scenario="campaign"')],
  ['review scenario exists', html.includes('data-story-scenario="review"')],
  ['fleet scenario exists', html.includes('data-story-scenario="fleet"')],
  ['evidence challenge exists', html.includes('data-story-scenario="evidence"') && html.includes('expected source absent')],
  ['deploy replay exists', html.includes('data-story-scenario="deploy"') && html.includes('waitingEvents: 59')],
  ['proof gallery contains bounded receipts', (html.match(/class="proof-card"/g) || []).length === 6 && (html.match(/Boundary:/g) || []).length >= 6],
  ['proof gallery links resolve from docs root', html.includes('href="GOLDEN_PATH.md"') && html.includes('href="DASHBOARD_SPEC.md"') && !html.includes('href="docs/GOLDEN_PATH.md"')],
  ['runtime tabs treat Claude and Codex equally', html.includes('data-runtime="claude"') && html.includes('data-runtime="codex"') && html.includes('--runtime claude') && html.includes('--runtime codex')],
  ['first verified success is explicit', html.includes('/do review README.md') && html.includes('/do next')],
  ['keyboard arrow navigation covers tablists', html.includes("['ArrowLeft', 'ArrowRight']")],
  ['copy controls have visible feedback', html.includes("button.textContent = 'Copied'")],
  ['repository inspector exists', html.includes('aria-label="Repository state inspector"')],
  ['playback controls exist', ['story-prev', 'story-play', 'story-next', 'story-reset'].every(id => html.includes(`id="${id}"`))],
  ['fresh session step exists', html.includes('fresh process restored')],
  ['unknown evidence state exists', html.includes('production-source  UNKNOWN')],
  ['fleet worktrees exist', html.includes('wt-fleet-api') && html.includes('wt-fleet-components') && html.includes('wt-fleet-utils')],
  ['reduced motion participates in playback', html.includes("prefers-reduced-motion: reduce")],
  ['mobile story layout exists', html.includes('.story-layout { grid-template-columns: 1fr; }')],
  ['mobile router choices use a horizontal rail', html.includes('scroll-snap-type: x proximity') && html.includes('.gen-btn { flex: 0 0 150px;')],
  ['experience contract names all acceptance questions', (contract.match(/^\d+\. /gm) || []).length >= 7],
  ['public story copy contains no em dash', !html.slice(html.indexOf('<section class="story-section"'), html.indexOf('<!-- Vertical tier cascade -->')).includes('—')]
  ,['fallback documentation links are real', html.includes('href="CAMPAIGNS.md"') && html.includes('href="CLAUDE_INSTALLATION_GUIDE.md"')]
  ,['public skill count is current', html.includes('Skills  -  49 built in') && !html.includes('Skills  -  45 installed')]
  ,['public proof and install copy contains no em dash', !html.slice(html.indexOf('<section class="proof-section"'), html.indexOf('<!-- Final CTA')).includes('—')]
  ,['site remains under declared 250KB source budget', Buffer.byteLength(html, 'utf8') < 250 * 1024]
  ,['animated stats preserve the published values', html.includes('const targets = [49, 4, 29, 2]') && !html.includes('const targets = [33, 4, 14, 0]')]
];

for (const [name, pass] of checks) {
  assert.equal(pass, true, name);
  console.log(`PASS ${name}`);
}

console.log(`Citadel site story contract passed: ${checks.length}/${checks.length}`);

#!/usr/bin/env node

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dashboard', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dashboard', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'dashboard', 'app.js'), 'utf8');

function block(pattern, label) {
  const match = css.match(pattern);
  assert(match, `${label} is missing`);
  return match[1];
}

function variable(text, name) {
  const match = text.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert(match, `--${name} is missing`);
  return match[1].trim();
}

const dark = block(/:root\s*\{([\s\S]*?)\}/, 'dark tokens');
const light = block(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{([\s\S]*?)\}\s*\}/, 'light tokens');
const mobile = block(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)\}\s*\n\}/, 'mobile layout');

const actualBaselines = [
  { theme: 'dark', width: 1440, bg: variable(dark, 'bg'), panel: variable(dark, 'panel'), columns: '220px 1fr' },
  { theme: 'light', width: 1440, bg: variable(light, 'bg'), panel: variable(light, 'panel'), columns: '220px 1fr' },
  { theme: 'dark', width: 380, bg: variable(dark, 'bg'), panel: variable(dark, 'panel'), columns: '1fr' },
  { theme: 'light', width: 380, bg: variable(light, 'bg'), panel: variable(light, 'panel'), columns: '1fr' },
];

assert.deepEqual(actualBaselines, [
  { theme: 'dark', width: 1440, bg: '#0d1117', panel: '#161b22', columns: '220px 1fr' },
  { theme: 'light', width: 1440, bg: '#f6f8fa', panel: '#ffffff', columns: '220px 1fr' },
  { theme: 'dark', width: 380, bg: '#0d1117', panel: '#161b22', columns: '1fr' },
  { theme: 'light', width: 380, bg: '#f6f8fa', panel: '#ffffff', columns: '1fr' },
]);
assert(/\.app\s*\{[^}]*grid-template-columns:\s*220px 1fr/s.test(css));
assert(/\.app\s*\{\s*grid-template-columns:\s*1fr/s.test(mobile));
assert(/@media\s*\(max-width:\s*460px\)/.test(css), '380px compact breakpoint is missing');
assert(/prefers-reduced-motion:\s*reduce/.test(css) && /transition:\s*none\s*!important/.test(css), 'reduced-motion override is missing');
assert(html.includes('name="viewport"') && html.includes('id="keyboard-help"'));
for (const key of ["event.key === '?'", "event.key === 'j'", "event.key === 'k'", "event.key === 'Enter'"]) {
  assert(app.includes(key), `keyboard contract missing ${key}`);
}
assert(app.includes('focus({ preventScroll: true })'), 'keyboard selection must move focus');
assert(!/setInterval\s*\(/.test(app), 'browser bundle must use SSE, not polling');

const sourceHash = crypto.createHash('sha256').update(html).update(css).update(app).digest('hex').slice(0, 16);
console.log(JSON.stringify({ schema: 1, kind: 'browserless-visual-contract', baselines: actualBaselines, source_hash: sourceHash }, null, 2));
console.log('dashboard visual, keyboard, responsive, and reduced-motion contracts passed');

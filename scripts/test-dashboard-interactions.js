#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  availableOperationActions,
  operationActionEffect,
  operationActionNeedsConfirmation,
  operationFeedback,
  forkComparisonLabel,
  forkSelectionAllowed,
} = require('../dashboard/app');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'dashboard', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dashboard', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'dashboard', 'index.html'), 'utf8');

assert.deepEqual(availableOperationActions({ status: 'running', capabilities: ['pause', 'stop', 'retry'] }),
  ['pause', 'stop']);
assert.deepEqual(availableOperationActions({ status: 'blocked', capabilities: ['resume', 'retry'] }),
  ['resume', 'retry']);
assert.deepEqual(availableOperationActions({ status: 'failed', capabilities: ['pause', 'retry'] }), ['retry']);
assert.deepEqual(availableOperationActions({ status: 'passed', capabilities: ['retry'] }), []);
assert.deepEqual(availableOperationActions({ status: 'running', capabilities: [] }), []);
assert.deepEqual(availableOperationActions({
  status: 'running', capabilities: ['pause'], pending_intent: { action: 'pause' },
}), [], 'an immutable pending intent must suppress duplicate UI actions');

assert.equal(operationActionNeedsConfirmation('stop'), true);
assert.equal(operationActionNeedsConfirmation('retry'), true);
assert.equal(operationActionNeedsConfirmation('pause'), false);
assert.equal(operationActionNeedsConfirmation('resume'), false);
for (const action of ['pause', 'resume', 'stop', 'retry']) {
  assert(operationActionEffect(action).startsWith('Next effect:'), `${action} must disclose its next effect`);
}
for (const outcome of ['pending', 'accepted', 'conflict', 'blocked', 'rejected', 'unknown']) {
  assert(operationFeedback(outcome).length > 20, `${outcome} feedback must be explicit`);
}
assert(operationFeedback('unknown').includes('No success is assumed'));
const forkFixture = { status: 'ready', comparison: { outcome: 'recommended', recommendation: 'branch-claude', branches: [
  { branch_id: 'branch-claude', comparable: true }, { branch_id: 'branch-codex', comparable: false },
] } };
assert.equal(forkSelectionAllowed(forkFixture, 'branch-claude'), true);
assert.equal(forkSelectionAllowed(forkFixture, 'branch-codex'), false);
assert.equal(forkComparisonLabel(forkFixture.comparison), 'Recommendation: branch-claude');
assert.equal(forkComparisonLabel({ outcome: 'insufficient-evidence' }), 'Insufficient evidence');

assert(app.includes("fetch('/api/control'"), 'UI must acquire the process nonce from same-origin control state');
assert(app.includes("fetch('/api/intents'"), 'UI must use the immutable intent endpoint');
assert(app.includes("fetch('/api/fork-selections'"), 'UI must use the typed fork selection endpoint');
assert(app.includes("'x-citadel-nonce': session.nonce"), 'UI must send the process nonce');
for (const field of ['operation_id', 'expected_revision', 'idempotency_key', 'actor', 'reason', 'capability', 'action']) {
  assert(new RegExp(`\\b${field}(?:\\s*:|\\s*[,}])`).test(app), `intent body must carry ${field}`);
}
const bodyBlock = app.match(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\),/);
assert(bodyBlock, 'typed intent body is missing');
assert(!/\bcommand\s*:/.test(bodyBlock[1]), 'intent body must never carry an arbitrary command');

assert(app.includes("capsule.setAttribute('role', 'alertdialog')"));
assert(app.includes("feedback.setAttribute('role', 'status')"));
assert(app.includes("feedback.setAttribute('aria-live', 'polite')"));
assert(app.includes("event.key === 'Escape' && activeConfirmation"));
assert(app.includes('trigger.focus()'), 'Escape and cancel must restore trigger focus');
assert(app.includes("el('button', 'control-button"), 'controls must use native keyboard-accessible buttons');
assert(app.includes('button.disabled = true'), 'controls must expose a pending disabled state');

assert(css.includes('.confirmation-capsule'));
assert(css.includes('.fork-branches'));
assert(css.includes('.fork-unknown'));
assert(css.includes('.control-button:focus-visible'));
assert(css.includes('.feedback-conflict'));
assert(css.includes('.feedback-blocked'));
assert(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
assert(/@media\s*\(max-width:\s*720px\)[\s\S]*\.operation-control\s*\{\s*grid-template-columns:\s*1fr/.test(css));
assert(/@media\s*\(max-width:\s*720px\)[\s\S]*\.fork-branches\s*\{\s*grid-template-columns:\s*1fr/.test(css));
assert(html.includes('immutable intents only'));
assert(html.includes('data-panel="forks"'));
assert(html.includes('<kbd>Esc</kbd>'));

process.stdout.write('Dashboard interaction semantics passed: state, risk, keyboard, feedback, and responsive contracts.\n');

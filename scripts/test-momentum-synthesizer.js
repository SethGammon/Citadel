#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeDiscovery } = require('../core/fleet/discovery-writer');
const { synthesize, writeMomentum, readMomentum, formatMomentumContext } = require('../core/momentum/synthesizer');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-momentum-'));
try {
  // --- Empty project → empty momentum ---
  const empty = synthesize(tempRoot);
  assert.equal(empty.discovery_count, 0);
  assert.deepEqual(empty.active_scopes, []);
  assert.deepEqual(empty.recurring_decisions, []);

  // --- Populate discoveries across two "sessions" ---
  writeDiscovery(tempRoot, {
    session: 'session-a',
    agent: 'builder-1',
    wave: 1,
    status: 'success',
    scope: ['src/api/auth/'],
    handoff_items: ['Built JWT middleware'],
    decisions: ['Used jose library over jsonwebtoken'],
    files_touched: ['src/api/auth/middleware.ts'],
    failures: [],
  });

  writeDiscovery(tempRoot, {
    session: 'session-b',
    agent: 'builder-2',
    wave: 1,
    status: 'success',
    scope: ['src/api/auth/', 'src/ui/'],
    handoff_items: ['Added login form'],
    decisions: ['Used jose library over jsonwebtoken'],  // same decision — should surface as recurring
    files_touched: ['src/ui/LoginForm.tsx'],
    failures: ['Could not find existing auth context'],
  });

  writeDiscovery(tempRoot, {
    session: 'session-a',
    agent: 'builder-3',
    wave: 2,
    status: 'partial',
    scope: ['src/ui/'],
    handoff_items: ['Wired auth context'],
    decisions: ['Import auth types from jose'],
    failures: [],
  });

  // --- synthesize ---
  const m = synthesize(tempRoot);
  assert.equal(m.schema, 1);
  assert.equal(m.discovery_count, 3);
  assert(typeof m.updated === 'string');

  // src/api/auth/ and src/ui/ should both be active scopes
  const scopeNames = m.active_scopes.map(s => s.scope);
  assert(scopeNames.includes('src/api/auth/'), 'auth scope should be active');
  assert(scopeNames.includes('src/ui/'), 'ui scope should be active');

  // jose decision appears in 2 records → recurring
  const decisions = m.recurring_decisions.map(d => d.decision);
  assert(decisions.some(d => d.includes('jose')), 'jose decision should appear as recurring');
  const joseDec = m.recurring_decisions.find(d => d.decision.includes('jose'));
  assert.equal(joseDec.count, 2);

  // failure from session-b should appear
  assert(m.recent_failures.length > 0, 'should have a recent failure');
  assert(m.recent_failures[0].failure.includes('auth context'), 'failure text should match');

  // handoffs
  assert(m.recent_handoffs.length === 3);

  // --- writeMomentum / readMomentum round-trip ---
  const { file } = writeMomentum(tempRoot);
  assert(fs.existsSync(file), 'momentum.json should exist');

  const loaded = readMomentum(tempRoot);
  assert.equal(loaded.discovery_count, 3);
  assert.equal(loaded.schema, 1);

  // --- formatMomentumContext ---
  const ctx = formatMomentumContext(loaded);
  assert(typeof ctx === 'string', 'context should be a string');
  assert(ctx.includes('=== PRIOR SESSION CONTEXT ==='), 'should have header');
  assert(ctx.includes('jose'), 'should mention recurring jose decision');
  assert(ctx.includes('auth context'), 'should mention recent failure');
  assert(ctx.includes('=== END PRIOR SESSION CONTEXT ==='), 'should have footer');

  // null momentum → null
  assert.equal(formatMomentumContext(null), null);
  // zero discoveries → null
  assert.equal(formatMomentumContext({ discovery_count: 0 }), null);

} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('momentum-synthesizer tests passed');

#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { bundleForSkill, bundleForRoute } = require('../core/config');
for (const name of ['do', 'dashboard', 'loop', 'daemon']) {
  const expected = bundleForSkill(name);
  assert(expected, 'Known skill needs an owner: ' + name);
  for (const id of ['citadel:' + name, '/citadel:' + name]) {
    assert.strictEqual(bundleForSkill(id), expected, 'Citadel namespace lost ownership: ' + id);
    assert.strictEqual(bundleForRoute(id), expected, 'Citadel route lost ownership: ' + id);
  }
}
for (const id of ['other:dashboard', 'citadel:not-a-skill', 'other:citadel:dashboard']) {
  assert.strictEqual(bundleForSkill(id), null, 'Foreign or unknown skill must remain unknown: ' + id);
}
console.log('Namespaced skill ownership passed.');
#!/usr/bin/env node

'use strict';

const assert = require('assert');
const path = require('path');

const claudeRuntime = require(path.join(__dirname, '..', 'runtimes', 'claude-code'));

assert.equal(claudeRuntime.runtime.id, 'claude-code', 'runtime id should be claude-code');
assert.equal(claudeRuntime.guidance.target.filePath, 'CLAUDE.md', 'Claude runtime guidance should target CLAUDE.md');
assert.equal(typeof claudeRuntime.installClaudeHooks, 'function', 'Claude runtime should expose hook installer');
assert.equal(typeof claudeRuntime.sessionTokens.readSessionTokens, 'function', 'Claude runtime should expose session token reader');
assert.equal(
  claudeRuntime.sessionTokens.normalizeModel('claude-opus-4-6-20250514'),
  'claude-opus-4-6',
  'Claude runtime should normalize dated model ids'
);
assert(claudeRuntime.sessionTokens.getPricing('claude-sonnet-4-6').input > 0, 'Claude runtime pricing should load');

console.log('claude runtime tests passed');

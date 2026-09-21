#!/usr/bin/env node

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateSchema } = require('./mcp-external-conformance');

const runner = path.join(__dirname, 'mcp-external-conformance.js');
const result = spawnSync(process.execPath, [runner, '--verify-manifest'], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8',
  timeout: 10000,
});

assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /5\/5 revisions and conformance boundary verified offline/);
assert.equal(result.stderr, '');

const validatorFixture = {
  $defs: {
    Result: {
      type: 'object',
      required: ['resultType', 'items'],
      additionalProperties: false,
      properties: {
        resultType: { const: 'complete' },
        items: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
      },
    },
  },
};
const fixtureSchema = { $ref: '#/$defs/Result' };
assert.deepStrictEqual(validateSchema(validatorFixture, fixtureSchema, { resultType: 'complete', items: ['ok', 1] }), []);
assert(validateSchema(validatorFixture, fixtureSchema, { items: ['ok'] }).some((error) => error.includes('missing required property resultType')));
assert(validateSchema(validatorFixture, fixtureSchema, { resultType: 'partial', items: [] }).some((error) => error.includes('const')));
assert(validateSchema(validatorFixture, fixtureSchema, { resultType: 'complete', items: [false] }).some((error) => error.includes('anyOf')));
assert(validateSchema(validatorFixture, fixtureSchema, { resultType: 'complete', items: [], extra: true }).some((error) => error.includes('unexpected property')));

process.stdout.write('MCP external conformance provenance pins passed offline validation.\n');

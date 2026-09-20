#!/usr/bin/env node

'use strict';

const assert = require('assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  MODERN_PROTOCOL_VERSION,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
  createHandshakeAdapter,
  createProtocolAdapter,
  validateJsonRpcRequest,
} = require('../mcp-servers/protocol-adapter');

const SERVER = Object.freeze({ name: 'adapter-fixture', version: '9.8.7' });
const CAPABILITIES = Object.freeze({ tools: {}, resources: {} });
const INSTRUCTIONS = 'Exercise protocol framing without application dispatch.';

function description() {
  return { capabilities: CAPABILITIES, serverInfo: SERVER, instructions: INSTRUCTIONS };
}

function envelope(version = MODERN_PROTOCOL_VERSION, overrides = {}) {
  return {
    [PROTOCOL_VERSION_META_KEY]: version,
    [CLIENT_CAPABILITIES_META_KEY]: { roots: {} },
    [CLIENT_INFO_META_KEY]: { name: 'adapter-test', version: '1.0.0' },
    ...overrides,
  };
}

function request(id, method, meta = envelope(), params = {}) {
  return { jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } };
}

function harness() {
  const messages = [];
  const adapter = createProtocolAdapter({
    initializeResult: description,
    respond(id, result) { messages.push({ jsonrpc: '2.0', id, result }); },
    respondError(id, code, message, data) {
      messages.push({
        jsonrpc: '2.0',
        id,
        error: { code, message, ...(data === undefined ? {} : { data }) },
      });
    },
  });
  return { adapter, messages };
}

let checks = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks += 1;
}

function testJsonRpcValidation() {
  for (const value of [null, [], 'request']) {
    const result = validateJsonRpcRequest(value);
    check(
      { ok: result.ok, id: result.id, notification: result.notification, error: result.error },
      { ok: false, id: null, notification: false, error: { code: -32600, message: 'Invalid Request' } },
    );
  }
  for (const value of [
    { jsonrpc: '1.0', id: 4, method: 'ping' },
    { jsonrpc: '2.0', id: 'missing-method' },
    { jsonrpc: '2.0', id: 5, method: 42 },
  ]) {
    const result = validateJsonRpcRequest(value);
    check(result.error, { code: -32600, message: 'Invalid Request' });
    check(result.notification, false);
  }
  const invalidNotification = validateJsonRpcRequest({ jsonrpc: '1.0', method: 'ping' });
  check(invalidNotification.notification, true);
  const validNotification = validateJsonRpcRequest({ jsonrpc: '2.0', method: 'ping' });
  check({ ok: validNotification.ok, notification: validNotification.notification }, { ok: true, notification: true });
}

function testDiscoveryAndDecoration() {
  const { adapter, messages } = harness();
  check(adapter.accept(request('discover', 'server/discover')), { handled: true, era: 'modern', modern: true });
  const result = messages[0].result;
  check(result.supportedVersions, [MODERN_PROTOCOL_VERSION]);
  check(result.capabilities, CAPABILITIES);
  check(result.instructions, INSTRUCTIONS);
  check(
    { resultType: result.resultType, ttlMs: result.ttlMs, cacheScope: result.cacheScope },
    { resultType: 'complete', ttlMs: 0, cacheScope: 'private' },
  );
  check(result._meta[SERVER_INFO_META_KEY], SERVER);

  check(adapter.accept(request('ping', 'ping')), { handled: true, era: 'modern', modern: true });
  check(messages[1].result, {
    resultType: 'complete',
    _meta: { [SERVER_INFO_META_KEY]: SERVER },
  });

  const application = adapter.accept(request('tools', 'tools/list'));
  check(application, { handled: false, era: 'modern', modern: true });
  check(
    adapter.normalizeParams({
      name: 'fixture',
      arguments: { _meta: { retainedBusinessArgument: true } },
      _meta: envelope(),
    }),
    { name: 'fixture', arguments: { _meta: { retainedBusinessArgument: true } } },
  );
  check(
    adapter.decorateResult({ tools: [{ name: 'fixture' }], _meta: { retained: true } }),
    {
      tools: [{ name: 'fixture' }],
      resultType: 'complete',
      _meta: { retained: true, [SERVER_INFO_META_KEY]: SERVER },
    },
  );
  check(
    adapter.decorateResult({ resources: [] }, { cacheable: true }),
    {
      resources: [],
      resultType: 'complete',
      ttlMs: 0,
      cacheScope: 'private',
      _meta: { [SERVER_INFO_META_KEY]: SERVER },
    },
  );
}

function testModernEnvelopeErrors() {
  const malformed = [
    undefined,
    null,
    {},
    { [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION },
    envelope(MODERN_PROTOCOL_VERSION, { [PROTOCOL_VERSION_META_KEY]: 20260728 }),
    envelope(MODERN_PROTOCOL_VERSION, { [CLIENT_CAPABILITIES_META_KEY]: [] }),
    envelope(MODERN_PROTOCOL_VERSION, { [CLIENT_INFO_META_KEY]: { name: 'missing-version' } }),
  ];

  for (const [index, meta] of malformed.entries()) {
    const { adapter, messages } = harness();
    const value = meta === undefined
      ? { jsonrpc: '2.0', id: index, method: 'server/discover', params: {} }
      : request(index, 'server/discover', meta);
    check(adapter.accept(value).handled, true);
    check(adapter.getEra(), 'modern');
    check(messages[0].error, { code: -32602, message: 'Invalid params' });
  }

  const { adapter, messages } = harness();
  adapter.accept(request('unsupported', 'server/discover', envelope('2099-01-01')));
  check(messages[0].error, {
    code: -32022,
    message: 'Unsupported protocol version',
    data: { supported: [MODERN_PROTOCOL_VERSION], requested: '2099-01-01' },
  });
}

function testEraPinningAndNotificationSilence() {
  const legacyMetadata = harness();
  legacyMetadata.adapter.accept({
    jsonrpc: '2.0',
    id: 'legacy-meta-init',
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', _meta: { traceId: 'legacy-compatible' } },
  });
  check(legacyMetadata.adapter.getEra(), 'handshake');
  check(legacyMetadata.messages[0].result.protocolVersion, '2025-03-26');

  const legacy = harness();
  legacy.adapter.accept({
    jsonrpc: '2.0',
    id: 'init',
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  });
  check(legacy.adapter.getEra(), 'handshake');
  check(legacy.messages[0].result.protocolVersion, '2025-06-18');
  check(
    legacy.adapter.normalizeParams({ value: true, _meta: { traceId: 'legacy-compatible' } }),
    { value: true, _meta: { traceId: 'legacy-compatible' } },
  );
  legacy.adapter.accept(request('cross-era', 'tools/list'));
  check(legacy.messages[1].error, {
    code: -32022,
    message: 'Unsupported protocol version',
    data: { supported: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'], requested: MODERN_PROTOCOL_VERSION },
  });
  const beforeMismatchNotification = legacy.messages.length;
  legacy.adapter.accept(request(undefined, 'tools/list'));
  check(legacy.messages.length, beforeMismatchNotification);

  const modern = harness();
  modern.adapter.accept(request('discover', 'server/discover'));
  modern.adapter.accept(request('modern-init', 'initialize'));
  check(modern.messages[1].error, { code: -32601, message: 'Method not found' });
  modern.adapter.accept({ jsonrpc: '2.0', id: 'malformed-modern-init', method: 'initialize', params: {} });
  check(modern.messages[2].error, { code: -32602, message: 'Invalid params' });
  const beforeInvalidNotification = modern.messages.length;
  modern.adapter.accept({ jsonrpc: '2.0', method: 'tools/list', params: {} });
  check(modern.messages.length, beforeInvalidNotification);

  const handshakeMessages = [];
  const handshake = createHandshakeAdapter({
    respond(id, result) { handshakeMessages.push({ id, result }); },
    initializeResult: description,
  });
  check(handshake({ jsonrpc: '2.0', method: 'initialize', params: {} }), true);
  check(handshakeMessages, []);
}

function testEntrypointBoundaries() {
  const entrypoints = [
    'mcp-servers/citadel-state/index.js',
    'mcp-servers/codebase-memory/index.js',
    'mcp-servers/context-compress/index.js',
  ];
  const input = [
    'null',
    '[]',
    JSON.stringify({ jsonrpc: '2.0', id: 'bad-method', method: 42 }),
    JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '1.0', method: 'ping' }),
    '{',
    '',
  ].join('\n');

  for (const entrypoint of entrypoints) {
    const child = spawnSync(process.execPath, [path.resolve(entrypoint)], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, CITADEL_PROJECT_ROOT: path.resolve(__dirname, '..') },
      input,
    });
    check(child.status, 0, `${entrypoint} should exit cleanly`);
    const responses = child.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    check(responses.map((response) => response.id), [null, null, 'bad-method', null]);
    check(
      responses.map((response) => response.error.code),
      [-32600, -32600, -32600, -32700],
      `${entrypoint} should reject invalid requests and parse errors without answering notifications`,
    );
  }
}

testJsonRpcValidation();
testDiscoveryAndDecoration();
testModernEnvelopeErrors();
testEraPinningAndNotificationSilence();
testEntrypointBoundaries();
process.stdout.write(`MCP protocol adapter: ${checks} focused checks passed.\n`);

#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  MODERN_PROTOCOL_VERSION,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} = require('../mcp-servers/protocol-adapter');

const ROOT = path.resolve(__dirname, '..');
const HANDSHAKE_VERSION = '2025-06-18';

function modernParams(params = {}) {
  return {
    ...params,
    _meta: {
      [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
      [CLIENT_CAPABILITIES_META_KEY]: { roots: {} },
      [CLIENT_INFO_META_KEY]: { name: 'three-server-wire-test', version: '1.0.0' },
      requestEnvelopeSentinel: 'must-not-reach-business-validation',
    },
  };
}

function request(id, method, params) {
  return { jsonrpc: '2.0', id, method, params };
}

function runServer(server, projectRoot, requests) {
  const result = spawnSync(process.execPath, [path.join(ROOT, server.entrypoint)], {
    cwd: projectRoot,
    env: { ...process.env, CITADEL_PROJECT_ROOT: projectRoot },
    input: [...requests.map((value) => JSON.stringify(value)), ''].join('\n'),
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, `${server.name} failed: ${result.stderr}`);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function byId(messages, id) {
  const message = messages.find((candidate) => candidate.id === id);
  assert(message, `missing response id ${id}`);
  return message;
}

function assertModernResult(result, serverInfo, cacheable) {
  assert.equal(result.resultType, 'complete');
  assert.deepEqual(result._meta, { [SERVER_INFO_META_KEY]: serverInfo });
  if (cacheable) {
    assert.equal(result.ttlMs, 0);
    assert.equal(result.cacheScope, 'private');
  } else {
    assert(!Object.prototype.hasOwnProperty.call(result, 'ttlMs'));
    assert(!Object.prototype.hasOwnProperty.call(result, 'cacheScope'));
  }
}

const servers = [
  {
    name: 'citadel-state',
    entrypoint: 'mcp-servers/citadel-state/index.js',
    serverInfo: { name: 'citadel-state', version: '1.2.0' },
    capabilities: { tools: {}, resources: {} },
    instructions: 'Read operation state, then submit typed intents. This server never executes arbitrary commands or edits campaign files.',
    callParams: { name: 'citadel_status', arguments: { includeFiles: false } },
    assertCall(result) {
      const status = JSON.parse(result.content[0].text);
      assert.equal(status.planningExists, true);
      assert(!result.content[0].text.includes('requestEnvelopeSentinel'));
    },
    resource: { uri: 'citadel://status' },
  },
  {
    name: 'codebase-memory',
    entrypoint: 'mcp-servers/codebase-memory/index.js',
    serverInfo: { name: 'codebase-memory', version: '1.0.0' },
    capabilities: { tools: {}, resources: {} },
    instructions: 'Call get_architecture to orient on a cold repo, then who_imports / dependencies_of / trace_path / impact_of_change for structural questions instead of grepping. Index is read-only and derived; reindex after large pulls.',
    callParams: { name: 'index_status', arguments: {} },
    assertCall(result) {
      assert.doesNotThrow(() => JSON.parse(result.content[0].text));
      assert(!result.content[0].text.includes('requestEnvelopeSentinel'));
    },
    resource: { uri: 'codebase://architecture' },
  },
  {
    name: 'context-compress',
    entrypoint: 'mcp-servers/context-compress/index.js',
    serverInfo: { name: 'context-compress', version: '1.0.2' },
    capabilities: { tools: {} },
    callParams: { name: 'smart_read', arguments: { path: 'sample.txt', hint: 'wire fixture' } },
    assertCall(result) {
      assert(result.content[0].text.includes('direct modern MCP fixture'));
      assert(!result.content[0].text.includes('requestEnvelopeSentinel'));
    },
  },
];

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-mcp-dual-era-'));
try {
  fs.mkdirSync(path.join(projectRoot, '.planning', 'campaigns'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.planning', 'campaigns', 'fixture.md'), '# Fixture\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'src', 'fixture.js'), 'module.exports = 42;\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'sample.txt'), 'direct modern MCP fixture\n', 'utf8');

  for (const server of servers) {
    const handshake = runServer(server, projectRoot, [
      request('legacy-init', 'initialize', {
        protocolVersion: HANDSHAKE_VERSION,
        capabilities: {},
        clientInfo: { name: 'legacy-wire-test', version: '1.0.0' },
      }),
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      request('legacy-list', 'tools/list', {}),
    ]);
    assert.deepEqual(byId(handshake, 'legacy-init').result, {
      capabilities: server.capabilities,
      serverInfo: server.serverInfo,
      ...(server.instructions ? { instructions: server.instructions } : {}),
      protocolVersion: HANDSHAKE_VERSION,
    });
    const legacyList = byId(handshake, 'legacy-list').result;
    assert(Array.isArray(legacyList.tools) && legacyList.tools.length > 0);
    for (const field of ['resultType', 'ttlMs', 'cacheScope', '_meta']) {
      assert(!Object.prototype.hasOwnProperty.call(legacyList, field), `${server.name} changed legacy list shape`);
    }
    assert.equal(handshake.length, 2, `${server.name} initialized notification must remain silent`);

    const inlineModern = runServer(server, projectRoot, [
      request('inline-modern-list', 'tools/list', modernParams()),
    ]);
    assert.equal(inlineModern.length, 1, `${server.name} inline modern request emitted extra responses`);
    const inlineList = byId(inlineModern, 'inline-modern-list').result;
    assert(Array.isArray(inlineList.tools) && inlineList.tools.length > 0);
    assertModernResult(inlineList, server.serverInfo, true);

    const modernRequests = [
      request('discover', 'server/discover', modernParams()),
      request('ping', 'ping', modernParams()),
      request('modern-list', 'tools/list', modernParams()),
      request('modern-call', 'tools/call', modernParams(server.callParams)),
      { jsonrpc: '2.0', method: 'tools/list', params: modernParams() },
    ];
    if (server.resource) {
      modernRequests.push(request('resource-list', 'resources/list', modernParams()));
      modernRequests.push(request('resource-read', 'resources/read', modernParams(server.resource)));
    }
    if (server.name === 'citadel-state') {
      modernRequests.push(request('inner-meta', 'tools/call', modernParams({
        name: 'citadel_status',
        arguments: { includeFiles: false, _meta: { retainedBusinessArgument: true } },
      })));
    }

    const modern = runServer(server, projectRoot, modernRequests);
    const discovery = byId(modern, 'discover').result;
    assert.deepEqual(discovery.supportedVersions, [MODERN_PROTOCOL_VERSION]);
    assert.deepEqual(discovery.capabilities, server.capabilities);
    assert.equal(discovery.instructions, server.instructions);
    assertModernResult(discovery, server.serverInfo, true);
    assertModernResult(byId(modern, 'ping').result, server.serverInfo, false);
    const list = byId(modern, 'modern-list').result;
    assert(Array.isArray(list.tools) && list.tools.length > 0);
    assertModernResult(list, server.serverInfo, true);
    const call = byId(modern, 'modern-call').result;
    assertModernResult(call, server.serverInfo, false);
    server.assertCall(call);
    assert(!modern.some((message) => message.id === undefined), `${server.name} notification emitted a response`);

    if (server.resource) {
      assertModernResult(byId(modern, 'resource-list').result, server.serverInfo, true);
      assertModernResult(byId(modern, 'resource-read').result, server.serverInfo, true);
    }
    if (server.name === 'citadel-state') {
      assert.equal(byId(modern, 'inner-meta').error.code, -32602,
        'only the request-envelope _meta may be removed; tool arguments must remain untouched');
    }
  }
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

console.log('MCP three-server wire: 3/3 modern, 3/3 inline-first modern, and 3/3 handshake conversations passed.');

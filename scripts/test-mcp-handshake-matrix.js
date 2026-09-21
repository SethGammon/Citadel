#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
// Keep conformance fixtures independent from the adapter's allowlist so a
// missing or misspelled implementation revision cannot shrink the matrix.
const HANDSHAKE_PROTOCOL_VERSIONS = Object.freeze([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
]);
const LEGACY_PROTOCOL_VERSION = '2024-11-05';
const LATEST_HANDSHAKE_PROTOCOL_VERSION = '2025-11-25';
const SERVERS = Object.freeze([
  {
    name: 'citadel-state',
    path: path.join(REPO_ROOT, 'mcp-servers', 'citadel-state', 'index.js'),
    capabilities: { tools: {}, resources: {} },
    version: '1.2.0',
    instructions: 'Read operation state, then submit typed intents. This server never executes arbitrary commands or edits campaign files.',
  },
  {
    name: 'codebase-memory',
    path: path.join(REPO_ROOT, 'mcp-servers', 'codebase-memory', 'index.js'),
    capabilities: { tools: {}, resources: {} },
    version: '1.0.0',
    instructions: 'Call get_architecture to orient on a cold repo, then who_imports / dependencies_of / trace_path / impact_of_change for structural questions instead of grepping. Index is read-only and derived; reindex after large pulls.',
  },
  {
    name: 'context-compress',
    path: path.join(REPO_ROOT, 'mcp-servers', 'context-compress', 'index.js'),
    capabilities: { tools: {} },
    version: '1.0.2',
    instructions: undefined,
  },
]);

function drive(server, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server.path], {
      cwd: REPO_ROOT,
      env: { ...process.env, CITADEL_PROJECT_ROOT: REPO_ROOT },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = new Map();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`${server.name} timed out: ${stderr}`)), 15000);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(responses);
    }

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          responses.set(response.id, response);
        } catch (error) {
          finish(error);
          return;
        }
      }
      if (responses.size === requests.length) finish();
    });
    child.on('error', finish);
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`${server.name} exited ${code}: ${stderr}`));
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

function initialize(id, protocolVersion, includeVersion = true) {
  const params = includeVersion ? { protocolVersion } : {};
  return { jsonrpc: '2.0', id, method: 'initialize', params };
}

function assertServerIdentity(server, result) {
  assert.deepStrictEqual(result.capabilities, server.capabilities, `${server.name} capabilities changed`);
  assert.deepStrictEqual(result.serverInfo, { name: server.name, version: server.version });
  assert.equal(result.instructions, server.instructions, `${server.name} instructions changed`);
}

async function run() {
  let matrixPassed = 0;
  let unexpectedDowngrades = 0;
  let pingIdsPreserved = 0;

  for (const server of SERVERS) {
    for (const version of HANDSHAKE_PROTOCOL_VERSIONS) {
      const initializeId = `initialize:${server.name}:${version}`;
      const pingId = `ping:${server.name}:${version}`;
      const responses = await drive(server, [
        initialize(initializeId, version),
        { jsonrpc: '2.0', id: pingId, method: 'ping', params: {} },
      ]);
      const initialized = responses.get(initializeId);
      assert(initialized?.result, `${server.name} ${version} did not initialize`);
      assertServerIdentity(server, initialized.result);
      if (initialized.result.protocolVersion !== version) unexpectedDowngrades += 1;
      assert.equal(initialized.result.protocolVersion, version, `${server.name} did not echo ${version}`);
      assert.deepStrictEqual(responses.get(pingId), { jsonrpc: '2.0', id: pingId, result: {} });
      matrixPassed += 1;
      pingIdsPreserved += 1;
    }
  }

  for (const server of SERVERS) {
    const omittedId = `omitted:${server.name}`;
    const modernId = `modern:${server.name}`;
    const unknownId = `unknown:${server.name}`;
    const responses = await drive(server, [
      initialize(omittedId, undefined, false),
      initialize(modernId, '2026-07-28'),
      initialize(unknownId, 'not-a-protocol-version'),
    ]);
    assert.equal(responses.get(omittedId)?.result?.protocolVersion, LEGACY_PROTOCOL_VERSION);
    assert.equal(responses.get(modernId)?.result?.protocolVersion, LATEST_HANDSHAKE_PROTOCOL_VERSION);
    assert.equal(responses.get(unknownId)?.result?.protocolVersion, LATEST_HANDSHAKE_PROTOCOL_VERSION);
  }

  assert.equal(matrixPassed, SERVERS.length * HANDSHAKE_PROTOCOL_VERSIONS.length);
  assert.equal(unexpectedDowngrades, 0);
  assert.equal(pingIdsPreserved, matrixPassed);
  process.stdout.write(
    `MCP handshake matrix: ${matrixPassed}/12 server-version combinations passed; `
      + `${unexpectedDowngrades} unexpected downgrades; ${pingIdsPreserved}/12 ping IDs preserved; `
      + '9/9 omitted-or-unsupported fallback checks passed.\n',
  );
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

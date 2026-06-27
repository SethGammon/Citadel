#!/usr/bin/env node

'use strict';

/**
 * JSON-RPC smoke test for the codebase-memory MCP server. Spawns the server,
 * drives a realistic handshake + tool calls against this repo, and asserts the
 * responses. Pure Node, no dependencies. Exit 0 = pass, 1 = fail.
 *
 *   node mcp-servers/codebase-memory/smoke-test.js
 */

const { spawn } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SERVER = path.join(__dirname, 'index.js');

const REQUESTS = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_architecture', arguments: {} } },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'who_imports', arguments: { file: 'core/map/index.js' } } },
  { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'index_status', arguments: {} } },
];

function parseResult(resp) {
  return JSON.parse(resp.result.content[0].text);
}

const checks = {
  1: (r) => r.result.serverInfo.name === 'codebase-memory' || 'bad serverInfo',
  2: (r) => (Array.isArray(r.result.tools) && r.result.tools.length === 8) || `expected 8 tools, got ${r.result.tools && r.result.tools.length}`,
  3: (r) => (parseResult(r).stats && typeof parseResult(r).stats.files === 'number') || 'no stats.files',
  4: (r) => (Array.isArray(parseResult(r).importers)) || 'importers not an array',
  5: (r) => (typeof parseResult(r).fileCount === 'number') || 'no fileCount',
};

function run() {
  const child = spawn('node', [SERVER], { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
  let buffer = '';
  const responses = {};

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const msg = JSON.parse(t);
      if (msg.id !== undefined) responses[msg.id] = msg;
    }
    if (Object.keys(responses).length === REQUESTS.length) finish();
  });

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    let failures = 0;
    for (const [id, check] of Object.entries(checks)) {
      const resp = responses[id];
      if (!resp) {
        console.error(`FAIL id=${id}: no response`);
        failures++;
        continue;
      }
      const verdict = check(resp);
      if (verdict === true) {
        console.log(`ok   id=${id} ${REQUESTS[id - 1].method}${REQUESTS[id - 1].params.name ? ' ' + REQUESTS[id - 1].params.name : ''}`);
      } else {
        console.error(`FAIL id=${id}: ${verdict}`);
        failures++;
      }
    }
    child.kill();
    if (failures) {
      console.error(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log('\nAll codebase-memory smoke checks passed.');
    process.exit(0);
  }

  child.on('error', (err) => {
    console.error('Failed to spawn server:', err.message);
    process.exit(1);
  });

  for (const req of REQUESTS) child.stdin.write(JSON.stringify(req) + '\n');
  setTimeout(() => {
    console.error('Timed out waiting for responses.');
    child.kill();
    process.exit(1);
  }, 30000);
}

run();

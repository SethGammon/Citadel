#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sha256Digest,
  validateIntent,
} = require('../core/operations');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'mcp-servers', 'citadel-state', 'index.js');
const NOW = '2026-07-13T12:00:00.000Z';

function operationRecord(operationId, status, capabilities, revision = 3) {
  const spec = {
    protocol_version: '0.1',
    kind: 'operation_spec',
    operation_id: operationId,
    title: `Control ${operationId}`,
    objective_digest: sha256Digest({ operationId }),
    step_ids: ['step-control'],
    policy_digests: [],
    created_at: NOW,
  };
  const active = status !== 'pending';
  const terminal = ['passed', 'failed', 'unknown'].includes(status);
  return {
    control_version: '0.1',
    revision,
    capabilities,
    spec,
    run: {
      protocol_version: '0.1',
      kind: 'operation_run',
      run_id: `run-${operationId}`,
      operation_id: operationId,
      spec_digest: sha256Digest(spec),
      status,
      started_at: active ? NOW : null,
      completed_at: terminal ? '2026-07-13T12:01:00.000Z' : null,
      intent_ids: [],
      step_attempt_ids: [],
    },
  };
}

function call(id, name, args) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

function mutation(operationId, capability, idempotencyKey, overrides = {}) {
  return {
    operation_id: operationId,
    expected_revision: 3,
    idempotency_key: idempotencyKey,
    actor: 'actor-test',
    reason: `Verify ${capability} control`,
    capability,
    ...overrides,
  };
}

function payload(response) {
  assert(response.result?.content?.[0]?.text, `missing tool payload for response ${response.id}`);
  return JSON.parse(response.result.content[0].text);
}

function drive(root, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: REPO_ROOT,
      env: { ...process.env, CITADEL_PROJECT_ROOT: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = new Map();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => finish(new Error(`MCP timeout: ${stderr}`)), 15000);

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
          if (response.id !== undefined) responses.set(response.id, response);
        } catch (error) {
          finish(error);
          return;
        }
      }
      if (responses.size === requests.length) finish();
    });
    child.on('error', finish);
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-state-mcp-'));
  try {
    const operationDir = path.join(root, '.planning', 'operations', 'control');
    const campaignDir = path.join(root, '.planning', 'campaigns');
    fs.mkdirSync(operationDir, { recursive: true });
    fs.mkdirSync(campaignDir, { recursive: true });
    const sentinel = path.join(campaignDir, 'must-not-change.md');
    fs.writeFileSync(sentinel, 'campaign sentinel\n');
    const records = [
      operationRecord('operation-pause', 'running', ['pause']),
      operationRecord('operation-resume', 'blocked', ['resume']),
      operationRecord('operation-stop', 'pending', ['stop']),
      operationRecord('operation-retry', 'failed', ['retry']),
      operationRecord('operation-denied', 'running', []),
    ];
    for (const record of records) {
      fs.writeFileSync(path.join(operationDir, `${record.spec.operation_id}.json`), JSON.stringify(record));
    }

    const pause = { ...mutation('operation-pause', 'pause', 'key-pause'), action: 'pause' };
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      call(3, 'citadel_operation_list', {}),
      call(4, 'citadel_operation_get', { operation_id: 'operation-pause' }),
      call(5, 'citadel_intent_submit', pause),
      call(6, 'citadel_intent_submit', pause),
      call(7, 'citadel_operation_resume', mutation('operation-resume', 'resume', 'key-resume')),
      call(8, 'citadel_operation_stop', mutation('operation-stop', 'stop', 'key-stop')),
      call(9, 'citadel_operation_retry', mutation('operation-retry', 'retry', 'key-retry')),
      call(10, 'citadel_operation_pause', mutation('operation-pause', 'pause', 'key-stale', { expected_revision: 2 })),
      call(11, 'citadel_operation_pause', mutation('operation-denied', 'pause', 'key-denied')),
      call(12, 'citadel_operation_pause', { ...mutation('operation-pause', 'pause', 'key-extra'), command: 'rm' }),
      call(13, 'citadel_operation_pause', mutation('../campaigns/escape', 'pause', 'key-traversal')),
      call(14, 'citadel_operation_pause', { operation_id: 'operation-pause' }),
      call(15, 'citadel_operation_get', { operation_id: '../campaigns/escape' }),
      call(16, 'citadel_operation_pause', mutation('operation-pause', 'pause', 'key-root', { project_root: path.dirname(root) })),
      call(17, 'citadel_status', {}),
      call(18, 'citadel_workflow_prompt', { workflow: 'qa', target: 'control surface' }),
    ];
    const responses = await drive(root, requests);

    assert.equal(responses.get(1).result.serverInfo.name, 'citadel-state');
    const tools = responses.get(2).result.tools;
    for (const name of [
      'citadel_operation_list', 'citadel_operation_get', 'citadel_intent_submit',
      'citadel_operation_pause', 'citadel_operation_resume', 'citadel_operation_stop', 'citadel_operation_retry',
    ]) assert(tools.some((tool) => tool.name === name), `missing ${name}`);
    assert(tools.every((tool) => tool.inputSchema.additionalProperties === false));

    const listed = payload(responses.get(3));
    assert.equal(listed.outcome, 'accepted');
    assert.equal(listed.operations.length, 5);
    assert.equal(payload(responses.get(4)).operation.spec.operation_id, 'operation-pause');

    assert.equal(payload(responses.get(5)).outcome, 'accepted');
    assert.deepEqual(payload(responses.get(6)), payload(responses.get(5)), 'duplicate idempotency changed the outcome');
    for (const id of [7, 8, 9]) assert.equal(payload(responses.get(id)).outcome, 'accepted');
    assert.equal(payload(responses.get(10)).outcome, 'conflict');
    assert.equal(payload(responses.get(10)).reason_code, 'STALE_REVISION');
    assert.equal(payload(responses.get(11)).outcome, 'blocked');
    assert.equal(payload(responses.get(11)).reason_code, 'CAPABILITY_NOT_GRANTED');
    for (const id of [12, 13, 14, 16]) assert.equal(payload(responses.get(id)).outcome, 'rejected');
    assert.equal(responses.get(15).error.code, -32602);
    assert.equal(typeof payload(responses.get(17)).campaigns, 'number');
    assert(responses.get(18).result.content[0].text.includes('Citadel QA'));

    const pendingDir = path.join(root, '.planning', 'intents', 'pending');
    const pendingFiles = fs.readdirSync(pendingDir).filter((name) => name.endsWith('.json'));
    assert.equal(pendingFiles.length, 4, 'only accepted unique intents may enter the pending queue');
    const protocolActions = [];
    for (const name of pendingFiles) {
      const record = JSON.parse(fs.readFileSync(path.join(pendingDir, name), 'utf8'));
      assert.deepEqual(validateIntent(record.protocol_intent), []);
      protocolActions.push(record.protocol_intent.action);
      assert(!('command' in record));
    }
    assert(protocolActions.includes('cancel'), 'stop must map to the protocol cancel intent');
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'campaign sentinel\n');

    const lock = path.join(root, '.planning', 'intents', '.submit.lock');
    const owner = path.join(lock, 'owner.json');
    fs.mkdirSync(lock);
    const freshOwnerless = await drive(root, [
      call(19, 'citadel_operation_pause', mutation('operation-pause', 'pause', 'key-fresh-ownerless-lock')),
    ]);
    assert.equal(payload(freshOwnerless.get(19)).reason_code, 'INTENT_STORE_BUSY',
      'a fresh ownerless lock must retain its grace period');
    fs.rmdirSync(lock);
    fs.mkdirSync(lock);
    fs.writeFileSync(owner, JSON.stringify({ version: 1, pid: process.pid, created_at: '2000-01-01T00:00:00.000Z' }));
    const liveLock = await drive(root, [
      call(20, 'citadel_operation_pause', mutation('operation-pause', 'pause', 'key-live-lock')),
    ]);
    assert.equal(payload(liveLock.get(20)).reason_code, 'INTENT_STORE_BUSY', 'a live owner lock must not be reclaimed');
    fs.writeFileSync(owner, JSON.stringify({ version: 1, pid: 2147483647, created_at: '2000-01-01T00:00:00.000Z' }));
    const staleLock = await drive(root, [
      call(21, 'citadel_operation_pause', mutation('operation-pause', 'pause', 'key-stale-lock')),
    ]);
    assert.equal(payload(staleLock.get(21)).outcome, 'accepted', 'an old lock owned by a dead process must be recovered');
    assert.equal(fs.existsSync(lock), false, 'recovered locks must be released after submission');

    process.stdout.write('Citadel state MCP tests: 21 JSON-RPC calls passed.\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

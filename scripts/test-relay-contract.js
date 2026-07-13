#!/usr/bin/env node

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const relay = require('../core/relay');

async function main() {
  const key = crypto.randomBytes(32);
  const wrongKey = crypto.randomBytes(32);
  const payload = { operation_id: 'operation-demo', revision: 3, status: 'blocked' };
  const envelope = relay.createEnvelope('operation-update', payload, key, {
    messageId: 'message-demo', createdAt: '2026-07-13T20:00:00.000Z', iv: Buffer.alloc(12, 7),
  });
  assert.deepEqual(relay.openEnvelope(envelope, key), payload);
  assert.throws(() => relay.openEnvelope(envelope, wrongKey));
  assert.throws(() => relay.openEnvelope({ ...envelope, ciphertext_base64: `${envelope.ciphertext_base64}A` }, key));
  assert.throws(() => relay.createEnvelope('intent', { prompt: 'forbidden' }, key), /forbidden/);
  const forbiddenField = ['to', 'ken'].join('');
  assert.throws(() => relay.createEnvelope('intent', { metadata: { [forbiddenField]: 'fixture-value' } }, key), /forbidden/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-relay-'));
  try {
    const first = relay.enqueue(root, envelope);
    assert.equal(first.status, 'queued');
    assert.equal(relay.enqueue(root, envelope).status, 'already_queued');
    const escaped = path.resolve(root, '..', 'relay-escape.json');
    assert.throws(() => relay.enqueue(root, { ...envelope, message_id: '../../../../relay-escape' }), /message_id|invalid|escape/i);
    assert.equal(fs.existsSync(escaped), false, 'Relay traversal must not create files outside the outbox');

    const outside = path.join(root, 'outside.json');
    const linked = path.join(root, '.planning', 'relay', 'outbox', 'message-linked.json');
    fs.writeFileSync(outside, JSON.stringify(envelope));
    let symlinkCreated = false;
    try {
      fs.symlinkSync(outside, linked, 'file');
      symlinkCreated = true;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
    }
    if (symlinkCreated) {
      assert.throws(() => relay.list(root), /symlink/i);
      fs.unlinkSync(linked);
    }
    const outage = await relay.flush(root, { send: async () => { throw new Error('offline'); } });
    assert.equal(outage.status, 'degraded');
    assert.equal(relay.list(root).length, 1, 'outage must preserve local state');
    const delivered = await relay.flush(root, { send: async () => ({ accepted: true }) });
    assert.equal(delivered.status, 'delivered');
    assert.equal(relay.list(root).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('Relay local-first contract tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

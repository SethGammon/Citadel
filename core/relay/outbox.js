'use strict';

const fs = require('fs');
const path = require('path');
const { FIELDS, MESSAGE_ID_PATTERN } = require('./envelope');
const { resolveExistingFile, resolveTarget } = require('../distribution/fs-safety');

function assertQueueEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify([...FIELDS].sort())) {
    throw new TypeError('Relay envelope fields must exactly match the allowlist');
  }
  if (typeof envelope.message_id !== 'string' || !MESSAGE_ID_PATTERN.test(envelope.message_id)) {
    throw new TypeError('Relay message_id is invalid');
  }
  return envelope;
}

function outboxDir(projectRoot) {
  return resolveTarget(path.resolve(projectRoot), '.planning/relay/outbox', 'Relay outbox');
}

function enqueue(projectRoot, envelope) {
  assertQueueEnvelope(envelope);
  const dir = outboxDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const target = resolveTarget(dir, `${envelope.message_id}.json`, 'Relay outbox entry');
  const body = `${JSON.stringify(envelope, null, 2)}\n`;
  if (fs.existsSync(target)) {
    if (fs.readFileSync(target, 'utf8') !== body) throw new Error('Relay message id collision');
    return { status: 'already_queued', path: target };
  }
  const temporary = resolveTarget(dir, `${envelope.message_id}.${process.pid}.tmp`, 'Relay outbox temporary entry');
  fs.writeFileSync(temporary, body, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, target);
  return { status: 'queued', path: target };
}

function list(projectRoot) {
  const dir = outboxDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^([a-z][a-z0-9-]{0,127})\.json$/.test(name)).sort()
    .map((name) => {
      const entryPath = resolveExistingFile(dir, name, 'Relay outbox entry');
      const envelope = assertQueueEnvelope(JSON.parse(fs.readFileSync(entryPath, 'utf8')));
      if (`${envelope.message_id}.json` !== name) throw new Error('Relay outbox filename does not match message_id');
      return { name, path: entryPath, envelope };
    });
}

async function flush(projectRoot, transport) {
  if (!transport || typeof transport.send !== 'function') throw new TypeError('Relay transport.send is required');
  const delivered = [];
  const retained = [];
  for (const item of list(projectRoot)) {
    try {
      const result = await transport.send(item.envelope);
      if (!result || result.accepted !== true) { retained.push(item.name); continue; }
      fs.unlinkSync(item.path);
      delivered.push(item.name);
    } catch (_error) { retained.push(item.name); }
  }
  return Object.freeze({ status: retained.length ? 'degraded' : 'delivered', delivered, retained });
}

module.exports = Object.freeze({ assertQueueEnvelope, enqueue, flush, list, outboxDir });

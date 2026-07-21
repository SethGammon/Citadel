'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  SUPERVISOR_API_VERSION, SupervisorError, createSupervisorClient,
  createSupervisorDispatcher, createSupervisorEventLog, validateSupervisorEvent,
  validateSupervisorRequest,
} = require('../packages/client/supervisor');

const timestamp = '2026-07-14T20:00:00.000Z';
let id = 0;
const createId = (prefix) => `${prefix}-test-${++id}`;

function success(request, result = {}) {
  return {
    apiVersion: SUPERVISOR_API_VERSION,
    requestId: request.requestId,
    ok: true,
    result,
    revision: 1,
    completedAt: timestamp,
  };
}

async function main() {
  const requests = [];
  let eventListener;
  const client = createSupervisorClient({
    request(request) {
      requests.push(request);
      return Promise.resolve(success(request, { accepted: true }));
    },
    subscribe(listener) {
      eventListener = listener;
      return () => {};
    },
  }, { now: () => timestamp, createId });

  await client.handshake();
  assert.equal(requests[0].method, 'system.handshake');
  assert.equal(requests[0].kind, 'query');

  await client.command('instances.pause', { instanceId: 'instance-one' }, { expectedRevision: 4 });
  assert.equal(requests[1].kind, 'command');
  assert.equal(requests[1].expectedRevision, 4);
  assert.match(requests[1].idempotencyKey, /^command-/);

  await assert.rejects(client.query('instances.destroyEverything', {}), /method is not allowed/);
  await assert.rejects(
    client.command('operations.launch', { cwd: 'C:\\private', operationId: 'operation-one' }),
    /forbidden private or native field/,
  );
  await assert.rejects(
    client.command('operations.launch', { command: 'powershell.exe' }),
    /forbidden private or native field/,
  );

  let received;
  client.subscribe((event) => { received = event; });
  const event = {
    apiVersion: SUPERVISOR_API_VERSION,
    sequence: 1,
    eventId: 'event-one',
    type: 'instance.updated',
    subjectType: 'agent_instance',
    subjectId: 'instance-one',
    revision: 5,
    payload: { status: 'running' },
    occurredAt: timestamp,
  };
  eventListener(event);
  assert.deepEqual(received, event);
  assert.equal(validateSupervisorEvent({ ...event, payload: { token: 'nope' } }).ok, false);

  const oversizedRequest = {
    apiVersion: SUPERVISOR_API_VERSION,
    requestId: 'request-large',
    kind: 'query',
    method: 'instances.list',
    payload: { text: 'x'.repeat(65 * 1024) },
    sentAt: timestamp,
  };
  assert.equal(validateSupervisorRequest(oversizedRequest).ok, false);

  const mismatchClient = createSupervisorClient({
    request(request) {
      return Promise.resolve({ ...success(request), requestId: 'request-wrong' });
    },
  }, { now: () => timestamp, createId });
  await assert.rejects(mismatchClient.handshake(), /does not match/);

  let dispatchCalls = 0;
  const dispatcher = createSupervisorDispatcher({
    now: () => timestamp,
    getRevision: () => 2,
    handlers: {
      'system.handshake': () => ({ result: { apiVersion: 1 }, revision: null }),
      'instances.pause': () => {
        dispatchCalls += 1;
        return { result: { accepted: true }, revision: 3 };
      },
      'operations.launch': () => {
        throw new SupervisorError('POLICY_BLOCKED', 'Launch requires approval', false, 2);
      },
    },
  });
  const dispatchClient = createSupervisorClient({ request: dispatcher.dispatch }, { now: () => timestamp, createId });
  const commandOptions = { idempotencyKey: 'command-idempotent', expectedRevision: 2 };
  const first = await dispatchClient.command('instances.pause', { instanceId: 'instance-one' }, commandOptions);
  const replayed = await dispatchClient.command('instances.pause', { instanceId: 'instance-one' }, commandOptions);
  assert.equal(first.ok, true);
  assert.equal(replayed.ok, true);
  assert.equal(dispatchCalls, 1, 'idempotency replay must not execute the handler twice');
  const conflict = await dispatchClient.command(
    'instances.pause',
    { instanceId: 'instance-one' },
    { idempotencyKey: 'command-conflict', expectedRevision: 1 },
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'REVISION_CONFLICT');
  assert.equal(conflict.revision, 2);
  const blocked = await dispatchClient.command(
    'operations.launch',
    { operationId: 'operation-one' },
    { idempotencyKey: 'command-blocked', expectedRevision: 2 },
  );
  assert.equal(blocked.error.code, 'POLICY_BLOCKED');

  const eventLog = createSupervisorEventLog({ now: () => timestamp });
  const observed = [];
  const unsubscribe = eventLog.subscribe((entry) => observed.push(entry));
  eventLog.append({
    type: 'instance.updated', subjectType: 'agent_instance', subjectId: 'instance-one',
    revision: 2, payload: { status: 'starting' },
  });
  eventLog.append({
    type: 'instance.updated', subjectType: 'agent_instance', subjectId: 'instance-one',
    revision: 3, payload: { status: 'running' },
  });
  unsubscribe();
  assert.deepEqual(eventLog.replay(1).map((entry) => entry.sequence), [2]);
  assert.equal(observed.length, 2);

  const source = fs.readdirSync(path.join(__dirname, '..', 'packages', 'client', 'supervisor'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(__dirname, '..', 'packages', 'client', 'supervisor', file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /require\(['"](?:fs|path|child_process|node:)|\bBuffer\b/, 'supervisor client entrypoint must remain browser-safe');

  console.log('supervisor client tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

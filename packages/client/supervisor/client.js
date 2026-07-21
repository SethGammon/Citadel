'use strict';

const { REQUEST_KINDS, SUPERVISOR_API_VERSION } = require('./constants');
const { assertValid, validateSupervisorEvent, validateSupervisorRequest, validateSupervisorResponse } = require('./validation');

let fallbackSequence = 0;

function defaultId(prefix) {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID().toLowerCase()}`;
  fallbackSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
}

function createSupervisorClient(transport, options = {}) {
  if (!transport || typeof transport.request !== 'function') throw new TypeError('createSupervisorClient requires a transport.request function');
  const now = options.now || (() => new Date().toISOString());
  const createId = options.createId || defaultId;

  async function send(kind, method, payload = {}, requestOptions = {}) {
    const request = {
      apiVersion: SUPERVISOR_API_VERSION,
      requestId: requestOptions.requestId || createId('request'),
      kind,
      method,
      payload,
      sentAt: now(),
    };
    if (kind === REQUEST_KINDS.COMMAND) {
      request.idempotencyKey = requestOptions.idempotencyKey || createId('command');
      request.expectedRevision = requestOptions.expectedRevision ?? null;
    }
    assertValid(validateSupervisorRequest(request), 'Invalid supervisor request');
    const response = await transport.request(Object.freeze(request));
    assertValid(validateSupervisorResponse(response), 'Invalid supervisor response');
    if (response.requestId !== request.requestId) throw new Error('Supervisor response requestId does not match the request');
    return response;
  }

  function subscribe(listener, subscriptionOptions = {}) {
    if (typeof transport.subscribe !== 'function') throw new TypeError('Supervisor transport does not support subscriptions');
    if (typeof listener !== 'function') throw new TypeError('subscribe requires a listener function');
    return transport.subscribe((event) => {
      assertValid(validateSupervisorEvent(event), 'Invalid supervisor event');
      listener(event);
    }, { afterSequence: subscriptionOptions.afterSequence ?? 0 });
  }

  return Object.freeze({
    handshake: () => send(REQUEST_KINDS.QUERY, 'system.handshake', {}),
    query: (method, payload, requestOptions) => send(REQUEST_KINDS.QUERY, method, payload, requestOptions),
    command: (method, payload, requestOptions) => send(REQUEST_KINDS.COMMAND, method, payload, requestOptions),
    replay: (afterSequence = 0, limit = 500) => send(REQUEST_KINDS.QUERY, 'events.replay', { afterSequence, limit }),
    subscribe,
  });
}

module.exports = Object.freeze({ createSupervisorClient });

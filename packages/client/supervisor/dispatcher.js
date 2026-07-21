'use strict';

const { SUPERVISOR_API_VERSION } = require('./constants');
const {
  assertValid, isPlainObject, validateSupervisorRequest, validateSupervisorResponse,
} = require('./validation');

class SupervisorError extends Error {
  constructor(code, message, retryable = false, revision = null) {
    super(message);
    this.name = 'SupervisorError';
    this.code = code;
    this.retryable = retryable;
    this.revision = revision;
  }
}

function createSupervisorDispatcher(options = {}) {
  const handlers = options.handlers || {};
  if (!isPlainObject(handlers)) throw new TypeError('dispatcher handlers must be a plain object');
  const now = options.now || (() => new Date().toISOString());
  const getRevision = options.getRevision || null;
  const cacheLimit = options.idempotencyCacheLimit || 1000;
  const outcomes = new Map();

  function response(requestId, outcome) {
    const envelope = outcome.ok
      ? {
        apiVersion: SUPERVISOR_API_VERSION,
        requestId,
        ok: true,
        result: outcome.result,
        revision: outcome.revision,
        completedAt: now(),
      }
      : {
        apiVersion: SUPERVISOR_API_VERSION,
        requestId,
        ok: false,
        error: outcome.error,
        revision: outcome.revision,
        completedAt: now(),
      };
    assertValid(validateSupervisorResponse(envelope), 'Invalid supervisor response');
    return Object.freeze(envelope);
  }

  function remember(key, outcome) {
    outcomes.set(key, Object.freeze(outcome));
    if (outcomes.size > cacheLimit) outcomes.delete(outcomes.keys().next().value);
  }

  async function dispatch(request, context = {}) {
    assertValid(validateSupervisorRequest(request), 'Invalid supervisor request');
    if (request.kind === 'command' && outcomes.has(request.idempotencyKey)) {
      return response(request.requestId, outcomes.get(request.idempotencyKey));
    }

    let outcome;
    try {
      const handler = handlers[request.method];
      if (typeof handler !== 'function') {
        throw new SupervisorError('METHOD_UNAVAILABLE', `No supervisor handler is registered for ${request.method}`);
      }
      if (request.kind === 'command' && request.expectedRevision !== null && getRevision) {
        const actual = await getRevision(request, context);
        if (actual !== request.expectedRevision) {
          throw new SupervisorError(
            'REVISION_CONFLICT',
            `Expected revision ${request.expectedRevision}, received ${actual}`,
            true,
            Number.isSafeInteger(actual) && actual >= 0 ? actual : null,
          );
        }
      }
      const handled = await handler(request.payload, Object.freeze({ request, context }));
      if (!isPlainObject(handled) || !isPlainObject(handled.result)
        || (handled.revision !== null && (!Number.isSafeInteger(handled.revision) || handled.revision < 0))) {
        throw new SupervisorError('INVALID_HANDLER_RESULT', 'Supervisor handler returned an invalid result envelope');
      }
      outcome = Object.freeze({ ok: true, result: handled.result, revision: handled.revision });
    } catch (error) {
      const known = error instanceof SupervisorError;
      outcome = Object.freeze({
        ok: false,
        error: Object.freeze({
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'The supervisor could not complete the request',
          retryable: known ? error.retryable : false,
        }),
        revision: known ? error.revision : null,
      });
    }

    if (request.kind === 'command') remember(request.idempotencyKey, outcome);
    return response(request.requestId, outcome);
  }

  return Object.freeze({ dispatch });
}

module.exports = Object.freeze({ SupervisorError, createSupervisorDispatcher });

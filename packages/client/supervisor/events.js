'use strict';

const { SUPERVISOR_API_VERSION } = require('./constants');
const { assertValid, isPlainObject, validateSupervisorEvent } = require('./validation');

function createSupervisorEventLog(options = {}) {
  const capacity = options.capacity || 10000;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new TypeError('event log capacity must be a positive safe integer');
  const now = options.now || (() => new Date().toISOString());
  const createId = options.createId || ((sequence) => `event-${sequence}`);
  const events = [];
  const listeners = new Set();
  let sequence = options.initialSequence || 0;

  function append(input) {
    if (!isPlainObject(input)) throw new TypeError('event input must be a plain object');
    sequence += 1;
    const event = {
      apiVersion: SUPERVISOR_API_VERSION,
      sequence,
      eventId: input.eventId || createId(sequence),
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      revision: input.revision,
      payload: input.payload || {},
      occurredAt: input.occurredAt || now(),
    };
    assertValid(validateSupervisorEvent(event), 'Invalid supervisor event');
    const frozen = Object.freeze(event);
    events.push(frozen);
    if (events.length > capacity) events.shift();
    for (const listener of listeners) listener(frozen);
    return frozen;
  }

  function replay(afterSequence = 0, limit = 500) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new TypeError('afterSequence must be a non-negative safe integer');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new TypeError('limit must be between 1 and 5000');
    return Object.freeze(events.filter((event) => event.sequence > afterSequence).slice(0, limit));
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('event subscription requires a listener');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({ append, replay, subscribe, get sequence() { return sequence; } });
}

module.exports = Object.freeze({ createSupervisorEventLog });

'use strict';

const { assertValidAppContract } = require('./validation');

const INSTANCE_TRANSITIONS = Object.freeze({
  queued: Object.freeze(['starting', 'cancelled']),
  starting: Object.freeze(['running', 'blocked', 'failed', 'cancelled', 'lost']),
  running: Object.freeze(['pause-requested', 'blocked', 'completed', 'failed', 'cancelled', 'lost']),
  'pause-requested': Object.freeze(['paused', 'running', 'failed', 'cancelled', 'lost']),
  paused: Object.freeze(['running', 'cancelled', 'lost']),
  blocked: Object.freeze(['queued', 'running', 'failed', 'cancelled', 'lost']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
  lost: Object.freeze([]),
});

const HANDOFF_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['accepted', 'rejected', 'blocked']),
  accepted: Object.freeze([]),
  rejected: Object.freeze([]),
  blocked: Object.freeze([]),
});

function canTransition(graph, from, to) {
  return Boolean(graph[from]?.includes(to));
}

function transitionAgentInstance(instance, status, patch = {}) {
  assertValidAppContract(instance);
  if (instance.kind !== 'agent_instance') throw new TypeError('transitionAgentInstance requires an agent_instance');
  if (!canTransition(INSTANCE_TRANSITIONS, instance.status, status)) {
    throw new TypeError(`Invalid agent instance transition: ${instance.status} -> ${status}`);
  }
  const next = { ...instance, ...patch, status, revision: instance.revision + 1 };
  assertValidAppContract(next);
  return Object.freeze(next);
}

function transitionHandoff(handoff, status, patch = {}) {
  assertValidAppContract(handoff);
  if (handoff.kind !== 'handoff') throw new TypeError('transitionHandoff requires a handoff');
  if (!canTransition(HANDOFF_TRANSITIONS, handoff.status, status)) {
    throw new TypeError(`Invalid handoff transition: ${handoff.status} -> ${status}`);
  }
  const next = { ...handoff, ...patch, status, revision: handoff.revision + 1 };
  assertValidAppContract(next);
  return Object.freeze(next);
}

module.exports = Object.freeze({
  HANDOFF_TRANSITIONS,
  INSTANCE_TRANSITIONS,
  canTransitionAgentInstance: (from, to) => canTransition(INSTANCE_TRANSITIONS, from, to),
  canTransitionHandoff: (from, to) => canTransition(HANDOFF_TRANSITIONS, from, to),
  transitionAgentInstance,
  transitionHandoff,
});

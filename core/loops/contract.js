#!/usr/bin/env node

'use strict';

const path = require('path');
const { normalizeStatus } = require('./status');

const CONTRACT_VERSION = 1;

const DEFAULT_STOP_CONDITIONS = Object.freeze([
  'verifier-passed',
  'blocked',
  'budget-exhausted',
  'attempt-limit',
  'needs-human-review',
  'unsafe-to-continue',
]);

function slugify(value) {
  return String(value || 'loop')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'loop';
}

function nowIso(options = {}) {
  return options.now || new Date().toISOString();
}

function loopId(options = {}) {
  const type = slugify(options.type || 'loop');
  const source = options.title || options.command || options.goal || options.template || type;
  const stamp = nowIso(options).replace(/[:.]/g, '-');
  return options.id || `${type}-${slugify(source)}-${stamp}`;
}

function relativeLoopPath(id) {
  return path.join('.planning', 'loops', `${id}.json`).replace(/\\/g, '/');
}

function createLoopContract(options = {}) {
  const id = loopId(options);
  const command = options.command || options.action || '';
  const verifierCommand = options.verifierCommand || options.verify || options.verifier?.command || '';
  const createdAt = nowIso(options);

  return {
    version: CONTRACT_VERSION,
    id,
    type: options.type || 'loop',
    template: options.template || null,
    title: options.title || options.goal || command || id,
    status: normalizeStatus(options.status || 'planned'),
    trigger: {
      kind: options.triggerKind || options.trigger?.kind || 'manual',
      cadence: options.cadence || options.trigger?.cadence || null,
      command: command || null,
    },
    input: {
      source: options.inputSource || options.input?.source || 'user-request',
      queue: options.inputQueue || options.input?.queue || null,
      goal: options.goal || options.input?.goal || options.title || command || '',
    },
    scope: {
      description: options.scope || options.scopeDescription || options.scope?.description || 'current project',
      paths: options.paths || options.scope?.paths || [],
    },
    permissions: {
      filesystem: options.filesystem || options.permissions?.filesystem || 'workspace-write',
      network: options.network || options.permissions?.network || 'restricted',
      approvals: options.approvals || options.permissions?.approvals || 'required-for-risky-actions',
    },
    budget: {
      maxAttempts: Number(options.maxAttempts || options.budget?.maxAttempts || 1),
      maxSpend: options.maxSpend || options.budget?.maxSpend || null,
      costPerRun: options.costPerRun || options.budget?.costPerRun || null,
    },
    verifier: {
      command: verifierCommand || null,
      profile: options.verifierProfile || options.verifier?.profile || null,
      required: options.verifierRequired !== undefined ? Boolean(options.verifierRequired) : Boolean(verifierCommand),
    },
    retry: {
      maxAttempts: Number(options.maxAttempts || options.retry?.maxAttempts || 1),
      backoff: options.backoff || options.retry?.backoff || null,
    },
    stopConditions: options.stopConditions || DEFAULT_STOP_CONDITIONS,
    statePath: options.statePath || relativeLoopPath(id),
    reviewArtifact: options.reviewArtifact || options.artifact || null,
    recovery: {
      rollback: options.rollback || options.recovery?.rollback || 'inspect git diff and revert loop-owned changes if needed',
      continueCommand: options.continueCommand || options.recovery?.continueCommand || null,
    },
    createdAt,
    updatedAt: createdAt,
    runs: options.runs || [],
    notes: options.notes || [],
  };
}

function validateLoopContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object') errors.push('contract must be an object');
  if (!contract?.id) errors.push('id is required');
  if (!contract?.type) errors.push('type is required');
  if (!contract?.trigger?.kind) errors.push('trigger.kind is required');
  if (!contract?.budget || !Number.isFinite(Number(contract.budget.maxAttempts)) || Number(contract.budget.maxAttempts) < 1) {
    errors.push('budget.maxAttempts must be >= 1');
  }
  if (!Array.isArray(contract?.stopConditions) || contract.stopConditions.length === 0) {
    errors.push('stopConditions must be a non-empty array');
  }
  if (!contract?.statePath) errors.push('statePath is required');
  return {
    pass: errors.length === 0,
    errors,
  };
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  DEFAULT_STOP_CONDITIONS,
  createLoopContract,
  loopId,
  relativeLoopPath,
  slugify,
  validateLoopContract,
});

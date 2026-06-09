#!/usr/bin/env node

'use strict';

const { createLoopContract } = require('./contract');

const LOOP_TEMPLATES = Object.freeze({
  'pr-review-repair': {
    title: 'PR review and repair',
    type: 'pr-watch',
    triggerKind: 'scheduled',
    cadence: 'every 15 minutes',
    goal: 'Monitor a pull request, inspect review/CI feedback, apply targeted fixes, and stop at review or green checks.',
    verifierProfile: 'pr-checks',
    maxAttempts: 3,
    stopConditions: ['verifier-passed', 'needs-human-review', 'attempt-limit', 'unsafe-to-continue'],
  },
  'issue-triage': {
    title: 'Issue triage',
    type: 'triage',
    triggerKind: 'scheduled',
    cadence: 'daily',
    goal: 'Inspect new issues, classify them, and write a reviewable triage summary.',
    verifierProfile: 'triage-report',
    maxAttempts: 1,
    stopConditions: ['done', 'blocked', 'needs-human-review'],
  },
  'dependency-refresh': {
    title: 'Dependency refresh',
    type: 'maintenance',
    triggerKind: 'manual',
    goal: 'Check dependency drift, apply safe updates, and verify with the project test profile.',
    verifierProfile: 'project-tests',
    maxAttempts: 2,
    stopConditions: ['verifier-passed', 'verifier-failed', 'needs-human-review'],
  },
  'docs-drift-check': {
    title: 'Docs drift check',
    type: 'schedule',
    triggerKind: 'scheduled',
    cadence: 'weekly',
    goal: 'Check whether docs still match current scripts, commands, and public claims.',
    verifierCommand: 'npm run docs:check',
    verifierProfile: 'docs',
    maxAttempts: 1,
    stopConditions: ['verifier-passed', 'verifier-failed', 'needs-human-review'],
  },
  'nightly-health': {
    title: 'Nightly health',
    type: 'schedule',
    triggerKind: 'scheduled',
    cadence: 'daily',
    goal: 'Run the safest project health checks and report blockers.',
    verifierProfile: 'project-health',
    maxAttempts: 1,
    stopConditions: ['verifier-passed', 'verifier-failed', 'blocked'],
  },
  'visual-qa': {
    title: 'Visual QA',
    type: 'qa',
    triggerKind: 'manual',
    goal: 'Exercise the target UI route, capture evidence, and stop for human review on visual uncertainty.',
    verifierProfile: 'visual',
    maxAttempts: 2,
    stopConditions: ['verifier-passed', 'needs-human-review', 'attempt-limit'],
  },
  'security-scan': {
    title: 'Security scan',
    type: 'security',
    triggerKind: 'manual',
    goal: 'Run bounded security checks, report actionable findings, and avoid autonomous risky changes.',
    verifierProfile: 'security',
    maxAttempts: 1,
    stopConditions: ['done', 'needs-human-review', 'unsafe-to-continue'],
  },
  'demo-proof-refresh': {
    title: 'Demo proof refresh',
    type: 'verification',
    triggerKind: 'manual',
    goal: 'Refresh operating-loop proof artifacts and verify public demo claims.',
    verifierCommand: 'node scripts/operating-proof.js --write',
    verifierProfile: 'operating-proof',
    maxAttempts: 1,
    stopConditions: ['verifier-passed', 'verifier-failed', 'blocked'],
  },
});

function listLoopTemplates() {
  return Object.entries(LOOP_TEMPLATES).map(([id, template]) => ({ id, ...template }));
}

function getLoopTemplate(id) {
  return LOOP_TEMPLATES[id] || null;
}

function instantiateLoopTemplate(id, options = {}) {
  const template = getLoopTemplate(id);
  if (!template) throw new Error(`Unknown loop template: ${id}`);
  return createLoopContract({
    ...template,
    ...options,
    template: id,
    title: options.title || template.title,
    type: options.type || template.type,
    goal: options.goal || template.goal,
  });
}

module.exports = Object.freeze({
  LOOP_TEMPLATES,
  getLoopTemplate,
  instantiateLoopTemplate,
  listLoopTemplates,
});

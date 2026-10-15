'use strict';

const { createHash } = require('crypto');
const { createLoopContract, DEFAULT_COMMAND_TIMEOUT_MS, MAX_TIMER_MS } = require('./contract');
const { persistenceError } = require('./persistence');

const digest = (value) => createHash('sha256').update(value).digest('hex');
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

function commandNeverStarted(result) {
  return result?.outcome === 'interrupted' && result.exitCode === null && result.cleanupError === null
    && result.quiescence?.kind === 'command-not-started' && validTime(result.quiescence.observedAt)
    && validTime(result.completedAt) && typeof result.command === 'string' && Boolean(result.command.trim())
    && ['signal', 'error', 'pid', 'childPid', 'processId'].every((key) => result[key] == null)
    && ['stdout', 'stderr'].every((key) => result[key] === undefined || result[key] === '');
}

function observation(command, result, reached) {
  if (!command) return 'not-configured';
  if (commandNeverStarted(result)) return 'not-started';
  if (!result) return reached ? 'unknown' : 'not-observed';
  if (result.outcome === 'passed' && result.exitCode === 0) return 'passed';
  if (result.outcome === 'failed') return 'failed';
  return 'unknown';
}

// Derived information only. Age, a terminal label, or a missing cleanup error
// are never evidence that an orphaned command has stopped.
function inspectRecovery(loop, options = {}) {
  const now = options.now ?? Date.now();
  const runs = Array.isArray(loop.runs) ? loop.runs : [];
  const last = runs.at(-1);
  const attempts = runs.reduce((max, run) => Math.max(max, run?.attempt || 0), 0);
  const started = Date.parse(loop.startedAt);
  const duration = loop.budget?.maxDurationMs;
  const deadline = duration == null ? null : started + duration;
  const remainingMs = deadline === null ? null : (Number.isFinite(deadline) ? Math.max(0, deadline - now) : 0);
  const currentResult = last?.[`${last.phase}Result`];
  const quiescence = currentResult?.quiescence;
  const cleanupErrors = runs.flatMap((run) => [run?.actionResult?.cleanupError, run?.verifierResult?.cleanupError]).filter(Boolean);
  const noCommandStarted = runs.length === 1 && last?.attempt === 1 && last.outcome === 'interrupted'
    && last.status === 'interrupted' && last.exitCode == null && (
    (last.phase === 'action' && last.command === loop.trigger?.command && last.actionResult?.command === last.command
      && commandNeverStarted(last.actionResult) && !last.verifierResult)
    || (!loop.trigger?.command && !last.command && last.phase === 'verifier'
      && last.verifierResult?.command === loop.verifier?.command
      && commandNeverStarted(last.verifierResult) && !last.actionResult)
  );
  const observedQuiescence = noCommandStarted && commandNeverStarted(currentResult);
  let decision = 'inspection-required';
  let reason = 'active-or-pending';
  if (['paused', 'needs-human-review'].includes(loop.status)) {
    decision = 'terminal-no-continuation'; reason = 'operator-review-boundary';
  } else if (!['planned', 'running', 'waiting', 'interrupted'].includes(loop.status)) {
    decision = 'terminal-no-continuation'; reason = 'terminal-boundary';
  } else if (loop.status === 'interrupted') {
    if (loop.stopReason !== 'interrupted') {
      decision = 'terminal-no-continuation'; reason = 'stop-reason-boundary';
    } else if (attempts >= loop.budget?.maxAttempts || remainingMs === 0) {
      decision = 'terminal-no-continuation'; reason = 'source-budget-exhausted';
    } else if (loop.budget?.maxSpend != null || loop.budget?.costPerRun != null) {
      decision = 'terminal-no-continuation'; reason = 'unmeasured-spend-budget';
    } else if (typeof loop.verifier?.command !== 'string' || !loop.verifier.command.trim()) {
      reason = 'missing-verifier';
    } else if (!last?.runId || !validTime(last.completedAt) || runs.some((run) => !validTime(run?.completedAt))) {
      reason = 'incomplete-receipt';
    } else if (cleanupErrors.length || !observedQuiescence) {
      reason = 'quiescence-unproven';
    } else {
      decision = 'verification-followup-available'; reason = 'observed-quiescence';
    }
  }
  const revision = loop.revision ?? 0;
  return {
    sourceLoopId: loop.id, sourceRevision: revision, sourceStatus: loop.status,
    stopReason: loop.stopReason ?? null,
    lastRun: last ? { runId: last.runId ?? null, attempt: last.attempt ?? null,
      phase: last.phase ?? null, completedAt: last.completedAt ?? null } : null,
    actionObservation: observation(loop.trigger?.command, last?.actionResult,
      ['action', 'verifier'].includes(last?.phase)),
    verifierObservation: observation(loop.verifier?.command, last?.verifierResult, last?.phase === 'verifier'),
    effectOutcome: 'not-established-by-recovery',
    remainingAttempts: Math.max(0, (loop.budget?.maxAttempts || 0) - attempts),
    deadlineAt: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null,
    remainingDurationMs: remainingMs, cleanupErrors,
    quiescence: observedQuiescence ? quiescence : null,
    decision, reason,
    verifierCommand: loop.verifier?.command ?? null,
    authorization: 'An explicit --write invocation authorizes one bounded invocation of this exact shell command; verifier does not imply read-only effects.',
    nextCommand: decision === 'verification-followup-available'
      ? `node scripts/loops.js recover ${loop.id} --verify-only --expected-revision ${revision}` : null,
  };
}

function recoveryPlan(source, expectedRevision, options = {}) {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw persistenceError('LOOP_INVALID_OPTIONS', 'expectedRevision must be a non-negative safe integer');
  }
  if ((source.revision ?? 0) !== expectedRevision) {
    throw persistenceError('LOOP_REVISION_CONFLICT', `Loop revision conflict: expected ${expectedRevision}, found ${source.revision ?? 0}`);
  }
  const summary = inspectRecovery(source, { now });
  if (summary.decision !== 'verification-followup-available') {
    throw persistenceError('LOOP_RECOVERY_REFUSED', `Recovery is inspection-only: ${summary.reason}`, { recoverySummary: summary });
  }
  const commandTimeoutMs = Math.min(source.budget.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    summary.remainingDurationMs ?? Infinity);
  const recoveryOf = {
    sourceLoopId: source.id, sourceRevision: expectedRevision,
    sourceRunId: summary.lastRun.runId, mode: 'verify-only', verifierDigest: digest(source.verifier.command),
  };
  const id = `verify-${digest(JSON.stringify([source.id, expectedRevision, 'verify-only']))}`;
  const child = createLoopContract({
    id, type: 'verification-followup', title: `Verification follow-up: ${source.id}`,
    goal: source.input?.goal || source.title, scopeDescription: source.scope?.description,
    paths: source.scope?.paths, permissions: source.permissions,
    verifierCommand: source.verifier.command, verifierProfile: source.verifier.profile,
    maxAttempts: 1, maxDurationMs: commandTimeoutMs, commandTimeoutMs,
    stopConditions: ['verifier-passed', 'verifier-failed', 'interrupted', 'timeout', 'stopped'],
    now: new Date(now).toISOString(),
  });
  return { recoverySummary: summary, child: { ...child, recoveryOf, recoveryExecution: null } };
}

function assertRecoveryBinding(source, child) {
  const plan = recoveryPlan(source, child.recoveryOf?.sourceRevision);
  const expected = plan.child;
  const timeout = child.budget?.commandTimeoutMs;
  const sourceDeadline = source.budget.maxDurationMs == null ? Infinity : Date.parse(source.startedAt) + source.budget.maxDurationMs;
  const admissionRemaining = sourceDeadline - Date.parse(child.createdAt);
  if (child.id !== expected.id || JSON.stringify(child.recoveryOf) !== JSON.stringify(expected.recoveryOf)
    || child.trigger?.command != null || child.verifier?.command !== source.verifier.command
    || child.budget?.maxAttempts !== 1 || child.retry?.maxAttempts !== 1
    || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIMER_MS
    || timeout > (source.budget.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS)
    || !validTime(child.createdAt) || Number.isNaN(admissionRemaining) || timeout > admissionRemaining
    || child.budget?.maxDurationMs !== timeout
    || !child.stopConditions?.includes('verifier-failed')) {
    throw persistenceError('LOOP_RECOVERY_CONFLICT', 'Recovery child no longer matches its authorized verification-only plan');
  }
  return source;
}

module.exports = Object.freeze({ inspectRecovery, recoveryPlan, assertRecoveryBinding });

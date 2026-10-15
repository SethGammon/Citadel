'use strict';

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const registry = require('./registry');
const { DEFAULT_COMMAND_TIMEOUT_MS, MAX_TIMER_MS, validateLoopContract } = require('./contract');

const OUTPUT_LIMIT = 4000;
const CLEANUP_TIMEOUT_MS = 2000;

// Commands are foreground shell commands. Cancellation targets only this
// invocation's child tree, never an executable name or the caller's process group.
function terminateCommand(child) {
  return new Promise((resolve) => {
    if (!child.pid) return resolve(null);
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') return resolve(error.message);
      }
      return resolve(null);
    }
    const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let diagnostic = '';
    killer.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk.toString()).slice(-OUTPUT_LIMIT); });
    const failed = (message) => {
      // This fallback can stop the shell only. Retain the failure so callers do
      // not mistake it for successful descendant cleanup.
      try { child.kill('SIGKILL'); } catch { /* child may already have exited */ }
      resolve(message);
    };
    const timer = setTimeout(() => {
      killer.kill();
      failed('Process-tree termination exceeded its cleanup limit.');
    }, CLEANUP_TIMEOUT_MS);
    killer.once('error', (error) => { clearTimeout(timer); failed(error.message); });
    killer.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(null);
      else failed(`Process-tree termination exited ${code}: ${diagnostic.trim()}`);
    });
  });
}

function runCommand(command, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (typeof command !== 'string' || !command.trim()) throw new TypeError('Command must be a non-empty string');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_MS) {
    throw new TypeError(`Command timeout must be an integer between 1 and ${MAX_TIMER_MS}`);
  }
  return new Promise((resolve) => {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    let stdout = '';
    let stderr = '';
    let interruption = null;
    let settled = false;
    let cleanup = null;
    let cleanupTimer;
    let timer;
    let poll;
    let child;
    const finish = async (exitCode, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      options.signal?.removeEventListener('abort', abort);
      const cleanupError = cleanup ? await cleanup : null;
      clearTimeout(cleanupTimer);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      resolve({
        command, exitCode: interruption ? null : exitCode, signal: signal || null,
        outcome: interruption || (error || exitCode !== 0 ? 'failed' : 'passed'),
        stdout, stderr, error: error?.message || null, cleanupError,
        // A never-spawned observation is stronger than a successful tree kill:
        // the latter cannot account for escaped/detached descendants.
        quiescence: !child ? { kind: 'command-not-started', observedAt: new Date().toISOString() } : null,
        startedAt, completedAt: new Date().toISOString(),
      });
    };
    const cancel = (reason) => {
      if (settled || interruption) return;
      interruption = reason;
      cleanup = terminateCommand(child);
      // Bound waiting for inherited pipes or an unavailable OS cleanup helper.
      cleanupTimer = setTimeout(() => { child.unref(); finish(null, null); }, CLEANUP_TIMEOUT_MS + 100);
    };
    const abort = () => cancel('interrupted');
    if (options.signal?.aborted || options.shouldInterrupt?.()) {
      interruption = 'interrupted';
      finish(null, null);
      return;
    }
    try {
      child = spawn(command, {
        cwd: options.cwd || process.cwd(), shell: true, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) { finish(null, null, error); return; }
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-OUTPUT_LIMIT); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-OUTPUT_LIMIT); });
    child.once('error', (error) => finish(null, null, error));
    child.once('close', (code, signal) => {
      // A zero exit delivered after the deadline or stop is never success.
      if (!interruption && Date.now() - startedMs >= timeoutMs) interruption = 'timeout';
      if (!interruption && (options.signal?.aborted || options.shouldInterrupt?.())) interruption = 'interrupted';
      finish(code, signal);
    });
    timer = setTimeout(() => cancel('timeout'), timeoutMs);
    if (options.shouldInterrupt) poll = setInterval(() => {
      if (options.shouldInterrupt()) cancel('interrupted');
    }, 50);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

class Halt extends Error {
  constructor(status) { super(status); this.status = status; }
}

class StateChanged extends Error {
  constructor(current) { super('Loop state changed during execution'); this.current = current; }
}

async function superviseLoop(projectRoot, id, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const now = options.now || Date.now;
  const execute = options.executeCommand || runCommand;
  let loop = registry.readLoop(root, id);
  if (!loop) throw new Error(`Loop not found: ${id}`);
  const validation = validateLoopContract(loop);
  if (!validation.pass) throw new Error(`Invalid loop contract: ${validation.errors.join('; ')}`);
  if (typeof loop.verifier?.command !== 'string' || !loop.verifier.command.trim()) {
    throw new Error('A bounded loop needs a verifier command');
  }
  if (!['planned', 'running'].includes(loop.status)) return { ...loop, verified: false };
  if (loop.recoveryOf) loop = registry.claimRecoveryExecution(root, loop);
  const startedMs = loop.startedAt ? Date.parse(loop.startedAt) : now();
  if (!Number.isFinite(startedMs)) throw new Error('Invalid loop startedAt');
  const deadline = loop.budget.maxDurationMs == null ? Infinity : startedMs + loop.budget.maxDurationMs;
  let activeRun = null;
  const iso = () => new Date(now()).toISOString();
  const revision = (value) => value.revision ?? 0;
  const persist = (patch) => {
    try {
      loop = registry.updateLoop(root, id, patch, { expectedRevision: revision(loop) });
      return loop;
    } catch (error) {
      if (error.code === 'LOOP_REVISION_CONFLICT' || error.code === 'LOOP_TERMINAL') {
        throw new StateChanged(registry.readLoop(root, id));
      }
      throw error;
    }
  };
  const admission = () => {
    const current = registry.readLoop(root, id);
    if (!current || revision(current) !== revision(loop) || !['planned', 'running'].includes(current.status)) {
      throw new StateChanged(current);
    }
    if (loop.recoveryOf) registry.checkRecoverySource(root, loop);
    if (options.signal?.aborted) throw new Halt('interrupted');
    if (now() >= deadline) throw new Halt('timeout');
  };
  const runsWithActive = () => (loop.runs || []).map((run) => run.runId === activeRun?.runId ? activeRun : run);
  const changedResult = (current) => {
    // Stop wins admission, but must not discard observations from the command
    // already in flight. Merge only our pending receipt into freshly read state.
    for (let retry = 0; retry < 3; retry++) {
      current = registry.readLoop(root, id);
      if (!current || !activeRun
        || !current.runs.some((run) => run.runId === activeRun.runId && run.completedAt === null)) break;
      try {
        current = registry.updateLoop(root, id, {
          ...(['planned', 'running'].includes(current.status) ? {
            status: 'interrupted', stoppedAt: current.stoppedAt ?? iso(),
            stopReason: current.stopReason ?? 'state-changed',
          } : {}),
          runs: current.runs.map((run) => run.runId === activeRun.runId
            ? {
              ...run, status: 'interrupted', outcome: 'interrupted', completedAt: iso(),
              ...(activeRun.phase ? { phase: activeRun.phase } : {}),
              ...(activeRun.actionResult ? { actionResult: activeRun.actionResult } : {}),
              ...(activeRun.verifierResult ? { verifierResult: activeRun.verifierResult } : {}),
              ...(activeRun.exitCode !== undefined ? { exitCode: activeRun.exitCode } : {}),
            } : run),
        }, { expectedRevision: revision(current) });
        break;
      } catch (error) {
        if (error.code !== 'LOOP_REVISION_CONFLICT' || retry === 2) throw error;
      }
    }
    return {
      ...(current || { ...loop, status: 'interrupted' }), verified: false,
      cleanupError: activeRun?.verifierResult?.cleanupError || activeRun?.actionResult?.cleanupError || null,
    };
  };
  const finish = (status) => {
    if (activeRun && !activeRun.completedAt) {
      activeRun = { ...activeRun, status, outcome: status, completedAt: iso() };
    }
    const completed = persist({
      status, stoppedAt: iso(), stopReason: status,
      ...(activeRun ? { runs: runsWithActive() } : {}),
    });
    return { ...completed, verified: status === 'verifier-passed' };
  };
  const command = async (value, phase) => {
    admission();
    activeRun = { ...activeRun, phase };
    persist({ runs: runsWithActive() });
    admission();
    let admissionError;
    const source = loop.recoveryOf ? registry.checkRecoverySource(root, loop) : null;
    const sourceRemaining = source?.budget.maxDurationMs == null ? Infinity
      : Date.parse(source.startedAt) + source.budget.maxDurationMs - now();
    const result = await execute(value, {
      cwd: root,
      timeoutMs: Math.max(1, Math.min(loop.budget.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, deadline - now(), sourceRemaining)),
      signal: options.signal,
      shouldInterrupt: () => {
        try { admission(); return false; } catch (error) { admissionError = error; return true; }
      },
    });
    activeRun = { ...activeRun, [`${phase}Result`]: result, exitCode: result.exitCode };
    if (admissionError) throw admissionError;
    admission();
    if (result.outcome === 'timeout') throw new Halt('timeout');
    if (result.outcome === 'interrupted') throw new Halt('interrupted');
    return result;
  };

  try {
    admission();
    // Re-entry never silently repeats an action with an incomplete receipt.
    const incomplete = (loop.runs || []).find((run) => run.completedAt === null);
    if (incomplete) {
      activeRun = { ...incomplete, runId: incomplete.runId || randomUUID() };
      if (!incomplete.runId) persist({ runs: loop.runs.map((run) => run === incomplete ? activeRun : run) });
      return finish('interrupted');
    }
    persist({ status: 'running', startedAt: new Date(startedMs).toISOString(),
      deadlineAt: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null });
    const attempts = (loop.runs || []).reduce((max, run) => Math.max(max, run.attempt || 0), 0);
    for (let attempt = attempts + 1; attempt <= loop.budget.maxAttempts; attempt++) {
      admission();
      activeRun = {
        runId: randomUUID(), attempt, status: 'running', outcome: null,
        command: loop.trigger.command || null, verifier: loop.verifier.command,
        startedAt: iso(), completedAt: null,
      };
      // Durable admission precedes every effect, including verifier-only runs.
      persist({ runs: [...(loop.runs || []), activeRun] });
      if (loop.trigger.command) {
        const action = await command(loop.trigger.command, 'action');
        if (action.outcome !== 'passed' || action.exitCode !== 0) return finish('action-failed');
      }
      const verification = await command(loop.verifier.command, 'verifier');
      const passed = verification.outcome === 'passed' && verification.exitCode === 0;
      activeRun = { ...activeRun, status: passed ? 'verifier-passed' : 'verifier-failed',
        outcome: passed ? 'verifier-passed' : 'verifier-failed', completedAt: iso() };
      if (passed) return finish('verifier-passed');
      if (loop.stopConditions.includes('verifier-failed')) return finish('verifier-failed');
      persist({ runs: runsWithActive() });
    }
    return finish('attempt-limit');
  } catch (error) {
    if (error instanceof StateChanged) return changedResult(error.current);
    if (error instanceof Halt) {
      if (error.status === 'interrupted' && !activeRun && !loop.runs.length) {
        // Cancellation before the first admission has no dispatched command.
        // Give inspection positive evidence without inferring orphan liveness.
        const phase = loop.trigger.command ? 'action' : 'verifier';
        activeRun = {
          runId: randomUUID(), attempt: 1, status: 'interrupted', outcome: 'interrupted', phase,
          command: loop.trigger.command || null, verifier: loop.verifier.command,
          startedAt: iso(), completedAt: iso(),
          [`${phase}Result`]: { command: phase === 'action' ? loop.trigger.command : loop.verifier.command,
            outcome: 'interrupted', exitCode: null, cleanupError: null, startedAt: iso(), completedAt: iso(),
            quiescence: { kind: 'command-not-started', observedAt: iso() } },
        };
        try { persist({ runs: [activeRun] }); } catch (conflict) {
          if (conflict instanceof StateChanged) return changedResult(conflict.current);
          throw conflict;
        }
      }
      try { return finish(error.status); } catch (conflict) {
        if (conflict instanceof StateChanged) return changedResult(conflict.current);
        throw conflict;
      }
    }
    // Preserve a truthful interrupted receipt when an executor or state read fails.
    try { finish('interrupted'); } catch { /* never overwrite a concurrent stop */ }
    throw error;
  }
}

module.exports = Object.freeze({ runCommand, superviseLoop });

'use strict';

// A completed-operation delivery checkpoint, not a worker/session resumer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { digest, runOperation, verifyReport, routeOperation } = require('../core/operation-controller');
const { readJournal } = require('../core/operations');
const { executeStepAttempt } = require('./operation-runner');

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function safePath(input) {
  const resolved = path.resolve(input);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) fail('CHECKPOINT_UNSAFE_PATH', `Symbolic links are not supported: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail('CHECKPOINT_WORKSPACE_INVALID', 'Checkpointed operations require a Git workspace with a committed HEAD.');
  return result.stdout;
}

function context(options) {
  // Native realpath restores Windows filesystem casing; the JS implementation
  // can retain caller casing and disagree with Git for the same directory.
  const root = fs.realpathSync.native(safePath(options.workspaceRoot));
  const checkpoint = safePath(options.checkpoint);
  const relative = path.relative(root, checkpoint);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    fail('CHECKPOINT_UNSAFE_PATH', 'Keep the checkpoint outside the workspace.');
  }
  if (path.relative(fs.realpathSync.native(git(root, ['rev-parse', '--show-toplevel']).trim()), root) !== '') {
    fail('CHECKPOINT_WORKSPACE_INVALID', 'Use the Git repository root as --workspace.');
  }
  const binding = { schema: 1, workspace: root, head: git(root, ['rev-parse', 'HEAD']).trim(), request: options.request, catalog: options.catalog, history: options.history || [] };
  return { root, checkpoint, payload: digest(binding) };
}

function snapshot(root, required = []) {
  const names = new Set([...git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean), ...required]);
  return [...names].sort().map((name) => {
    const file = safePath(path.resolve(root, name));
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('CHECKPOINT_UNSAFE_PATH', 'Artifact escaped workspace.');
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) fail('CHECKPOINT_UNSAFE_PATH', `Only regular workspace files are supported: ${name}`);
      return { path: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), executable: process.platform === 'win32' ? null : Boolean(stat.mode & 0o111) };
    } catch (error) { if (error.code === 'ENOENT') return { path: name, absent: true }; throw error; }
  });
}

function writeNew(file, value) {
  const fd = fs.openSync(safePath(file), 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function runCheckpointed(options) {
  // Validate admission before claiming a checkpoint or launching an adapter.
  routeOperation(options);
  const ctx = context(options);
  snapshot(ctx.root, options.request.verifier.required_changed_paths);
  // Exclusive creation is the single-writer claim. Never reclaim stale state.
  try { fs.mkdirSync(ctx.checkpoint, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') fail('CHECKPOINT_EXISTS', 'Checkpoint already exists. Use operation continue; do not rerun the worker.');
    throw error;
  }
  let report;
  let cause;
  const result = executeStepAttempt({
    journalDir: path.join(ctx.checkpoint, 'journal'),
    attempt: { protocol_version: '0.1', kind: 'step_attempt', attempt_id: 'attempt-1', run_id: 'operation-run', step_id: 'operation', attempt_number: 1, status: 'running', started_at: new Date().toISOString(), completed_at: null, evidence_ids: [], failure_code: null },
    idempotencyKey: 'operation', effectClass: 'external-nonrepeatable', payloadDigest: ctx.payload,
    effect() {
      try {
        report = runOperation(options);
        if (report.status !== 'passed' || verifyReport(report).status !== 'verified') fail('CHECKPOINT_NOT_VERIFIED', 'Operation did not pass; automatic continuation is blocked.');
        const accepted = { schema: 1, payload_digest: ctx.payload, report, files: snapshot(ctx.root, options.request.verifier.required_changed_paths) };
        writeNew(path.join(ctx.checkpoint, 'accepted.json'), accepted);
        return { evidence_digest: digest(accepted) };
      } catch (error) { cause = error; throw error; }
    },
  });
  if (result.status !== 'completed') fail('CONTINUATION_BLOCKED', `${cause?.message || 'Operation outcome is uncertain.'} Inspect the checkpoint and workspace; no automatic retry is allowed.`);
  return report;
}

function guardExports(options, files) {
  const ctx = context(options);
  for (const file of files.filter(Boolean)) {
    const target = safePath(file);
    for (const protectedRoot of [ctx.root, ctx.checkpoint]) {
      const relative = path.relative(protectedRoot, target);
      if (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
        fail('CHECKPOINT_UNSAFE_PATH', 'Report exports must be outside the workspace and checkpoint.');
      }
    }
  }
}

function continueOperation(options) {
  routeOperation(options);
  const ctx = context(options);
  const journalDir = safePath(path.join(ctx.checkpoint, 'journal'));
  // Check files before the journal reader follows them.
  let names;
  try { names = fs.readdirSync(journalDir); } catch (error) {
    if (error.code === 'ENOENT') fail('CONTINUATION_BLOCKED', 'No journal exists. Inspect the prior run; continuation will not launch a worker.');
    throw error;
  }
  for (const name of names) safePath(path.join(journalDir, name));
  const { entries } = readJournal(journalDir);
  if (entries.some((entry) => entry.payload_digest !== ctx.payload)) fail('CONTINUATION_INPUT_CHANGED', 'Request, catalog, history, workspace or HEAD changed.');
  if (entries.length !== 2 || entries[0].state !== 'pending' || entries[1].state !== 'completed'
    || entries.some((entry) => entry.idempotency_key !== 'operation' || entry.effect_class !== 'external-nonrepeatable')) {
    fail('CONTINUATION_BLOCKED', 'No completed verified checkpoint. Inspect the prior run; continuation will not launch or retry a worker.');
  }
  const accepted = JSON.parse(fs.readFileSync(safePath(path.join(ctx.checkpoint, 'accepted.json')), 'utf8'));
  if (accepted.schema !== 1 || accepted.payload_digest !== ctx.payload || digest(accepted) !== entries[1].evidence_digest
    || accepted.report?.request_digest !== digest(options.request)
    || accepted.report?.status !== 'passed' || verifyReport(accepted.report).status !== 'verified') {
    fail('CONTINUATION_EVIDENCE_INVALID', 'Accepted report or evidence changed.');
  }
  if (digest(snapshot(ctx.root, options.request.verifier.required_changed_paths)) !== digest(accepted.files)) {
    fail('CONTINUATION_ARTIFACT_CHANGED', 'Workspace files changed since verification.');
  }
  return accepted.report;
}

module.exports = { runCheckpointed, continueOperation, guardExports };

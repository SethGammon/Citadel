#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync: defaultExecFileSync } = require('child_process');
const { listRuntimeIds } = require('./registry');

const VALID_RUNTIMES = Object.freeze(listRuntimeIds().concat('openai'));
const RUNTIME_ALIASES = Object.freeze({
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  openai: 'openai',
  responses: 'openai',
  'responses-api': 'openai',
  opencode: 'opencode',
  'open-code': 'opencode',
  unknown: 'unknown',
});

const PROCESS_TREE_MARKERS = Object.freeze([
  ['opencode', 'opencode'],
  ['codex', 'codex'],
  ['claude', 'claude-code'],
]);

const DIRECTORY_MARKERS = Object.freeze([
  ['.claude', 'claude-code'],
  ['.codex', 'codex'],
  ['.opencode', 'opencode'],
]);

class RuntimeDetectionError extends Error {
  constructor(code, message, candidates = []) {
    super(message);
    this.name = 'RuntimeDetectionError';
    this.code = code;
    this.candidates = Object.freeze([...candidates]);
    this.repairCommand = 'Set CITADEL_RUNTIME to one active runtime or pass --runtime explicitly, '
      + 'then run node .citadel/scripts/citadel-config.js reconcile --apply '
      + '--runtime <runtime> --json.';
  }
}

function normalizeRuntimeId(value) {
  const id = String(value || '').trim().toLowerCase();
  return RUNTIME_ALIASES[id] || null;
}

function runtimeError(code, candidates = []) {
  if (code === 'CITADEL_RUNTIME_INVALID') {
    return new RuntimeDetectionError(
      code,
      'CITADEL_RUNTIME is unsupported (' + (candidates[0] || 'empty') + '). '
        + 'Set it to claude-code, codex, opencode, or openai.',
      candidates,
    );
  }
  const labels = candidates.length ? ' (' + candidates.join(', ') + ')' : '';
  return new RuntimeDetectionError(
    'CITADEL_RUNTIME_AMBIGUOUS',
    'Multiple Citadel runtimes are present' + labels + '; the active runtime is not inferable. '
      + 'Set CITADEL_RUNTIME or pass --runtime explicitly, then regenerate effective config.',
    candidates,
  );
}

function processTreeCandidates(options = {}) {
  const platform = options.platform || process.platform;
  const ppid = options.ppid || process.ppid;
  const execFileSync = options.execFileSync || defaultExecFileSync;
  let parentInfo = '';
  try {
    if (platform === 'win32') {
      try {
        parentInfo = execFileSync(
          'wmic',
          ['process', 'where', 'ProcessId=' + ppid, 'get', 'CommandLine', '/format:list'],
          { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
        ).toLowerCase();
      } catch {
        parentInfo = execFileSync(
          'tasklist',
          ['/FI', 'PID eq ' + ppid, '/FO', 'CSV', '/NH'],
          { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
        ).toLowerCase();
      }
    } else {
      parentInfo = execFileSync(
        'ps',
        ['-p', String(ppid), '-o', 'command='],
        { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] },
      ).toLowerCase();
    }
  } catch {
    return [];
  }

  return [...new Set(
    PROCESS_TREE_MARKERS
      .filter(([marker]) => parentInfo.includes(marker))
      .map(([, runtime]) => runtime),
  )];
}

function directoryCandidates(root, fsImpl = fs) {
  return DIRECTORY_MARKERS
    .filter(([marker]) => fsImpl.existsSync(path.join(root, marker)))
    .map(([, runtime]) => runtime);
}

function detectRuntime(projectRoot, options = {}) {
  const env = options.env || process.env;
  const root = projectRoot || env.CLAUDE_PROJECT_DIR || options.cwd || process.cwd();
  const explicit = env.CITADEL_RUNTIME;
  if (explicit) {
    const normalized = normalizeRuntimeId(explicit);
    if (!normalized || !VALID_RUNTIMES.includes(normalized)) {
      throw runtimeError('CITADEL_RUNTIME_INVALID', [explicit]);
    }
    return { runtime: normalized, method: 'env' };
  }

  const processCandidatesFound = processTreeCandidates(options);
  if (processCandidatesFound.length > 1) {
    throw runtimeError('CITADEL_RUNTIME_AMBIGUOUS', processCandidatesFound);
  }
  if (processCandidatesFound.length === 1) {
    return { runtime: processCandidatesFound[0], method: 'process-tree' };
  }

  const present = directoryCandidates(root, options.fsImpl || fs);
  if (present.length > 1) {
    throw runtimeError('CITADEL_RUNTIME_AMBIGUOUS', present);
  }
  if (present.length === 1) {
    return { runtime: present[0], method: 'directory-marker' };
  }

  return { runtime: 'unknown', method: 'default' };
}

module.exports = Object.freeze({
  DIRECTORY_MARKERS,
  PROCESS_TREE_MARKERS,
  RUNTIME_ALIASES,
  RuntimeDetectionError,
  VALID_RUNTIMES,
  detectRuntime,
  directoryCandidates,
  normalizeRuntimeId,
  processTreeCandidates,
});

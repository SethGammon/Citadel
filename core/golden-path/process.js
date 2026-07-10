'use strict';

const { spawnSync } = require('child_process');
const { GoldenPathError } = require('./contract');

function sanitize(value) {
  return String(value || '')
    .replace(/(["'](?:token|password|secret|api[_-]?key|access[_-]?key|secret[_-]?access[_-]?key|authorization)["']\s*:\s*["'])[^"']*(["'])/gi, '$1[redacted]$2')
    .replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s,"']+/gi, '$1[redacted]')
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[redacted]')
    .replace(/\b(?:token|password|secret|api[_-]?key|access[_-]?key|secret[_-]?access[_-]?key)\s*[=:]\s*(?!GH_TOKEN\b|GITHUB_TOKEN\b)\S+/gi, '[redacted]')
    .slice(0, 2400)
    .trim();
}

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 90000,
    maxBuffer: options.maxBuffer || 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? sanitize(result.error.message) : null,
  };
}

function parseJson(result, code, label) {
  if (result.status !== 0) {
    throw new GoldenPathError(code, `${label} exited ${result.status}`, evidenceFor(result));
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new GoldenPathError(code, `${label} did not emit JSON`, evidenceFor(result));
  }
}

function evidenceFor(result) {
  return [
    `exit=${result.status === null ? 'null' : result.status}`,
    result.error ? `error=${result.error}` : null,
    result.stdout ? `stdout=${sanitize(result.stdout)}` : null,
    result.stderr ? `stderr=${sanitize(result.stderr)}` : null,
  ].filter(Boolean);
}

module.exports = { evidenceFor, parseJson, runNode, sanitize };

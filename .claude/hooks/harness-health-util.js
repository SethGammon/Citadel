#!/usr/bin/env node

/**
 * harness-health-util.js — Shared utilities for harness hooks.
 *
 * Provides lightweight telemetry and health tracking used by other hooks.
 * All state is file-based (JSON/JSONL) — no databases, no services.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const TELEMETRY_DIR = path.join(PROJECT_ROOT, '.planning', 'telemetry');
const HOOK_TIMING_FILE = path.join(TELEMETRY_DIR, 'hook-timing.jsonl');

/**
 * Ensure telemetry directory exists.
 */
function ensureTelemetryDir() {
  try {
    if (!fs.existsSync(TELEMETRY_DIR)) {
      fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    }
  } catch { /* non-critical */ }
}

/**
 * Increment a counter in the hook timing log.
 * @param {string} hook - Hook name (e.g., 'circuit-breaker', 'quality-gate')
 * @param {string} metric - Metric name (e.g., 'count', 'trips', 'violations')
 */
function increment(hook, metric) {
  ensureTelemetryDir();
  try {
    const entry = JSON.stringify({
      hook,
      metric,
      timestamp: new Date().toISOString(),
    });
    fs.appendFileSync(HOOK_TIMING_FILE, entry + '\n', 'utf8');
  } catch { /* non-critical — telemetry should never break the hook */ }
}

/**
 * Log a timed event (start/end of a hook execution).
 * @param {string} hook - Hook name
 * @param {number} durationMs - Execution time in milliseconds
 * @param {object} [meta] - Optional metadata
 */
function logTiming(hook, durationMs, meta = {}) {
  ensureTelemetryDir();
  try {
    const entry = JSON.stringify({
      hook,
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
      ...meta,
    });
    fs.appendFileSync(HOOK_TIMING_FILE, entry + '\n', 'utf8');
  } catch { /* non-critical */ }
}

/**
 * Read the harness config file if it exists.
 * @returns {object} Config object or empty defaults
 */
function readConfig() {
  const configPath = path.join(PROJECT_ROOT, '.claude', 'harness.json');
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch { /* malformed config — use defaults */ }
  return {
    language: 'unknown',
    framework: null,
    packageManager: 'npm',
    typecheck: { command: null, perFile: false },
    test: { command: null, framework: null },
    qualityRules: { builtIn: [], custom: [] },
    protectedFiles: ['.claude/settings.json', '.claude/hooks/*'],
    features: { intakeScanner: true, telemetry: true },
  };
}

/**
 * Detect the project language from files in the project root.
 * @returns {{ language: string, framework: string|null, packageManager: string }}
 */
function detectStack() {
  const exists = (f) => fs.existsSync(path.join(PROJECT_ROOT, f));

  let language = 'unknown';
  let framework = null;
  let packageManager = 'npm';

  // Language detection
  if (exists('tsconfig.json') || exists('tsconfig.app.json')) {
    language = 'typescript';
  } else if (exists('package.json')) {
    language = 'javascript';
  } else if (exists('requirements.txt') || exists('pyproject.toml') || exists('setup.py')) {
    language = 'python';
  } else if (exists('go.mod')) {
    language = 'go';
  } else if (exists('Cargo.toml')) {
    language = 'rust';
  } else if (exists('build.gradle') || exists('pom.xml')) {
    language = 'java';
  }

  // Framework detection (language-specific)
  if (language === 'typescript' || language === 'javascript') {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['react']) framework = 'react';
      else if (allDeps['vue']) framework = 'vue';
      else if (allDeps['svelte']) framework = 'svelte';
      else if (allDeps['@angular/core']) framework = 'angular';
      else if (allDeps['express'] || allDeps['fastify'] || allDeps['hono']) framework = 'node-api';
      else if (allDeps['next']) framework = 'nextjs';
    } catch { /* no package.json readable */ }
  } else if (language === 'python') {
    if (exists('manage.py')) framework = 'django';
    else if (exists('app.py') || exists('wsgi.py')) framework = 'flask';
    else if (exists('main.py')) framework = 'fastapi';
  }

  // Package manager detection
  if (exists('pnpm-lock.yaml')) packageManager = 'pnpm';
  else if (exists('yarn.lock')) packageManager = 'yarn';
  else if (exists('bun.lockb')) packageManager = 'bun';

  return { language, framework, packageManager };
}

/**
 * Get the typecheck command for a given language.
 * @param {string} language
 * @param {boolean} perFile - Whether to check a single file
 * @returns {{ command: string|null, perFile: boolean }}
 */
function getTypecheckConfig(language) {
  switch (language) {
    case 'typescript':
      return { command: 'npx tsc --noEmit', perFile: true };
    case 'python':
      // Try mypy first, fall back to pyright
      try {
        require('child_process').execFileSync('mypy', ['--version'], { stdio: 'pipe' });
        return { command: 'mypy', perFile: true };
      } catch {
        try {
          require('child_process').execFileSync('pyright', ['--version'], { stdio: 'pipe' });
          return { command: 'pyright', perFile: true };
        } catch {
          return { command: null, perFile: false };
        }
      }
    case 'go':
      return { command: 'go vet', perFile: false };
    case 'rust':
      return { command: 'cargo check', perFile: false };
    case 'java':
      return { command: null, perFile: false };
    default:
      return { command: null, perFile: false };
  }
}

// ── Input Validation ────────────────────────────────────────────────────────

// Paths allow backslash (Windows path separator).
// Commands reject backslash — expected to be simple tool names (e.g., "mypy"),
// not absolute paths. Windows users with paths like C:\Python39\python.exe
// would need to add the tool to PATH instead.
const PATH_META_RE = /[`$;|&\n\r\0]|\$\(/;
const CMD_META_RE = /[`$;|&\n\r\0\\]|\$\(/;

/** @returns {{ safe: boolean, violation: string|null }} */
function _validateInput(value, label, regex) {
  if (!value || typeof value !== 'string') {
    return { safe: false, violation: `empty or non-string ${label}` };
  }
  const match = value.match(regex);
  if (match) {
    return {
      safe: false,
      violation: `shell metacharacter ${JSON.stringify(match[0])} in ${label}: ${value.slice(0, 200)}`,
    };
  }
  return { safe: true, violation: null };
}

function validatePath(filePath) { return _validateInput(filePath, 'path', PATH_META_RE); }
function validateCommand(command) { return _validateInput(command, 'command', CMD_META_RE); }

function securityWarning(hook, message) {
  process.stdout.write(`[SECURITY] ${hook}: ${message}\n`);
  increment(hook, 'security-warning');
}

module.exports = {
  increment,
  logTiming,
  readConfig,
  detectStack,
  getTypecheckConfig,
  validatePath,
  validateCommand,
  securityWarning,
  PROJECT_ROOT,
  TELEMETRY_DIR,
};

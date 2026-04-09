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
const AUDIT_LOG_FILE = path.join(TELEMETRY_DIR, 'audit.jsonl');

// Debug mode — set CITADEL_DEBUG=true in .claude/settings.json env to enable.
// Prints a one-line summary to stderr each time a hook fires or completes.
// Follows the same opt-in pattern as CITADEL_UI.
const CITADEL_DEBUG = process.env.CITADEL_DEBUG === 'true';

/**
 * Emit a debug line to stderr when CITADEL_DEBUG=true.
 * Uses stderr (not stdout) so it doesn't interfere with hook exit codes or
 * structured JSON output on stdout.
 *
 * @param {string} hook  - Hook file name (e.g. 'post-edit', 'circuit-breaker')
 * @param {string} event - Lifecycle point: 'start', 'complete', 'skip', 'block', etc.
 * @param {string} [detail] - Optional one-line context (file path, rule name, etc.)
 */
function debugLog(hook, event, detail = '') {
  if (!CITADEL_DEBUG) return;
  const suffix = detail ? ` — ${detail}` : '';
  process.stderr.write(`[citadel:hook] ${hook} ${event}${suffix}\n`);
}

/**
 * Plugin-scoped data directory for mutable state that survives plugin updates.
 * Uses CLAUDE_PLUGIN_DATA env var when available (Claude Code >= recent release).
 * Falls back to .claude/ in the project root for backward compatibility.
 */
const PLUGIN_DATA_DIR = process.env.CLAUDE_PLUGIN_DATA || path.join(PROJECT_ROOT, '.claude');

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
      schema: 1,
      hook,
      event: 'counter',
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
      schema: 1,
      hook,
      event: 'timing',
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
    protectedFiles: ['.claude/harness.json'],
    features: { intakeScanner: true, telemetry: true },
    policy: {
      scopeEnforcement: 'warn',   // 'warn' | 'block' | 'off'
      auditLog: true,
      allowedOutOfScopeTools: [], // tools exempt from scope warnings
    },
    verification: {
      hot: ['programmatic', 'structural', 'performance'],
      cold: ['performance', 'accessibility', 'adversarial', 'contractual', 'cross-reference'],
      disabled: [],               // lens names to skip entirely
    },
    preCompact: {
      handoffMode: 'auto',        // 'auto' | 'prompt' | 'off'
    },
    docs: {
      auto: true,                 // false to disable automatic doc sync
      audiences: ['user', 'org', 'agents'],
      exclude: [],
    },
    trust: {
      sessions_completed: 0,
      campaigns_completed: 0,
      campaigns_reverted: 0,
      fleet_clean_merges: 0,
      improve_loops_accepted: 0,
      daemon_runs: 0,
      override: null,
    },
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


/**
 * Log a hook block or error event to hook-errors.jsonl.
 * @param {string} hook - Hook name
 * @param {string} action - What happened ('blocked', 'error', 'parse-fail')
 * @param {string} detail - What was blocked or what failed
 */
function logBlock(hook, action, detail) {
  ensureTelemetryDir();
  try {
    const entry = JSON.stringify({
      schema: 1,
      timestamp: new Date().toISOString(),
      hook,
      action,
      detail,
    });
    fs.appendFileSync(path.join(TELEMETRY_DIR, 'hook-errors.jsonl'), entry + '\n', 'utf8');
  } catch { /* telemetry should never break the hook */ }
}

/**
 * Compute the trust level from harness config counters.
 * @returns {{ level: 'novice'|'familiar'|'trusted', trust: object }}
 */
function readTrustLevel() {
  const config = readConfig();
  const defaults = {
    sessions_completed: 0,
    campaigns_completed: 0,
    campaigns_reverted: 0,
    fleet_clean_merges: 0,
    improve_loops_accepted: 0,
    daemon_runs: 0,
    override: null,
  };
  const trust = { ...defaults, ...(config.trust || {}) };

  // Explicit override takes priority
  const validOverrides = ['novice', 'familiar', 'trusted'];
  if (trust.override && validOverrides.includes(trust.override)) {
    return { level: trust.override, trust };
  }

  // Compute from counters
  let level = 'novice';
  if (trust.sessions_completed >= 20 && trust.campaigns_completed >= 2) {
    level = 'trusted';
  } else if (trust.sessions_completed >= 5) {
    level = 'familiar';
  }

  return { level, trust };
}

// ── Input Validation ────────────────────────────────────────────────────────

// Paths allow backslash (Windows path separator).
// Commands reject backslash — expected to be simple tool names (e.g., "mypy"),
// not absolute paths. Windows users with paths like C:\Python39\python.exe
// would need to add the tool to PATH instead.
const PATH_META_RE = /[`$;|&\n\r\0]|\$\(/;
const CMD_META_RE = /[`$;|&\n\r\0\\]|\$\(/;
// Detect path traversal sequences: ../ or ..\ (both forward and back slash)
const PATH_TRAVERSAL_RE = /\.\.[/\\]/;

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
  // For paths: also reject traversal sequences (../  or ..\)
  if (label === 'path' && PATH_TRAVERSAL_RE.test(value)) {
    return {
      safe: false,
      violation: `path traversal sequence in ${label}: ${value.slice(0, 200)}`,
    };
  }
  return { safe: true, violation: null };
}

function validatePath(filePath) { return _validateInput(filePath, 'path', PATH_META_RE); }
function validateCommand(command) { return _validateInput(command, 'command', CMD_META_RE); }

function securityWarning(hook, message) {
  const msg = `[SECURITY] ${hook}: ${message}\n`;
  if (process.env.CITADEL_UI === 'true') {
    process.stdout.write(JSON.stringify({
      hook,
      action: 'security-warning',
      message: msg.trim(),
      timestamp: new Date().toISOString(),
      data: {},
    }));
  } else {
    process.stdout.write(msg);
  }
  increment(hook, 'security-warning');
}

/**
 * Append an entry to the immutable audit log.
 * The audit log is append-only — never truncated, never overwritten.
 * Records significant agent actions, policy violations, and system events.
 *
 * @param {string} event - Event type (e.g., 'scope-violation', 'subagent-stop', 'worktree-removed')
 * @param {object} data - Structured data for the event
 */
function writeAuditLog(event, data = {}) {
  ensureTelemetryDir();
  try {
    const entry = JSON.stringify({
      schema: 1,
      event,
      timestamp: new Date().toISOString(),
      project: path.basename(PROJECT_ROOT),
      ...data,
    });
    fs.appendFileSync(AUDIT_LOG_FILE, entry + '\n', 'utf8');
  } catch { /* audit log should never break a hook */ }
}

// ── Consent System ─────────────────────────────────────────────────────────

/**
 * First-Encounter Consent pattern.
 *
 * On the first occurrence of a protected action category, the hook pauses
 * and informs the user what's about to happen. The user picks one of:
 *   - "always-ask"        Block every time, require explicit approval
 *   - "session-allow"     Allow for this session, ask fresh next session
 *   - "auto-allow"        Trust the agent, never ask again for this category
 *
 * Preferences are stored in harness.json under "consent".
 * Session-scoped allows use a timestamp file in PLUGIN_DATA_DIR.
 *
 * Categories:
 *   - externalActions     git push, gh pr create/merge, gh issue comment, etc.
 *   - daemonSpend         Autonomous multi-session spending
 *   - fleetSpawn          Parallel agent spawning (cost multiplication)
 */

const CONSENT_CATEGORIES = ['externalActions', 'daemonSpend', 'fleetSpawn'];

/**
 * Read the consent preference for a category.
 * @param {string} category - One of CONSENT_CATEGORIES
 * @returns {'always-ask'|'session-allow'|'auto-allow'|null} null = first encounter
 */
function readConsent(category) {
  const config = readConfig();
  const consent = config.consent || {};
  const pref = consent[category] || null;
  if (!pref) return null;
  if (!['always-ask', 'session-allow', 'auto-allow'].includes(pref)) return null;
  return pref;
}

/**
 * Write a consent preference for a category to harness.json.
 * Creates harness.json if it doesn't exist.
 * @param {string} category
 * @param {'always-ask'|'session-allow'|'auto-allow'} preference
 */
function writeConsent(category, preference) {
  const configPath = path.join(PROJECT_ROOT, '.claude', 'harness.json');
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch { /* start fresh */ }

  if (!config.consent) config.consent = {};
  config.consent[category] = preference;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Check if a session-scoped allow is active for a category.
 * Session allows expire after 6 hours (covers long sessions but not overnight).
 * @param {string} category
 * @returns {boolean}
 */
function hasSessionAllow(category) {
  const markerPath = path.join(PLUGIN_DATA_DIR, `consent-session-${category}.json`);
  try {
    if (!fs.existsSync(markerPath)) return false;
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const age = Date.now() - new Date(marker.timestamp).getTime();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    return age < SIX_HOURS;
  } catch { return false; }
}

/**
 * Grant a session-scoped allow for a category.
 * @param {string} category
 */
function grantSessionAllow(category) {
  const markerPath = path.join(PLUGIN_DATA_DIR, `consent-session-${category}.json`);
  const dir = path.dirname(markerPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ category, timestamp: new Date().toISOString() }));
}

/**
 * Grant a one-time approval for a specific action.
 * Consumed on read (single-use). Expires after 120 seconds.
 * Used by "always-ask" consent: hook blocks, user approves, Claude writes
 * a one-time marker, retries, hook consumes the marker and allows.
 * @param {string} category
 */
function grantOneTimeAllow(category) {
  const markerPath = path.join(PLUGIN_DATA_DIR, `consent-onetime-${category}.json`);
  const dir = path.dirname(markerPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ category, timestamp: new Date().toISOString() }));
}

/**
 * Check and consume a one-time approval. Returns true if a fresh marker exists.
 * The marker is deleted after reading (single-use).
 * @param {string} category
 * @returns {boolean}
 */
function consumeOneTimeAllow(category) {
  const markerPath = path.join(PLUGIN_DATA_DIR, `consent-onetime-${category}.json`);
  try {
    if (!fs.existsSync(markerPath)) return false;
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    // Always consume (delete) the marker
    fs.unlinkSync(markerPath);
    const age = Date.now() - new Date(marker.timestamp).getTime();
    const TWO_MINUTES = 120 * 1000;
    return age < TWO_MINUTES;
  } catch {
    try { fs.unlinkSync(markerPath); } catch { /* already gone */ }
    return false;
  }
}

/**
 * Determine if a protected action should proceed based on consent.
 *
 * Returns:
 *   - { action: 'allow' }           Proceed silently
 *   - { action: 'first-encounter' } No preference set yet, hook should inform and block
 *   - { action: 'block' }           User chose always-ask, hook should block
 *
 * @param {string} category
 * @returns {{ action: 'allow'|'block'|'first-encounter' }}
 */
function checkConsent(category) {
  const pref = readConsent(category);

  // First encounter -- no preference stored yet
  if (!pref) return { action: 'first-encounter' };

  // Auto-allow -- user trusts the agent for this category
  if (pref === 'auto-allow') return { action: 'allow' };

  // Session-allow -- check if current session has been granted
  if (pref === 'session-allow') {
    if (hasSessionAllow(category)) return { action: 'allow' };
    return { action: 'block' };
  }

  // Always-ask -- check for one-time approval (user approved in conversation)
  if (pref === 'always-ask') {
    if (consumeOneTimeAllow(category)) return { action: 'allow' };
    return { action: 'block' };
  }

  return { action: 'block' };
}

module.exports = {
  increment,
  logTiming,
  logBlock,
  debugLog,
  writeAuditLog,
  readConfig,
  readTrustLevel,
  detectStack,
  getTypecheckConfig,
  validatePath,
  validateCommand,
  securityWarning,
  readConsent,
  writeConsent,
  hasSessionAllow,
  grantSessionAllow,
  grantOneTimeAllow,
  consumeOneTimeAllow,
  checkConsent,
  CONSENT_CATEGORIES,
  PROJECT_ROOT,
  TELEMETRY_DIR,
  PLUGIN_DATA_DIR,
  CITADEL_DEBUG,
};

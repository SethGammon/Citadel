#!/usr/bin/env node

/**
 * protect-files.js — PreToolUse hook (Edit/Write/Read)
 *
 * Blocks edits to files that should not be modified during agent sessions.
 * Blocks reads on .env files to prevent agents from reading secrets, including
 * .env files outside the project root.
 * Blocks Edit/Write on .env files (template suffixes .example, .sample, and
 * .template are allowed; harness.json allowEnvWrites=true disables this one
 * check).
 * Allows writes to the Claude Code native auto-memory directory under the
 * user home even though it sits outside the project root.
 * Every block reason is mirrored to stderr so runtimes that only surface
 * stderr still show why an action was stopped.
 * Protected paths are configurable via harness.json protectedFiles array.
 *
 * Default protected: .claude/harness.json
 * Users can add their own patterns.
 *
 * Fail-closed: unexpected errors exit 2 (block) rather than 0 (allow).
 *
 * Supports glob patterns:
 *   - Exact path match
 *   - dir/*  — files directly in a directory (single level)
 *   - dir/   — all files under a directory prefix (trailing slash)
 *   - src/** — recursive glob (any depth under src/)
 *   - **\/*.ts — any .ts file at any depth
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const health = require('./harness-health-util');
const { findActiveCampaign } = require('../core/campaigns/load-campaign');

const PROJECT_ROOT = health.PROJECT_ROOT;

const CITADEL_UI = process.env.CITADEL_UI === 'true';

// Development mode bypass — set CITADEL_DEV=true in .claude/settings.json env
// when working on the harness itself. Disables custom protectedFiles patterns
// but keeps .env secrets protection and path-traversal security checks active.
// Safe to leave set during harness development sessions; remove when done.
const CITADEL_DEV = process.env.CITADEL_DEV === 'true';

// .env file names ending in these suffixes are templates, not secrets.
const ENV_TEMPLATE_SUFFIXES = ['.example', '.sample', '.template'];

function hookOutput(hookName, action, message, data = {}) {
  if (CITADEL_UI) {
    process.stdout.write(JSON.stringify({
      hook: hookName,
      action,
      message,
      timestamp: new Date().toISOString(),
      data,
    }));
  } else {
    process.stdout.write(message);
  }
}

// For blocks and errors: keep the stdout payload byte-identical for the
// CITADEL_UI JSON consumers, and mirror the human-readable reason to stderr
// because some runtimes only surface stderr for blocking hooks.
function blockOutput(hookName, action, message, data = {}) {
  hookOutput(hookName, action, message, data);
  process.stderr.write(message.endsWith('\n') ? message : message + '\n');
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      run(input);
    } catch (err) {
      // Fail closed: unexpected errors block the action
      health.logBlock('protect-files', 'error', err.message || 'unknown error');
      blockOutput('protect-files', 'error',
        '[protect-files] Hook error — blocking action as a safety measure. ' +
        'Check .planning/telemetry/hook-errors.log for details.',
        { error: err.message || 'unknown error' }
      );
      process.exit(2);
    }
  });
}

function run(input) {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    health.logBlock('protect-files', 'parse-fail', 'Could not parse stdin JSON');
    // Fail closed on parse failure — cannot determine if action is safe
    blockOutput('protect-files', 'error', '[protect-files] Could not parse hook input — blocking as safety measure.');
    process.exit(2);
  }

  const toolName = event.tool_name || '';
  if (toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'Read') {
    process.exit(0);
  }

  const filePath = event.tool_input?.file_path || event.tool_input?.path || '';
  if (!filePath) {
    process.exit(0);
  }

  // Security: validate path for traversal and shell injection
  const validation = health.validatePath(filePath);
  if (!validation.safe) {
    health.logBlock('protect-files', 'blocked', `${toolName} ${filePath} (${validation.violation})`);
    blockOutput('protect-files', 'blocked',
      `[protect-files] Blocked: ${validation.violation}`,
      { file: filePath, tool: toolName, violation: validation.violation }
    );
    process.exit(2);
  }

  // Security: block writes to absolute paths outside project root. Reads may
  // inspect neighboring docs, vaults, and reference repos; .env reads are still
  // blocked by basename below.
  const normalizedPath = path.normalize(path.resolve(filePath));
  const normalizedRoot = path.normalize(PROJECT_ROOT);
  const insideProject = normalizedPath.startsWith(normalizedRoot + path.sep) || normalizedPath === normalizedRoot;

  // Claude Code native auto-memory lives outside the project root by design.
  // Allow those writes before the outside-project-root block below.
  if (toolName !== 'Read' && !insideProject && isNativeMemoryPath(normalizedPath)) {
    process.exit(0);
  }

  if (toolName !== 'Read' && !insideProject) {
    health.logBlock('protect-files', 'blocked', `${toolName} ${filePath} (outside project root)`);
    blockOutput('protect-files', 'blocked',
      `[protect-files] Blocked: ${filePath} is outside project root (${PROJECT_ROOT})`,
      { file: filePath, tool: toolName, projectRoot: PROJECT_ROOT }
    );
    process.exit(2);
  }

  const relativePath = insideProject
    ? path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/')
    : normalizedPath;

  // Read events: only block .env files (secrets protection)
  if (toolName === 'Read') {
    const basename = path.basename(filePath);
    if (basename.startsWith('.env')) {
      health.logBlock('protect-files', 'blocked', `Read ${relativePath} (.env secrets)`);
      blockOutput('protect-files', 'blocked',
        `[protect-files] Blocked: cannot read ${relativePath} — .env files contain secrets.`,
        { file: relativePath, reason: '.env secrets' }
      );
      process.exit(2);
    }
    process.exit(0);
  }

  const config = health.readConfig();

  // Edit/Write events: symmetric .env protection (Read is blocked above).
  // Template files (.example/.sample/.template) stay writable. Escape hatch:
  // allowEnvWrites=true in harness.json. CITADEL_DEV does not bypass this.
  const basename = path.basename(filePath);
  const isEnvSecret = basename.startsWith('.env') &&
    !ENV_TEMPLATE_SUFFIXES.some((suffix) => basename.endsWith(suffix));
  if (isEnvSecret && config.allowEnvWrites !== true) {
    health.logBlock('protect-files', 'blocked', `${toolName} ${relativePath} (.env secrets)`);
    blockOutput('protect-files', 'blocked',
      `[protect-files] Blocked: cannot ${toolName} ${relativePath} because .env files contain secrets. ` +
      `Template files ending in .example, .sample, or .template are allowed. ` +
      `Set "allowEnvWrites": true in .claude/harness.json to permit .env writes.`,
      { file: relativePath, tool: toolName, reason: '.env secrets' }
    );
    process.exit(2);
  }

  // Edit/Write events: check against protected patterns
  // CITADEL_DEV=true bypasses custom patterns — for harness development only.
  // Secrets (.env) and path-traversal checks above still apply.
  const protectedPatterns = config.protectedFiles || [
    '.claude/harness.json',
  ];

  if (CITADEL_DEV) {
    hookOutput('protect-files', 'dev-bypass',
      `[protect-files] Dev mode active — skipping pattern check for ${relativePath}`,
      { file: relativePath, tool: toolName }
    );
  } else {
    for (const pattern of protectedPatterns) {
      if (matchPattern(relativePath, pattern)) {
        health.logBlock('protect-files', 'blocked', `${toolName} ${relativePath} (pattern: ${pattern})`);
        blockOutput('protect-files', 'blocked',
          `[protect-files] Blocked: ${relativePath} is protected by pattern "${pattern}". ` +
          `Set CITADEL_DEV=true in .claude/settings.json env for harness development, ` +
          `or remove the pattern from harness.json protectedFiles to allow edits.`,
          { file: relativePath, pattern, tool: toolName }
        );
        process.exit(2); // Block the edit
      }
    }
  }

  // Campaign scope enforcement (advisory — warn only, hard block on RESTRICTED)
  checkCampaignScope(relativePath, toolName, filePath);

  process.exit(0);
}

/**
 * Check whether the file being written falls within the active campaign's claimed scope.
 * Warns (exit 0 with message) for out-of-scope writes.
 * Hard-blocks (exit 2) only when the file appears in a "## Restricted Files" section.
 *
 * @param {string} relativePath - Path relative to project root, forward-slash separated
 * @param {string} toolName - 'Edit' or 'Write'
 * @param {string} _filePath - Absolute path (unused here but kept for signature clarity)
 */
function checkCampaignScope(relativePath, toolName, _filePath) {
  try {
    const campaign = findActiveCampaign(PROJECT_ROOT);
    if (!campaign) return;

    const rawName = campaign.slug || 'campaign';
    const campaignName = rawName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const config = health.readConfig();
    const blockRestricted = config.policy?.campaignRestrictions?.blockRestrictedFiles === true;

    for (const entry of campaign.restrictedFiles || []) {
      if (entry && matchPattern(relativePath, entry)) {
        health.logBlock('protect-files', blockRestricted ? 'blocked-restricted' : 'warned-restricted', `${toolName} ${relativePath} (campaign: ${campaignName}, restricted: ${entry})`);
        const emitRestricted = blockRestricted ? blockOutput : hookOutput;
        emitRestricted('protect-files', 'blocked',
          `[protect-files] ${blockRestricted ? 'Blocked' : 'Warning'}: ${relativePath} is declared RESTRICTED by campaign "${campaignName}". ` +
          `${blockRestricted ? 'Remove it from Restricted Files or set policy.campaignRestrictions.blockRestrictedFiles=false to allow edits.' : 'This is advisory; set policy.campaignRestrictions.blockRestrictedFiles=true to enforce.'}`,
          { file: relativePath, campaign: campaignName, restrictedEntry: entry, tool: toolName }
        );
        if (blockRestricted) process.exit(2);
        return;
      }
    }

    const scopeEntries = campaign.claimedScope || [];
    if (scopeEntries.length === 0) return;

    // Check if this file is within any claimed scope entry
    for (const entry of scopeEntries) {
      if (matchScopeEntry(relativePath, entry)) {
        return; // Within claimed scope — allow silently
      }
    }

    // File is outside claimed scope — warn (advisory, not blocking)
    const scopeList = scopeEntries.slice(0, 5).join(', ') + (scopeEntries.length > 5 ? '…' : '');
    hookOutput('protect-files', 'warned',
      `[protect-files] Warning: ${relativePath} is outside the claimed scope of campaign "${campaignName}". ` +
      `Campaign scope: ${scopeList}. This is advisory — the write will proceed.`,
      { file: relativePath, campaign: campaignName, scope: scopeEntries.slice(0, 5) }
    );
    health.increment('protect-files', 'scope-warning');
  } catch {
    // Any unexpected error — skip scope check silently (never block on check failure)
  }
}

/**
 * True when an absolute, normalized path points into the Claude Code native
 * auto-memory directory: <home>/.claude/projects/<slug>/memory/ where <slug>
 * is a single path segment. The memory directory itself also matches.
 * Comparison is case-insensitive on win32.
 * CITADEL_HOME_OVERRIDE replaces the home directory only when CITADEL_TEST=1
 * so tests can exercise this path without touching the real home.
 *
 * @param {string} normalizedPath - Result of path.normalize(path.resolve(...))
 * @returns {boolean}
 */
function isNativeMemoryPath(normalizedPath) {
  const home = (process.env.CITADEL_TEST === '1' && process.env.CITADEL_HOME_OVERRIDE)
    ? process.env.CITADEL_HOME_OVERRIDE
    : os.homedir();
  const projectsRoot = path.normalize(path.resolve(home, '.claude', 'projects'));
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const target = fold(normalizedPath);
  const root = fold(projectsRoot);
  if (!target.startsWith(root + path.sep)) return false;
  const segments = target.slice(root.length + 1).split(path.sep).filter(Boolean);
  return segments.length >= 2 && segments[1] === 'memory';
}

/**
 * Match a file path against a scope entry.
 * Scope entries can be:
 *   - A directory prefix (e.g., "src/auth/") → matches any file under it
 *   - An exact file path (e.g., "src/auth/middleware.ts")
 *   - A glob-like pattern (delegated to matchPattern)
 *
 * @param {string} filePath - Relative file path, forward-slash separated
 * @param {string} entry - Scope entry from campaign file
 * @returns {boolean}
 */
function matchScopeEntry(filePath, entry) {
  // Normalize entry: treat bare directory names as prefix matches
  if (!entry.includes('.') && !entry.endsWith('/')) {
    // Looks like a directory without trailing slash — treat as prefix
    if (filePath === entry || filePath.startsWith(entry + '/')) return true;
  }
  // Delegate to existing pattern matcher for /, /* patterns
  return matchPattern(filePath, entry);
}

/**
 * Match a file path against a glob pattern.
 *
 * Supports:
 *   - Exact path match
 *   - dir/*  — files directly in a directory (single level)
 *   - dir/   — all files under a directory prefix (trailing slash)
 *   - src/** — recursive glob (any depth under src/)
 *   - **\/*.ts — any .ts file at any depth
 *
 * @param {string} filePath - Relative file path, forward-slash separated
 * @param {string} pattern - Glob pattern to match against
 * @returns {boolean}
 */
function matchPattern(filePath, pattern) {
  // Exact match
  if (filePath === pattern) return true;

  // Recursive glob: pattern contains **
  if (pattern.includes('**')) {
    return matchGlobStar(filePath, pattern);
  }

  // Single-level wildcard: pattern ends with /*
  if (pattern.endsWith('/*')) {
    const dir = pattern.slice(0, -2);
    return filePath.startsWith(dir + '/') && !filePath.slice(dir.length + 1).includes('/');
  }

  // Directory prefix: pattern ends with /
  if (pattern.endsWith('/')) {
    return filePath.startsWith(pattern);
  }

  return false;
}

/**
 * Match a file path against a glob pattern containing **.
 * ** matches any sequence of path segments (including zero).
 * Examples:
 *   src/** matches src/foo.ts, src/a/b/c.ts
 *   **\/*.ts matches any .ts file at any depth
 *   src/**\/index.ts matches src/foo/index.ts, src/foo/bar/index.ts
 *
 * @param {string} filePath - Relative file path, forward-slash separated
 * @param {string} pattern - Glob pattern containing **
 * @returns {boolean}
 */
function matchGlobStar(filePath, pattern) {
  // Convert glob to regex
  // Escape regex special chars except * and /
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials
    .replace(/\*\*/g, '\x00')               // temporarily replace ** with placeholder
    .replace(/\*/g, '[^/]*')                // * → match non-slash chars
    .replace(/\x00/g, '.*');                // ** → match anything (including slashes)

  try {
    const re = new RegExp('^' + escaped + '$');
    return re.test(filePath);
  } catch {
    return false; // malformed pattern — fail safe (allow the action)
  }
}

main();

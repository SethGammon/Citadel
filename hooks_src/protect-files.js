#!/usr/bin/env node

/**
 * protect-files.js — PreToolUse hook (Edit/Write/Read)
 *
 * Blocks edits to files that should not be modified during agent sessions.
 * Blocks reads on .env files to prevent agents from reading secrets.
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
const path = require('path');
const health = require('./harness-health-util');

const PROJECT_ROOT = health.PROJECT_ROOT;

const CITADEL_UI = process.env.CITADEL_UI === 'true';

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
      hookOutput('protect-files', 'error',
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
    hookOutput('protect-files', 'error', '[protect-files] Could not parse hook input — blocking as safety measure.');
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

  const relativePath = path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');

  // Read events: only block .env files (secrets protection)
  if (toolName === 'Read') {
    const basename = path.basename(filePath);
    if (basename.startsWith('.env')) {
      health.logBlock('protect-files', 'blocked', `Read ${relativePath} (.env secrets)`);
      hookOutput('protect-files', 'blocked',
        `[protect-files] Blocked: cannot read ${relativePath} — .env files contain secrets.`,
        { file: relativePath, reason: '.env secrets' }
      );
      process.exit(2);
    }
    process.exit(0);
  }

  // Edit/Write events: check against protected patterns
  const config = health.readConfig();
  const protectedPatterns = config.protectedFiles || [
    '.claude/harness.json',
  ];

  for (const pattern of protectedPatterns) {
    if (matchPattern(relativePath, pattern)) {
      health.logBlock('protect-files', 'blocked', `${toolName} ${relativePath} (pattern: ${pattern})`);
      hookOutput('protect-files', 'blocked',
        `[protect-files] Blocked: ${relativePath} is protected by pattern "${pattern}". ` +
        `Remove the pattern from harness.json protectedFiles to allow edits.`,
        { file: relativePath, pattern, tool: toolName }
      );
      process.exit(2); // Block the edit
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
    const campaignsDir = path.join(PROJECT_ROOT, '.planning', 'campaigns');
    if (!fs.existsSync(campaignsDir)) return;

    // Find all campaign files (not in completed/)
    let campaignFiles;
    try {
      campaignFiles = fs.readdirSync(campaignsDir).filter((f) => f.endsWith('.md'));
    } catch {
      return; // unreadable directory — skip silently
    }

    if (campaignFiles.length === 0) return;

    // Use the first active campaign file found
    let campaignText = null;
    let campaignName = null;
    for (const file of campaignFiles) {
      try {
        const text = fs.readFileSync(path.join(campaignsDir, file), 'utf8');
        // Only consider campaigns with Status: active
        if (/^Status:\s*active/im.test(text)) {
          campaignText = text;
          // Sanitize campaign name before rendering into LLM-facing messages:
          // strip non-alphanumeric chars (except hyphens/underscores) to prevent
          // prompt injection via adversarial filenames.
          const rawName = file.replace(/\.md$/, '');
          campaignName = rawName.replace(/[^a-zA-Z0-9_\-]/g, '_');
          break;
        }
      } catch {
        // Malformed or unreadable — skip
      }
    }

    if (!campaignText) return; // No active campaign — skip

    // Extract "## Restricted Files" section
    const restrictedMatch = campaignText.match(/^##\s+Restricted Files\s*\n([\s\S]*?)(?=^##|(?![\s\S]))/m);
    if (restrictedMatch) {
      const restrictedLines = restrictedMatch[1]
        .split('\n')
        .map((l) => l.replace(/^[-*\s]+/, '').trim())
        .filter(Boolean);
      for (const entry of restrictedLines) {
        if (entry && matchPattern(relativePath, entry)) {
          health.logBlock('protect-files', 'blocked-restricted', `${toolName} ${relativePath} (campaign: ${campaignName}, restricted: ${entry})`);
          hookOutput('protect-files', 'blocked',
            `[protect-files] Blocked: ${relativePath} is declared RESTRICTED by campaign "${campaignName}". ` +
            `Remove it from the campaign's "Restricted Files" section to allow edits.`,
            { file: relativePath, campaign: campaignName, restrictedEntry: entry, tool: toolName }
          );
          process.exit(2);
        }
      }
    }

    // Extract "## Claimed Scope" section
    const scopeMatch = campaignText.match(/^##\s+Claimed Scope\s*\n([\s\S]*?)(?=^##|(?![\s\S]))/m);
    if (!scopeMatch) return; // No claimed scope declared — skip

    const scopeEntries = scopeMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[-*\s]+/, '').trim())
      .filter(Boolean);

    if (scopeEntries.length === 0) return; // Empty scope — skip

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

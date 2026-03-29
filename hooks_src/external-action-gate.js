#!/usr/bin/env node

/**
 * external-action-gate.js — PreToolUse hook (Bash)
 *
 * Blocks irreversible external actions and secrets exfiltration:
 *   - Reading .env files via Bash (cat/source — protect-files only guards the Read tool)
 *   - gh pr merge/close/delete
 *   - gh issue close/delete
 *   - gh release create, gh repo fork
 *   - gh api with mutating methods
 *
 * Allowed (reversible — agent may do these autonomously):
 *   - git push (branch can be force-reset or deleted)
 *   - gh pr create (can be closed)
 *   - gh pr/issue comment/edit
 *
 * Strips quoted strings and heredoc bodies before matching to avoid
 * false positives from commit messages and PR descriptions.
 *
 * NOT shipped in settings.json (would break Fleet/Archon autonomy).
 * Users opt-in via settings.local.json.
 *
 * Exit codes:
 *   0 = allowed
 *   2 = blocked — agent must get user approval first
 */

const health = require('./harness-health-util');

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

const BLOCKED_PATTERNS = [
  // Secrets exfiltration — protect-files only guards the Read tool, not Bash reads
  { regex: /\bcat\s+.*\.env(\b|\.)/, label: 'cat .env (secrets)' },
  { regex: /\bsource\s+.*\.env(\b|\.)/, label: 'source .env (secrets)' },
  { regex: /\bhead\s+.*\.env(\b|\.)/, label: 'head .env (secrets)' },
  { regex: /\btail\s+.*\.env(\b|\.)/, label: 'tail .env (secrets)' },
  { regex: /\bgrep\b.*\.env(\b|\.)/, label: 'grep .env (secrets)' },
  { regex: /\bless\s+.*\.env(\b|\.)/, label: 'less .env (secrets)' },
  { regex: /\bmore\s+.*\.env(\b|\.)/, label: 'more .env (secrets)' },
  { regex: /\bgh\s+pr\s+merge\b/, label: 'gh pr merge' },
  { regex: /\bgh\s+pr\s+close\b/, label: 'gh pr close' },
  { regex: /\bgh\s+issue\s+close\b/, label: 'gh issue close' },
  { regex: /\bgh\s+issue\s+delete\b/, label: 'gh issue delete' },
  { regex: /\bgh\s+release\s+create\b/, label: 'gh release create' },
  { regex: /\bgh\s+repo\s+fork\b/, label: 'gh repo fork' },
  { regex: /gh\.exe"\s+pr\s+merge\b/, label: 'gh pr merge' },
  { regex: /gh\.exe"\s+pr\s+close\b/, label: 'gh pr close' },
  { regex: /gh\.exe"\s+issue\s+close\b/, label: 'gh issue close' },
  { regex: /gh\.exe"\s+issue\s+delete\b/, label: 'gh issue delete' },
  { regex: /gh\.exe"\s+release\s+create\b/, label: 'gh release create' },
  { regex: /gh\.exe"\s+repo\s+fork\b/, label: 'gh repo fork' },
  { regex: /\bgh\s+api\b.*--method\s+(POST|PUT|PATCH|DELETE)/i, label: 'gh api (mutating)' },
  { regex: /gh\.exe"\s+api\b.*--method\s+(POST|PUT|PATCH|DELETE)/i, label: 'gh api (mutating)' },
];

/**
 * Strip quoted strings and heredoc bodies so commit messages,
 * PR descriptions, and echo'd text don't trigger false positives.
 *
 * Security note: stripping is done defensively in multiple passes so that
 * subshell expressions ($(...) and backticks) inside any quoting style are
 * neutralised before the blocked-pattern regexes run.
 */
function stripQuotedContent(cmd) {
  let stripped = cmd;
  // 1. Strip heredoc bodies: <<'DELIM' ... DELIM  and  << DELIM ... DELIM
  stripped = stripped.replace(/<<-?\s*'?(\w+)'?[^\n]*\n[\s\S]*?\n\s*\1\b/g, '');
  // 2. Strip double-quoted subshells "$(...)" — most common false-positive source
  stripped = stripped.replace(/"\$\([\s\S]*?\)"/g, '""');
  // 3. Strip single-quoted subshells '$(...)' — must precede generic single-quote strip
  stripped = stripped.replace(/'\$\([\s\S]*?\)'/g, "''");
  // 4. Strip backtick subshells `...` (both quoted and unquoted)
  stripped = stripped.replace(/`[^`]*`/g, '``');
  // 5. Strip remaining double-quoted strings
  stripped = stripped.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  // 6. Strip single-quoted strings
  stripped = stripped.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return stripped;
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      run(input);
    } catch {
      process.exit(0); // Fail open
    }
  });
}

function run(input) {
  let event;
  try { event = JSON.parse(input); } catch { process.exit(0); }

  if ((event.tool_name || '') !== 'Bash') process.exit(0);

  const command = event.tool_input?.command || '';
  if (!command) process.exit(0);

  const stripped = stripQuotedContent(command);

  for (const { regex, label } of BLOCKED_PATTERNS) {
    if (regex.test(stripped)) {
      health.logBlock('external-action-gate', 'blocked', `${label}: ${command.slice(0, 200)}`);
      hookOutput('external-action-gate', 'blocked',
        `[external-action-gate] Blocked: "${label}" is an external action. ` +
        `Show the user the exact content and get approval before executing. ` +
        `Do NOT retry — ask the user first.`,
        { label, command: command.slice(0, 200) }
      );
      process.exit(2);
    }
  }

  process.exit(0);
}

main();

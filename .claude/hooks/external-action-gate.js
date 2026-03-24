#!/usr/bin/env node

/**
 * external-action-gate.js — PreToolUse hook (Bash)
 *
 * Blocks external-facing actions that publish content under the user's name:
 *   - git push (any variant)
 *   - gh pr/issue create/comment/close/edit/merge/delete
 *   - gh release create, gh repo fork
 *   - gh api with mutating methods
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

const BLOCKED_PATTERNS = [
  { regex: /\bgit\s+push\b/, label: 'git push' },
  { regex: /\bgh\s+pr\s+create\b/, label: 'gh pr create' },
  { regex: /\bgh\s+pr\s+merge\b/, label: 'gh pr merge' },
  { regex: /\bgh\s+pr\s+close\b/, label: 'gh pr close' },
  { regex: /\bgh\s+pr\s+comment\b/, label: 'gh pr comment' },
  { regex: /\bgh\s+pr\s+edit\b/, label: 'gh pr edit' },
  { regex: /\bgh\s+pr\s+review\b/, label: 'gh pr review' },
  { regex: /\bgh\s+issue\s+create\b/, label: 'gh issue create' },
  { regex: /\bgh\s+issue\s+comment\b/, label: 'gh issue comment' },
  { regex: /\bgh\s+issue\s+close\b/, label: 'gh issue close' },
  { regex: /\bgh\s+issue\s+edit\b/, label: 'gh issue edit' },
  { regex: /\bgh\s+issue\s+delete\b/, label: 'gh issue delete' },
  { regex: /\bgh\s+release\s+create\b/, label: 'gh release create' },
  { regex: /\bgh\s+repo\s+fork\b/, label: 'gh repo fork' },
  { regex: /gh\.exe"\s+pr\s+create\b/, label: 'gh pr create' },
  { regex: /gh\.exe"\s+pr\s+merge\b/, label: 'gh pr merge' },
  { regex: /gh\.exe"\s+pr\s+close\b/, label: 'gh pr close' },
  { regex: /gh\.exe"\s+pr\s+comment\b/, label: 'gh pr comment' },
  { regex: /gh\.exe"\s+pr\s+edit\b/, label: 'gh pr edit' },
  { regex: /gh\.exe"\s+pr\s+review\b/, label: 'gh pr review' },
  { regex: /gh\.exe"\s+issue\s+create\b/, label: 'gh issue create' },
  { regex: /gh\.exe"\s+issue\s+comment\b/, label: 'gh issue comment' },
  { regex: /gh\.exe"\s+issue\s+close\b/, label: 'gh issue close' },
  { regex: /gh\.exe"\s+issue\s+edit\b/, label: 'gh issue edit' },
  { regex: /gh\.exe"\s+issue\s+delete\b/, label: 'gh issue delete' },
  { regex: /gh\.exe"\s+release\s+create\b/, label: 'gh release create' },
  { regex: /gh\.exe"\s+repo\s+fork\b/, label: 'gh repo fork' },
  { regex: /\bgh\s+api\b.*--method\s+(POST|PUT|PATCH|DELETE)/i, label: 'gh api (mutating)' },
  { regex: /gh\.exe"\s+api\b.*--method\s+(POST|PUT|PATCH|DELETE)/i, label: 'gh api (mutating)' },
];

/**
 * Strip quoted strings and heredoc bodies so commit messages,
 * PR descriptions, and echo'd text don't trigger false positives.
 */
function stripQuotedContent(cmd) {
  let stripped = cmd;
  // Strip heredoc bodies: <<'DELIM' ... DELIM  and  << DELIM ... DELIM
  stripped = stripped.replace(/<<-?\s*'?(\w+)'?[^\n]*\n[\s\S]*?\n\s*\1\b/g, '');
  // Strip $(...) subshells (often contain heredocs for commit messages)
  stripped = stripped.replace(/"\$\([\s\S]*?\)"/g, '""');
  // Strip remaining double-quoted strings
  stripped = stripped.replace(/"(?:[^"\]|\.)*"/g, '""');
  // Strip single-quoted strings
  stripped = stripped.replace(/'(?:[^'\]|\.)*'/g, "''");
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
      process.stdout.write(
        `[external-action-gate] Blocked: "${label}" is an external action. ` +
        `Show the user the exact content and get approval before executing. ` +
        `Do NOT retry — ask the user first.`
      );
      process.exit(2);
    }
  }

  process.exit(0);
}

main();

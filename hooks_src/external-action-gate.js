#!/usr/bin/env node

/**
 * external-action-gate.js — PreToolUse hook (Bash)
 *
 * Uses the First-Encounter Consent pattern to handle external actions.
 *
 * Three tiers:
 *   SECRETS — Always blocked. Reading .env files via Bash.
 *   HARD    — Always blocked per-action. Irreversible by default (merge, close,
 *             delete, release, fork). Configurable via policy.externalActions.hard.
 *   SOFT    — Governed by consent preference. Reversible by default (push, PR
 *             create, comment). Configurable via policy.externalActions.soft.
 *
 * Policy overrides (harness.json):
 *   policy.externalActions.protectedBranches — branches that can never be deleted
 *   policy.externalActions.hard  — labels that are always per-action confirmed
 *   policy.externalActions.soft  — labels governed by consent preference
 *
 * When a label appears in both hard[] and soft[], hard wins.
 * When a label is in soft[] but was in default HARD, it moves to consent-gated.
 * This lets users unlock merge/close for autonomous workflows.
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

// ── Always blocked: secrets exfiltration ────────────────────────────────────

const SECRETS_PATTERNS = [
  { regex: /\bcat\s+.*\.env(\b|\.)/, label: 'cat .env (secrets)' },
  { regex: /\bsource\s+.*\.env(\b|\.)/, label: 'source .env (secrets)' },
  { regex: /\bhead\s+.*\.env(\b|\.)/, label: 'head .env (secrets)' },
  { regex: /\btail\s+.*\.env(\b|\.)/, label: 'tail .env (secrets)' },
  { regex: /\bgrep\b.*\.env(\b|\.)/, label: 'grep .env (secrets)' },
  { regex: /\bless\s+.*\.env(\b|\.)/, label: 'less .env (secrets)' },
  { regex: /\bmore\s+.*\.env(\b|\.)/, label: 'more .env (secrets)' },
];

// ── All detectable external action patterns ─────────────────────────────────
// Each has a label used by the policy system to assign tiers.

const ALL_PATTERNS = [
  // Git operations — specific patterns before general ones
  { regex: /\bgit\s+push\s+.*--delete\b/, label: 'git push --delete' },
  { regex: /\bgit\s+push\s+\S+\s+:/, label: 'git push --delete' },
  { regex: /\bgit\s+push\b/, label: 'git push' },

  // PR operations
  { regex: /\bgh\s+pr\s+create\b/, label: 'gh pr create' },
  { regex: /gh\.exe"\s+pr\s+create\b/, label: 'gh pr create' },
  { regex: /\bgh\s+pr\s+merge\b/, label: 'gh pr merge' },
  { regex: /gh\.exe"\s+pr\s+merge\b/, label: 'gh pr merge' },
  { regex: /\bgh\s+pr\s+close\b/, label: 'gh pr close' },
  { regex: /gh\.exe"\s+pr\s+close\b/, label: 'gh pr close' },
  { regex: /\bgh\s+pr\s+(comment|edit)\b/, label: 'gh pr comment/edit' },
  { regex: /gh\.exe"\s+pr\s+(comment|edit)\b/, label: 'gh pr comment/edit' },

  // Issue operations
  { regex: /\bgh\s+issue\s+(create|comment|edit)\b/, label: 'gh issue create/comment/edit' },
  { regex: /gh\.exe"\s+issue\s+(create|comment|edit)\b/, label: 'gh issue create/comment/edit' },
  { regex: /\bgh\s+issue\s+close\b/, label: 'gh issue close' },
  { regex: /gh\.exe"\s+issue\s+close\b/, label: 'gh issue close' },
  { regex: /\bgh\s+issue\s+delete\b/, label: 'gh issue delete' },
  { regex: /gh\.exe"\s+issue\s+delete\b/, label: 'gh issue delete' },

  // High-impact operations
  { regex: /\bgh\s+release\s+create\b/, label: 'gh release create' },
  { regex: /gh\.exe"\s+release\s+create\b/, label: 'gh release create' },
  { regex: /\bgh\s+repo\s+fork\b/, label: 'gh repo fork' },
  { regex: /gh\.exe"\s+repo\s+fork\b/, label: 'gh repo fork' },
  { regex: /\bgh\s+api\b.*--method\s+(POST|PUT|PATCH|DELETE)/i, label: 'gh api (mutating)' },
  { regex: /gh\.exe"\s+api\b.*--method\s+(POST|PUT|PATCH|DELETE)/i, label: 'gh api (mutating)' },
];

// ── Default tier assignments ────────────────────────────────────────────────
// Used when policy.externalActions is not configured in harness.json.

const DEFAULT_HARD = [
  'gh pr merge', 'gh pr close',
  'gh issue close', 'gh issue delete',
  'gh release create', 'gh repo fork',
  'gh api (mutating)', 'git push --delete',
];

const DEFAULT_SOFT = [
  'git push',
  'gh pr create', 'gh pr comment/edit',
  'gh issue create/comment/edit',
];

/**
 * Read policy from harness.json or return defaults.
 * Policy shape:
 *   policy.externalActions.protectedBranches: string[]  — never delete these
 *   policy.externalActions.hard: string[]               — always per-action confirm
 *   policy.externalActions.soft: string[]               — consent-gated
 */
function readPolicy() {
  const config = health.readConfig();
  const ea = config?.policy?.externalActions || {};
  return {
    protectedBranches: ea.protectedBranches || [],
    hard: ea.hard || DEFAULT_HARD,
    soft: ea.soft || DEFAULT_SOFT,
  };
}

/**
 * Determine the tier for a given action label.
 * Priority: hard > soft > unmanaged (allow).
 */
function getTier(label, policy) {
  if (policy.hard.includes(label)) return 'hard';
  if (policy.soft.includes(label)) return 'soft';
  return 'allow';
}

/**
 * Check if a command deletes a protected branch.
 * Matches: git push --delete origin main, git push origin :main, git branch -D main
 */
function checkProtectedBranchDeletion(command, protectedBranches) {
  if (protectedBranches.length === 0) return null;

  for (const branch of protectedBranches) {
    // git push --delete origin <branch>  OR  git push origin --delete <branch>
    const pushDeleteRe = new RegExp(`\\bgit\\s+push\\s+.*--delete\\s+${branch}\\b`);
    // git push origin :<branch>
    const pushColonRe = new RegExp(`\\bgit\\s+push\\s+\\S+\\s+:${branch}\\b`);
    // git branch -d/-D <branch>
    const branchDeleteRe = new RegExp(`\\bgit\\s+branch\\s+-[dD]\\s+${branch}\\b`);

    if (pushDeleteRe.test(command) || pushColonRe.test(command) || branchDeleteRe.test(command)) {
      return branch;
    }
  }
  return null;
}

/**
 * Strip quoted strings and heredoc bodies so commit messages,
 * PR descriptions, and echo'd text don't trigger false positives.
 */
function stripQuotedContent(cmd) {
  let stripped = cmd;
  stripped = stripped.replace(/<<-?\s*'?(\w+)'?[^\n]*\n[\s\S]*?\n\s*\1\b/g, '');
  stripped = stripped.replace(/"\$\([\s\S]*?\)"/g, '""');
  stripped = stripped.replace(/'\$\([\s\S]*?\)'/g, "''");
  stripped = stripped.replace(/`[^`]*`/g, '``');
  stripped = stripped.replace(/"(?:[^"\\]|\\.)*"/g, '""');
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
  const policy = readPolicy();

  // Tier 0: Secrets — always blocked, no policy override
  for (const { regex, label } of SECRETS_PATTERNS) {
    if (regex.test(stripped)) {
      health.logBlock('external-action-gate', 'blocked', `${label}: ${command.slice(0, 200)}`);
      hookOutput('external-action-gate', 'blocked',
        `[external-action-gate] Blocked: "${label}" reads secrets. This is always blocked.`,
        { label, tier: 'secrets' }
      );
      process.exit(2);
    }
  }

  // Protected branch deletion — always blocked, no policy override
  const deletedBranch = checkProtectedBranchDeletion(stripped, policy.protectedBranches);
  if (deletedBranch) {
    health.logBlock('external-action-gate', 'blocked', `delete protected branch ${deletedBranch}: ${command.slice(0, 200)}`);
    hookOutput('external-action-gate', 'blocked',
      `[external-action-gate] Blocked: "${deletedBranch}" is a protected branch and cannot be deleted. ` +
      `This is configured in harness.json under policy.externalActions.protectedBranches.`,
      { label: `delete ${deletedBranch}`, tier: 'protected-branch' }
    );
    process.exit(2);
  }

  // Check all patterns against policy tiers
  for (const { regex, label } of ALL_PATTERNS) {
    if (!regex.test(stripped)) continue;

    const tier = getTier(label, policy);

    if (tier === 'allow') {
      process.exit(0);
    }

    if (tier === 'hard') {
      health.logBlock('external-action-gate', 'blocked', `${label}: ${command.slice(0, 200)}`);
      hookOutput('external-action-gate', 'blocked',
        `[external-action-gate] "${label}" requires approval. ` +
        `Show the user the exact content and get confirmation before executing.`,
        { label, tier: 'hard' }
      );
      process.exit(2);
    }

    // tier === 'soft' — consent-gated
    const consent = health.checkConsent('externalActions');

    if (consent.action === 'allow') {
      process.exit(0);
    }

    if (consent.action === 'first-encounter') {
      health.logBlock('external-action-gate', 'first-encounter', `${label}: ${command.slice(0, 200)}`);
      hookOutput('external-action-gate', 'first-encounter',
        `[external-action-gate] This is your first external action ("${label}").\n` +
        `Citadel can push branches, create PRs, and post comments on your behalf.\n\n` +
        `How would you like to handle this going forward?\n` +
        `  1. "always-ask"    — Ask me every time before any external action\n` +
        `  2. "session-allow" — Allow for this session, ask again next session\n` +
        `  3. "auto-allow"    — I trust the agent, don't ask again\n\n` +
        `Tell the user these three options and ask which they prefer.\n` +
        `Then write their choice to harness.json:\n` +
        `  node -e "require('./hooks_src/harness-health-util').writeConsent('externalActions', '<choice>')"` +
        `\nFor "session-allow", also run:\n` +
        `  node -e "require('./hooks_src/harness-health-util').grantSessionAllow('externalActions')"` +
        `\nThen retry the command.`,
        { label, tier: 'soft', consent: 'first-encounter' }
      );
      process.exit(2);
    }

    // consent.action === 'block'
    health.logBlock('external-action-gate', 'consent-block', `${label}: ${command.slice(0, 200)}`);

    const pref = health.readConsent('externalActions');
    if (pref === 'session-allow') {
      hookOutput('external-action-gate', 'consent-block',
        `[external-action-gate] New session: "${label}" needs approval.\n` +
        `Your preference is "session-allow" -- approve this to allow external actions for this session.\n` +
        `Ask the user for approval. If approved, run:\n` +
        `  node -e "require('./hooks_src/harness-health-util').grantSessionAllow('externalActions')"` +
        `\nThen retry.`,
        { label, tier: 'soft', consent: 'session-renew' }
      );
    } else {
      hookOutput('external-action-gate', 'consent-block',
        `[external-action-gate] "${label}" is an external action.\n` +
        `Show the user the exact content and get approval before executing.\n` +
        `After approval, run:\n` +
        `  node -e "require('./hooks_src/harness-health-util').grantOneTimeAllow('externalActions')"` +
        `\nThen retry the command.`,
        { label, tier: 'soft', consent: 'always-ask' }
      );
    }
    process.exit(2);
  }

  // Not an external action — allow
  process.exit(0);
}

main();

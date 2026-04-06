'use strict';

const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

const SECRETS_PATTERNS = [
  { regex: /\bcat\s+.*\.env(\b|\.)/, label: 'cat .env (secrets)' },
  { regex: /\bsource\s+.*\.env(\b|\.)/, label: 'source .env (secrets)' },
  { regex: /\bhead\s+.*\.env(\b|\.)/, label: 'head .env (secrets)' },
  { regex: /\btail\s+.*\.env(\b|\.)/, label: 'tail .env (secrets)' },
  { regex: /\bgrep\b.*\.env(\b|\.)/, label: 'grep .env (secrets)' },
  { regex: /\bless\s+.*\.env(\b|\.)/, label: 'less .env (secrets)' },
  { regex: /\bmore\s+.*\.env(\b|\.)/, label: 'more .env (secrets)' },
];

const ALL_PATTERNS = [
  { regex: /\bgit\s+push\s+.*--delete\b/, label: 'git push --delete' },
  { regex: /\bgit\s+push\s+\S+\s+:/, label: 'git push --delete' },
  { regex: /\bgit\s+push\b/, label: 'git push' },
  { regex: /\bgh\s+pr\s+create\b/, label: 'gh pr create' },
  { regex: /gh\.exe"\s+pr\s+create\b/, label: 'gh pr create' },
  { regex: /\bgh\s+pr\s+merge\b/, label: 'gh pr merge' },
  { regex: /gh\.exe"\s+pr\s+merge\b/, label: 'gh pr merge' },
  { regex: /\bgh\s+pr\s+close\b/, label: 'gh pr close' },
  { regex: /gh\.exe"\s+pr\s+close\b/, label: 'gh pr close' },
  { regex: /\bgh\s+pr\s+(comment|edit)\b/, label: 'gh pr comment/edit' },
  { regex: /gh\.exe"\s+pr\s+(comment|edit)\b/, label: 'gh pr comment/edit' },
  { regex: /\bgh\s+issue\s+(create|comment|edit)\b/, label: 'gh issue create/comment/edit' },
  { regex: /gh\.exe"\s+issue\s+(create|comment|edit)\b/, label: 'gh issue create/comment/edit' },
  { regex: /\bgh\s+issue\s+close\b/, label: 'gh issue close' },
  { regex: /gh\.exe"\s+issue\s+close\b/, label: 'gh issue close' },
  { regex: /\bgh\s+issue\s+delete\b/, label: 'gh issue delete' },
  { regex: /gh\.exe"\s+issue\s+delete\b/, label: 'gh issue delete' },
  { regex: /\bgh\s+release\s+create\b/, label: 'gh release create' },
  { regex: /gh\.exe"\s+release\s+create\b/, label: 'gh release create' },
  { regex: /\bgh\s+repo\s+fork\b/, label: 'gh repo fork' },
  { regex: /gh\.exe"\s+repo\s+fork\b/, label: 'gh repo fork' },
  { regex: /\bgh\s+api\b.*--method\s+(POST|PUT|PATCH|DELETE)/i, label: 'gh api (mutating)' },
  { regex: /gh\.exe"\s+api\b.*--method\s+(POST|PUT|PATCH|DELETE)/i, label: 'gh api (mutating)' },
];

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

function readExternalActionPolicy(config) {
  const externalActions = config?.policy?.externalActions || {};
  return {
    protectedBranches: Array.isArray(externalActions.protectedBranches) && externalActions.protectedBranches.length > 0
      ? externalActions.protectedBranches
      : DEFAULT_PROTECTED_BRANCHES,
    hard: externalActions.hard || DEFAULT_HARD,
    soft: externalActions.soft || DEFAULT_SOFT,
  };
}

function getTier(label, policy) {
  if (policy.hard.includes(label)) return 'hard';
  if (policy.soft.includes(label)) return 'soft';
  return 'allow';
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkProtectedBranchDeletion(command, protectedBranches) {
  if (protectedBranches.length === 0) return null;

  for (const branch of protectedBranches) {
    const escaped = escapeRegExp(branch);
    const pushDeleteRe = new RegExp(`\\bgit\\s+push\\s+.*--delete\\s+${escaped}\\b`);
    const pushColonRe = new RegExp(`\\bgit\\s+push\\s+\\S+\\s+:${escaped}\\b`);
    const branchDeleteRe = new RegExp(`\\bgit\\s+branch\\s+-[dD]\\s+${escaped}\\b`);

    if (pushDeleteRe.test(command) || pushColonRe.test(command) || branchDeleteRe.test(command)) {
      return branch;
    }
  }

  return null;
}

function stripQuotedContent(command) {
  let stripped = command;
  stripped = stripped.replace(/<<-?\s*'?(\w+)'?[^\n]*\n[\s\S]*?\n\s*\1\b/g, '');
  stripped = stripped.replace(/"\$\([\s\S]*?\)"/g, '""');
  stripped = stripped.replace(/'\$\([\s\S]*?\)'/g, "''");
  stripped = stripped.replace(/`[^`]*`/g, '``');
  stripped = stripped.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  stripped = stripped.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return stripped;
}

function detectExternalAction(command, policy) {
  const stripped = stripQuotedContent(command);

  for (const { regex, label } of SECRETS_PATTERNS) {
    if (regex.test(stripped)) {
      return { kind: 'secret', label, tier: 'secrets', stripped };
    }
  }

  const deletedBranch = checkProtectedBranchDeletion(stripped, policy.protectedBranches);
  if (deletedBranch) {
    return {
      kind: 'protected-branch',
      label: `delete ${deletedBranch}`,
      branch: deletedBranch,
      tier: 'protected-branch',
      stripped,
    };
  }

  for (const { regex, label } of ALL_PATTERNS) {
    if (!regex.test(stripped)) continue;
    return { kind: 'external-action', label, tier: getTier(label, policy), stripped };
  }

  return null;
}

module.exports = {
  ALL_PATTERNS,
  DEFAULT_HARD,
  DEFAULT_PROTECTED_BRANCHES,
  DEFAULT_SOFT,
  SECRETS_PATTERNS,
  checkProtectedBranchDeletion,
  detectExternalAction,
  escapeRegExp,
  getTier,
  readExternalActionPolicy,
  stripQuotedContent,
};

#!/usr/bin/env node

/**
 * test-backward-compat.js - Backward compatibility tests
 *
 * Validates that existing data formats (campaigns, telemetry, harness.json,
 * project specs) continue to parse correctly through the new core modules.
 *
 * These tests use synthetic data that mirrors real-world formats to catch
 * regressions when core modules are refactored.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { parseCampaignContent, parseFrontmatter } = require('../core/campaigns/parse-campaign');
const { validateAgentRunEvent, validateSessionCostEvent, validateHookTimingEvent } = require('../core/telemetry/schema');
const { readExternalActionPolicy, detectExternalAction } = require('../core/policy/external-actions');
const { parseProjectSpec, validateProjectSpec } = require('../core/project/load-project-spec');
const { createEnvelope, normalizeToolName, normalizePathFields } = require('../core/hooks/normalize-event');
const { escapeRegExp } = require('../core/policy/external-actions');
const {
  dispatchHook,
  extractApplyPatchTargets,
  parseApplyPatchOperations,
  projectCodexOutput,
} = require('../hooks_src/codex-adapter');

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${label}`);
    console.error(`    ${err.message}`);
  }
}

// ============================================================
// Legacy campaign format (pre-core extraction)
// ============================================================

const LEGACY_CAMPAIGN = `---
Status: ACTIVE
Phase: 3
Priority: high
---

# Campaign: Platform Performance Overhaul

Status: ACTIVE

## Claimed Scope
- src/os/tools/PerformancePanel.tsx
- src/os/desktop/Desktop.tsx

## Restricted Files
- src/kernel/
- src/auth/

## Phase 3: Animation Optimization
- Replace repeat: Infinity with CSS keyframes
- Throttle decorative RAF loops to 30fps
`;

check('Legacy campaign parses with frontmatter', () => {
  const campaign = parseCampaignContent(LEGACY_CAMPAIGN, { slug: 'perf-overhaul' });
  assert.equal(campaign.slug, 'perf-overhaul');
  assert.equal(campaign.frontmatter.Status, 'ACTIVE');
  assert.equal(campaign.frontmatter.Phase, 3);
  assert.equal(campaign.frontmatter.Priority, 'high');
});

check('Legacy campaign parses body status', () => {
  const campaign = parseCampaignContent(LEGACY_CAMPAIGN);
  assert.equal(campaign.bodyStatus, 'ACTIVE');
});

check('Legacy campaign parses claimed scope', () => {
  const campaign = parseCampaignContent(LEGACY_CAMPAIGN);
  assert.equal(campaign.claimedScope.length, 2);
  assert(campaign.claimedScope[0].includes('PerformancePanel'));
});

check('Legacy campaign parses restricted files', () => {
  const campaign = parseCampaignContent(LEGACY_CAMPAIGN);
  assert.equal(campaign.restrictedFiles.length, 2);
  assert(campaign.restrictedFiles[0].includes('kernel'));
});

check('Legacy campaign parses title', () => {
  const campaign = parseCampaignContent(LEGACY_CAMPAIGN);
  assert.equal(campaign.title, 'Platform Performance Overhaul');
});

// Minimal campaign (no frontmatter, no scope)
const MINIMAL_CAMPAIGN = `# Campaign: Quick Fix

Status: COMPLETE

## Phase 1: Fix the bug
- Fixed it
`;

check('Minimal campaign without frontmatter parses', () => {
  const campaign = parseCampaignContent(MINIMAL_CAMPAIGN, { slug: 'quick-fix' });
  assert.equal(campaign.slug, 'quick-fix');
  assert.deepStrictEqual(campaign.frontmatter, {});
  assert.equal(campaign.bodyStatus, 'COMPLETE');
  assert.equal(campaign.title, 'Quick Fix');
  assert.deepStrictEqual(campaign.claimedScope, []);
  assert.deepStrictEqual(campaign.restrictedFiles, []);
});

// ============================================================
// Legacy telemetry JSONL (schema v1)
// ============================================================

check('Agent run event validates correctly', () => {
  const event = {
    timestamp: '2026-03-15T10:30:00Z',
    event: 'agent-start',
    agent: 'arch-reviewer',
    session: 'sess-123',
    campaign_slug: 'perf-overhaul',
  };
  const result = validateAgentRunEvent(event);
  assert(result.valid, `agent run event should be valid: ${result.errors.join(', ')}`);
});

check('Agent run event with duration and status validates', () => {
  const event = {
    timestamp: '2026-03-15T10:35:00Z',
    event: 'agent-complete',
    agent: 'arch-reviewer',
    session: 'sess-123',
    duration_ms: 300000,
    status: 'success',
    meta: { files_reviewed: 12 },
  };
  const result = validateAgentRunEvent(event);
  assert(result.valid, `completed event should be valid: ${result.errors.join(', ')}`);
});

check('Session cost event validates correctly', () => {
  const event = {
    timestamp: '2026-03-15T11:00:00Z',
    agent_count: 3,
    duration_minutes: 45,
    estimated_cost: 2.50,
    campaign_slug: 'perf-overhaul',
    session_id: 'sess-123',
  };
  const result = validateSessionCostEvent(event);
  assert(result.valid, `cost event should be valid: ${result.errors.join(', ')}`);
});

check('Session cost event with real token fields validates', () => {
  const event = {
    timestamp: '2026-03-15T11:00:00Z',
    agent_count: 1,
    duration_minutes: 30,
    estimated_cost: 1.20,
    real_cost: 1.15,
    input_tokens: 50000,
    output_tokens: 12000,
    cache_creation_input_tokens: 5000,
    cache_read_input_tokens: 20000,
    messages: 45,
    subagent_count: 2,
    models: { 'claude-sonnet-4-20250514': { input: 30000, output: 8000 } },
  };
  const result = validateSessionCostEvent(event);
  assert(result.valid, `token cost event should be valid: ${result.errors.join(', ')}`);
});

check('Hook timing event validates correctly', () => {
  const event = {
    timestamp: '2026-03-15T10:30:05Z',
    hook: 'protect-files',
    event: 'timing',
    duration_ms: 12,
  };
  const result = validateHookTimingEvent(event);
  assert(result.valid, `timing event should be valid: ${result.errors.join(', ')}`);
});

// ============================================================
// Existing harness.json format
// ============================================================

check('Custom harness.json policy is respected', () => {
  const config = {
    consent: { externalActions: 'always-ask' },
    policy: {
      externalActions: {
        protectedBranches: ['main', 'dev'],
        hard: ['gh release create', 'gh repo fork'],
        soft: ['git push', 'gh pr create', 'gh pr merge'],
      },
    },
  };
  const policy = readExternalActionPolicy(config);
  assert.deepStrictEqual(policy.protectedBranches, ['main', 'dev']);
  assert.deepStrictEqual(policy.hard, ['gh release create', 'gh repo fork']);
  assert(policy.soft.includes('gh pr merge'), 'custom soft should include gh pr merge');
});

check('Default policy fills missing config', () => {
  const policy = readExternalActionPolicy({});
  assert(policy.protectedBranches.includes('main'));
  assert(policy.hard.includes('gh pr merge'));
  assert(policy.allow.includes('git push'));
});

check('Policy with merge moved to soft tier works', () => {
  const config = {
    policy: {
      externalActions: {
        hard: ['gh release create'],
        soft: ['git push', 'gh pr merge', 'gh pr close'],
      },
    },
  };
  const policy = readExternalActionPolicy(config);
  const action = detectExternalAction('gh pr merge --auto', policy);
  assert.equal(action.tier, 'soft', 'gh pr merge should be soft when moved to soft list');
});

check('Protected branch deletion detection works with custom branches', () => {
  const config = {
    policy: {
      externalActions: {
        protectedBranches: ['main', 'dev', 'release/v1'],
      },
    },
  };
  const policy = readExternalActionPolicy(config);
  const action = detectExternalAction('git push origin --delete dev', policy);
  assert.equal(action.kind, 'protected-branch');
  assert.equal(action.branch, 'dev');
});

// ============================================================
// Regex injection protection (quality fix)
// ============================================================

check('escapeRegExp handles special characters', () => {
  const escaped = escapeRegExp('release/v1.0');
  // Forward slash is not a regex special char, only the dot is escaped
  assert.equal(escaped, 'release/v1\\.0');
});

check('Protected branch with regex-special chars does not inject', () => {
  const config = {
    policy: {
      externalActions: {
        protectedBranches: ['main', 'release/v1.0'],
      },
    },
  };
  const policy = readExternalActionPolicy(config);
  // This should detect the deletion correctly
  const action = detectExternalAction('git branch -D release/v1.0', policy);
  assert.equal(action.kind, 'protected-branch');
  assert.equal(action.branch, 'release/v1.0');
});

// ============================================================
// Event normalization backward compat
// ============================================================

check('normalizeToolName handles legacy lowercase tool names', () => {
  assert.equal(normalizeToolName('bash'), 'Bash');
  assert.equal(normalizeToolName('shell'), 'Bash');
  assert.equal(normalizeToolName('edit'), 'Edit');
  assert.equal(normalizeToolName('read'), 'Read');
});

check('normalizeToolName passes through unknown tools', () => {
  assert.equal(normalizeToolName('CustomTool'), 'CustomTool');
  assert.equal(normalizeToolName('WebSearch'), 'WebSearch');
});

check('normalizeToolName handles null/undefined', () => {
  assert.equal(normalizeToolName(null), 'Unknown');
  assert.equal(normalizeToolName(undefined), 'Unknown');
  assert.equal(normalizeToolName(''), 'Unknown');
});

check('normalizePathFields handles non-string path fields', () => {
  const result = normalizePathFields({ file_path: 123, path: null, other: 'value' });
  assert.equal(result.file_path, 123, 'non-string file_path should pass through');
  assert.equal(result.path, null, 'null path should pass through');
  assert.equal(result.other, 'value');
});

check('normalizePathFields normalizes Windows paths', () => {
  const result = normalizePathFields({ file_path: 'C:\\Users\\test\\file.js', path: 'src\\hooks\\test.js' });
  assert.equal(result.file_path, 'C:/Users/test/file.js');
  assert.equal(result.path, 'src/hooks/test.js');
});

check('createEnvelope produces correct structure for Claude events', () => {
  const envelope = createEnvelope('claude-code', 'PreToolUse', {
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    session_id: 'test-session',
  });
  assert.equal(envelope.event_id, 'pre_tool');
  assert.equal(envelope.runtime, 'claude-code');
  assert.equal(envelope.tool_name, 'Bash');
  assert.equal(envelope.session_id, 'test-session');
});

check('createEnvelope produces correct structure for Codex events', () => {
  const envelope = createEnvelope('codex', 'PreToolUse', {
    cwd: 'C:/repo',
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  });
  assert.equal(envelope.event_id, 'pre_tool');
  assert.equal(envelope.runtime, 'codex');
  assert.equal(envelope.tool_name, 'Bash');
  assert.equal(envelope.cwd, 'C:/repo');
  assert.equal(envelope.tool_input.command, 'git status');
});

check('Codex lifecycle events normalize to their exact shared event IDs', () => {
  assert.equal(createEnvelope('codex', 'UserPromptSubmit', {}).event_id, 'user_prompt_submit');
  assert.equal(createEnvelope('codex', 'SessionEnd', {}).event_id, 'session_end');
});

check('Codex shell_command remains a normalization-only compatibility alias for Bash', () => {
  assert.equal(normalizeToolName('shell_command'), 'Bash');
});

check('Codex Stop output translates Claude context without changing valid block decisions', () => {
  const context = projectCodexOutput({
    nativeEventName: 'Stop',
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: 'Fix the reported issue.',
      },
    }),
    stderr: '',
  });
  assert.deepStrictEqual(JSON.parse(context.stdout), {
    systemMessage: 'Fix the reported issue.',
  });
  assert.equal(context.stderr, '');

  const block = projectCodexOutput({
    nativeEventName: 'Stop',
    stdout: JSON.stringify({ decision: 'block', reason: 'Fix it.' }),
    stderr: '',
  });
  assert.deepStrictEqual(JSON.parse(block.stdout), { decision: 'block', reason: 'Fix it.' });
});

check('Codex Stop output routes non-JSON observer text away from stdout', () => {
  const projected = projectCodexOutput({
    nativeEventName: 'Stop',
    stdout: 'human-readable observer output\n',
    stderr: 'existing warning\n',
  });
  assert.equal(projected.stdout, '');
  assert.equal(projected.stderr, 'human-readable observer output\nexisting warning\n');
});

check('Codex Stop output rejects malformed block decisions but leaves other events untouched', () => {
  const malformedBlock = projectCodexOutput({
    nativeEventName: 'Stop',
    stdout: JSON.stringify({ decision: 'block' }),
    stderr: '',
  });
  assert.equal(malformedBlock.stdout, '');
  assert.match(malformedBlock.stderr, /"decision":"block"/);

  const nonStop = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: 'observer context',
    },
  });
  assert.equal(projectCodexOutput({
    nativeEventName: 'PostToolUse',
    stdout: nonStop,
    stderr: '',
  }).stdout, nonStop);
});

check('Codex SessionStart output wraps inner hook text in the native envelope', () => {
  const projected = projectCodexOutput({
    nativeEventName: 'SessionStart',
    stdout: '[citadel] restored durable memory\n',
    stderr: '',
  });
  assert.deepStrictEqual(JSON.parse(projected.stdout), {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: '[citadel] restored durable memory',
    },
  });
  assert.equal(projected.stderr, '');
});

check('Codex SessionStart output converts Citadel UI JSON to native context', () => {
  const projected = projectCodexOutput({
    nativeEventName: 'SessionStart',
    stdout: JSON.stringify({
      hook: 'intake-scanner',
      action: 'allowed',
      message: '[Intake] Work items detected',
      data: { pending: ['example'] },
    }),
    stderr: '',
  });
  assert.deepStrictEqual(JSON.parse(projected.stdout), {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: '[Intake] Work items detected',
    },
  });
});

check('Codex SessionStart output preserves an already native envelope', () => {
  const native = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'Load project memory.',
    },
  });
  assert.equal(projectCodexOutput({
    nativeEventName: 'SessionStart',
    stdout: native,
    stderr: '',
  }).stdout, native);
});

check('Codex PostToolUse output wraps Citadel UI JSON in the native envelope', () => {
  const projected = projectCodexOutput({
    nativeEventName: 'PostToolUse',
    stdout: JSON.stringify({
      hook: 'post-edit',
      action: 'allowed',
      message: '[citadel] post-edit checks passed',
    }),
    stderr: '',
  });
  assert.deepStrictEqual(JSON.parse(projected.stdout), {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: '[citadel] post-edit checks passed',
    },
  });
});

check('Codex apply_patch target extraction covers add, update, delete, and move paths', () => {
  const command = [
    '*** Begin Patch',
    '*** Add File: src/add.js',
    '+add',
    '*** Update File: src/old.js',
    '*** Move to: src/new.js',
    '@@',
    '-old',
    '+new',
    '*** Delete File: src/delete.js',
    '*** End Patch',
  ].join('\n');
  const targets = extractApplyPatchTargets(command);
  assert.deepStrictEqual(targets, [
    'src/add.js',
    'src/old.js',
    'src/new.js',
    'src/delete.js',
  ]);
  assert.deepStrictEqual(parseApplyPatchOperations(command), [
    { filePath: 'src/add.js', toolName: 'Write' },
    { filePath: 'src/old.js', toolName: 'Edit' },
    { filePath: 'src/new.js', toolName: 'Write' },
    { filePath: 'src/delete.js', toolName: 'Edit' },
  ]);
});

check('Codex adapter fails closed when a security hook is missing', () => {
  const result = dispatchHook('protect-files', '{}', {
    hooksDir: path.join(__dirname, 'fixtures', 'missing-hooks'),
  });
  assert.equal(result.status, 2);
});

check('Codex adapter leaves missing observer hooks fail-open', () => {
  const result = dispatchHook('governance', '{}', {
    hooksDir: path.join(__dirname, 'fixtures', 'missing-hooks'),
  });
  assert.equal(result.status, 0);
});

check('Codex adapter fails closed on malformed security-hook input', () => {
  const result = dispatchHook('external-action-gate', '{');
  assert.equal(result.status, 2);
});

check('Codex adapter fails closed on schema-invalid security-hook input', () => {
  const result = dispatchHook('protect-files', '{}');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /input projection failed/);
});

check('Codex adapter fails closed on targetless apply_patch input', () => {
  const result = dispatchHook('protect-files', JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: process.cwd(),
    tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** End Patch' },
  }));
  assert.equal(result.status, 2);
});

check('Codex adapter leaves malformed observer-hook input fail-open', () => {
  const result = dispatchHook('governance', '{');
  assert.equal(result.status, 0);
});

check('Codex adapter fails closed when a security-hook process cannot spawn', () => {
  const result = dispatchHook('protect-files', JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: process.cwd(),
    tool_name: 'Edit',
    tool_input: { file_path: 'src/app.js' },
  }), {
    spawnSync: () => ({ status: null, error: new Error('synthetic spawn failure') }),
  });
  assert.equal(result.status, 2);
});

check('Codex adapter maps abnormal security-hook child exit to block status 2', () => {
  const result = dispatchHook('protect-files', JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: process.cwd(),
    tool_name: 'Edit',
    tool_input: { file_path: 'src/app.js' },
  }), {
    spawnSync: () => ({ status: 1, stdout: '', stderr: 'synthetic child failure\n' }),
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exited abnormally/);
});

check('Codex adapter leaves observer-hook spawn failures fail-open', () => {
  const result = dispatchHook('governance', JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: process.cwd(),
    tool_name: 'Edit',
    tool_input: { file_path: 'src/app.js' },
  }), {
    spawnSync: () => ({ status: null, error: new Error('synthetic spawn failure') }),
  });
  assert.equal(result.status, 0);
});

// ============================================================
// Project spec backward compat
// ============================================================

const LEGACY_PROJECT_SPEC = `# Citadel Project Spec

Version: 1

## Project

Name: TestProject
Summary: A test project for compatibility testing.

## Conventions

- Use TypeScript strict mode
- Run tests before committing

## Workflows

- Run node scripts/test-all.js after changes

## Constraints

- Do not break backward compatibility
`;

check('Legacy project spec parses correctly', () => {
  const spec = parseProjectSpec(LEGACY_PROJECT_SPEC);
  assert.equal(spec.version, '1');
  assert.equal(spec.project.name, 'TestProject');
  assert.equal(spec.project.summary, 'A test project for compatibility testing.');
  assert.equal(spec.conventions.length, 2);
  assert.equal(spec.workflows.length, 1);
  assert.equal(spec.constraints.length, 1);
});

check('Legacy project spec validates without errors', () => {
  const spec = parseProjectSpec(LEGACY_PROJECT_SPEC);
  const errors = validateProjectSpec(spec);
  assert.deepStrictEqual(errors, [], `should have no errors: ${errors.join(', ')}`);
});

check('Empty project spec returns skeleton with errors', () => {
  const spec = parseProjectSpec('');
  assert.equal(spec.project.name, '');
  assert.equal(spec.project.summary, '');
  const errors = validateProjectSpec(spec);
  assert(errors.length > 0, 'empty spec should have validation errors');
});

// --- Summary ---

console.log(`backward compatibility tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

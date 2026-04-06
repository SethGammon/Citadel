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

const { parseCampaignContent, parseFrontmatter } = require('../core/campaigns/parse-campaign');
const { validateAgentRunEvent, validateSessionCostEvent, validateHookTimingEvent } = require('../core/telemetry/schema');
const { readExternalActionPolicy, detectExternalAction } = require('../core/policy/external-actions');
const { parseProjectSpec, validateProjectSpec } = require('../core/project/load-project-spec');
const { createEnvelope, normalizeToolName, normalizePathFields } = require('../core/hooks/normalize-event');
const { escapeRegExp } = require('../core/policy/external-actions');

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
  assert(policy.soft.includes('git push'));
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
    tool_type: 'shell',
    toolInput: { command: 'ls' },
  });
  assert.equal(envelope.event_id, 'pre_tool');
  assert.equal(envelope.runtime, 'codex');
  assert.equal(envelope.tool_name, 'Bash');
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

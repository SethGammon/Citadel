#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  bootstrapProjectGuidance,
  inspectClaudeGuidance,
} = require(path.join(__dirname, '..', 'core', 'project', 'bootstrap-project-guidance'));
const { selectClaudeGuidanceTarget } = require(path.join(__dirname, '..', 'runtimes', 'claude-code', 'guidance', 'select-target'));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-project-bootstrap-'));

try {
  const first = bootstrapProjectGuidance({
    citadelRoot: path.join(__dirname, '..'),
    projectRoot: tmpRoot,
    projectName: 'Bootstrap Test',
    projectSummary: 'Bootstrap test summary.',
  });

  assert(first.specCreated, 'bootstrap should create a missing canonical spec');
  assert(fs.existsSync(path.join(tmpRoot, '.citadel', 'project.md')), 'bootstrap should create .citadel/project.md');
  assert(fs.existsSync(path.join(tmpRoot, 'CLAUDE.md')), 'bootstrap should create CLAUDE.md');
  assert(fs.existsSync(path.join(tmpRoot, 'AGENTS.md')), 'bootstrap should create AGENTS.md');

  fs.writeFileSync(path.join(tmpRoot, 'CLAUDE.md'), 'custom claude guidance', 'utf8');
  const second = bootstrapProjectGuidance({
    citadelRoot: path.join(__dirname, '..'),
    projectRoot: tmpRoot,
  });

  assert(!second.specCreated, 'bootstrap should reuse existing canonical spec');
  assert(second.claude.skipped, 'bootstrap should not overwrite existing CLAUDE.md without flag');
  assert.equal(fs.readFileSync(path.join(tmpRoot, 'CLAUDE.md'), 'utf8'), 'custom claude guidance');

  const third = bootstrapProjectGuidance({
    citadelRoot: path.join(__dirname, '..'),
    projectRoot: tmpRoot,
    overwriteGuidance: true,
  });
  assert(third.claude.skipped, 'bootstrap should preserve customized guidance even with a refresh request');
  assert.equal(fs.readFileSync(path.join(tmpRoot, 'CLAUDE.md'), 'utf8'), 'custom claude guidance');

  for (const [claudeVersion, agentsMdCapability, expected] of [
    ['2.1.276', true, 'CLAUDE.md'],
    ['2.1.277', true, 'AGENTS.md'],
    ['2.1.278', true, 'AGENTS.md'],
    ['2.1.277', false, 'CLAUDE.md'],
    [null, true, 'CLAUDE.md'],
    ['not a version', true, 'CLAUDE.md'],
  ]) {
    assert.equal(selectClaudeGuidanceTarget({ claudeVersion, agentsMdCapability }).filePath, expected);
  }

  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-project-bootstrap-home-'));
  try {
    const nested = path.join(homeRoot, 'work', 'project');
    fs.mkdirSync(path.join(homeRoot, '.claude'), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(homeRoot, '.claude', 'CLAUDE.md'), 'user global guidance');
    assert.deepEqual(inspectClaudeGuidance(nested, null, { homeDir: homeRoot }).blockingPaths, []);
    fs.writeFileSync(path.join(homeRoot, 'CLAUDE.md'), 'ancestor project guidance');
    assert(inspectClaudeGuidance(nested, null, { homeDir: homeRoot }).blockingPaths.includes(path.join(homeRoot, 'CLAUDE.md')));
  } finally {
    fs.rmSync(homeRoot, { recursive: true, force: true });
  }

  const nativeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-project-bootstrap-native-'));
  try {
    const native = bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: nativeRoot,
      projectName: 'Shared Guidance',
      claudeVersion: '2.1.277 (Claude Code)',
      agentsMdCapability: true,
    });
    assert(native.claudeGuidanceSelection.nativeAgentsMd);
    assert.equal(native.claude.filePath, path.join(nativeRoot, 'AGENTS.md'));
    assert(native.codex.shared, 'confirmed native support should share AGENTS.md with Codex');
    assert(!fs.existsSync(path.join(nativeRoot, 'CLAUDE.md')), 'confirmed native support should not create CLAUDE.md');
    const shared = fs.readFileSync(path.join(nativeRoot, 'AGENTS.md'), 'utf8');
    assert(shared.includes('# Shared Guidance'));
    assert(shared.includes('## Verification'));
    assert(shared.includes('## Review Guidelines'));
    assert(shared.includes('## Codex Notes'));

    const idempotent = bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: nativeRoot,
      claudeVersion: '2.1.277',
    });
    assert(idempotent.claudeGuidanceSelection.nativeAgentsMd);
    assert(idempotent.claude.skipped);
    assert(!fs.existsSync(path.join(nativeRoot, 'CLAUDE.md')));

    fs.writeFileSync(path.join(nativeRoot, 'AGENTS.md'), 'user shared guidance', 'utf8');
    const repeated = bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: nativeRoot,
      claudeVersion: '2.1.300',
      agentsMdCapability: true,
    });
    assert(repeated.claude.skipped);
    assert(repeated.claudeGuidanceSelection.nativeAgentsMd);
    assert(!fs.existsSync(path.join(nativeRoot, 'CLAUDE.md')));
    assert.equal(fs.readFileSync(path.join(nativeRoot, 'AGENTS.md'), 'utf8'), 'user shared guidance');
    execFileSync(process.execPath, [
      path.join(__dirname, 'generate-project-guidance.js'),
      '--project-root', nativeRoot,
      '--target', 'claude',
      '--write',
      '--claude-version', '2.1.300',
    ], { encoding: 'utf8', stdio: 'pipe' });
    assert(!fs.existsSync(path.join(nativeRoot, 'CLAUDE.md')), 'ordinary refresh should preserve native AGENTS-only layout');
  } finally {
    fs.rmSync(nativeRoot, { recursive: true, force: true });
  }

  const blockedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-project-bootstrap-blocked-'));
  try {
    bootstrapProjectGuidance({ citadelRoot: path.join(__dirname, '..'), projectRoot: blockedRoot });
    fs.writeFileSync(path.join(blockedRoot, 'CLAUDE.md'), 'user project guidance');
    execFileSync(process.execPath, [
      path.join(__dirname, 'generate-project-guidance.js'),
      '--project-root', blockedRoot,
      '--target', 'claude',
      '--write',
      '--claude-agents-md-supported',
      '--claude-version', '2.1.300',
    ], { encoding: 'utf8', stdio: 'pipe' });
    assert.equal(fs.readFileSync(path.join(blockedRoot, 'CLAUDE.md'), 'utf8'), 'user project guidance');
  } finally {
    fs.rmSync(blockedRoot, { recursive: true, force: true });
  }

  const migrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-project-bootstrap-migration-'));
  try {
    bootstrapProjectGuidance({ citadelRoot: path.join(__dirname, '..'), projectRoot: migrationRoot });
    const migrated = bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: migrationRoot,
      claudeVersion: '2.1.277',
      agentsMdCapability: true,
    });
    assert(migrated.claude.removedOwnedClaudeGuidance);
    assert(!fs.existsSync(path.join(migrationRoot, 'CLAUDE.md')));

    const retained = bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: migrationRoot,
      claudeVersion: '2.1.300',
    });
    assert(retained.claudeGuidanceSelection.nativeAgentsMd, 'machine-local confirmation should survive refresh');
    assert(!fs.existsSync(path.join(migrationRoot, 'CLAUDE.md')));
    const downgraded = bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: migrationRoot,
      claudeVersion: '2.1.276',
    });
    assert(!downgraded.claudeGuidanceSelection.nativeAgentsMd);
    assert(fs.existsSync(path.join(migrationRoot, 'CLAUDE.md')));
    const upgraded = bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: migrationRoot,
      claudeVersion: '2.1.300',
    });
    assert(upgraded.claudeGuidanceSelection.nativeAgentsMd);
    assert(!fs.existsSync(path.join(migrationRoot, 'CLAUDE.md')),
      'upgrade should remove only the unchanged Citadel fallback when shared AGENTS already exists');
    bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: migrationRoot,
      claudeVersion: '2.1.276',
    });
    fs.writeFileSync(path.join(migrationRoot, 'CLAUDE.md'), '<!-- citadel:project-guidance -->\nuser edit\n');
    const preserved = bootstrapProjectGuidance({
      citadelRoot: path.join(__dirname, '..'),
      projectRoot: migrationRoot,
      claudeVersion: '2.1.300',
      agentsMdCapability: true,
      overwriteGuidance: true,
    });
    assert(!preserved.claudeGuidanceSelection.nativeAgentsMd);
    assert.equal(fs.readFileSync(path.join(migrationRoot, 'CLAUDE.md'), 'utf8'), '<!-- citadel:project-guidance -->\nuser edit\n');
  } finally {
    fs.rmSync(migrationRoot, { recursive: true, force: true });
  }

  console.log('project bootstrap tests passed');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

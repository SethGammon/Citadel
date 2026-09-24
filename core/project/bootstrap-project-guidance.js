#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CLAUDE_GUIDANCE_TARGET,
  selectClaudeGuidanceTarget,
} = require('../../runtimes/claude-code/guidance/render');
const { CODEX_GUIDANCE_TARGET } = require('../../runtimes/codex/guidance/render');
const { loadProjectSpec, resolveProjectSpecPath } = require('./load-project-spec');
const { renderSharedGuidance } = require('./render-shared-guidance');
const { withGuidanceOwner } = require('../runtime/install-contract');

const GUIDANCE_OWNER_MARKER = '<!-- citadel:project-guidance -->';

function inspectClaudeGuidance(projectRoot, expectedOwnedContent = null, options = {}) {
  const rootClaude = path.join(projectRoot, 'CLAUDE.md');
  const rootContent = fs.existsSync(rootClaude) ? fs.readFileSync(rootClaude, 'utf8') : null;
  const ownedRoot = rootContent !== null
    && rootContent.includes(GUIDANCE_OWNER_MARKER)
    && expectedOwnedContent !== null
    && rootContent === expectedOwnedContent;
  const candidates = [];
  const home = path.resolve(options.homeDir || os.homedir());
  const userClaude = path.join(home, '.claude', 'CLAUDE.md');
  let current = path.resolve(projectRoot);
  while (true) {
    for (const relative of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')]) {
      const candidate = path.join(current, relative);
      if (fs.existsSync(candidate)
        && candidate !== userClaude
        && !(candidate === rootClaude && ownedRoot)) candidates.push(candidate);
    }
    // The ancestor scan stops at the home directory: anything above it is not
    // project guidance (and on a real machine would surface unrelated files
    // like the user's own global CLAUDE.md as false blockers).
    if (current === home) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { rootClaude, ownedRoot, blockingPaths: candidates };
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function defaultProjectName(projectRoot) {
  return path.basename(projectRoot);
}

function defaultProjectSummary(projectName) {
  return `${projectName} codebase guidance for Citadel-powered agents.`;
}

function renderTemplate(template, projectName, projectSummary) {
  return template
    .replace('Name: Your Project', `Name: ${projectName}`)
    .replace(
      'Summary: One or two sentences describing the codebase, what it is for, and what matters operationally.',
      `Summary: ${projectSummary}`
    );
}

function ensureProjectSpec(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const specPath = resolveProjectSpecPath(projectRoot, options.specPath);
  const specDir = path.dirname(specPath);
  const created = !fs.existsSync(specPath);

  if (created) {
    ensureDirectory(specDir);
    const templatePath = options.templatePath || path.join(options.citadelRoot, '.citadel', 'project.template.md');
    const template = fs.readFileSync(templatePath, 'utf8');
    const projectName = options.projectName || defaultProjectName(projectRoot);
    const projectSummary = options.projectSummary || defaultProjectSummary(projectName);
    fs.writeFileSync(specPath, renderTemplate(template, projectName, projectSummary), 'utf8');
  }

  return {
    created,
    specPath,
    loaded: loadProjectSpec(projectRoot, specPath),
  };
}

function writeGuidanceFile(projectRoot, target, spec, overwrite) {
  const filePath = path.join(projectRoot, target.filePath);
  const existed = fs.existsSync(filePath);

  if (existed && !overwrite) {
    return { filePath, written: false, skipped: true };
  }

  fs.writeFileSync(filePath, withGuidanceOwner(target.render(spec)), 'utf8');
  return { filePath, written: true, skipped: false };
}

function bootstrapProjectGuidance(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const ensured = ensureProjectSpec(options);
  const spec = ensured.loaded.spec;
  const overwriteGuidance = options.overwriteGuidance === true;
  const statePath = path.join(projectRoot, '.citadel', 'claude-guidance.json');
  let persisted = null;
  try {
    persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    persisted = null;
  }
  const selectionOptions = options.agentsMdCapability === true
    ? options
    : persisted?.nativeAgentsMd === true
      ? { ...options, agentsMdCapability: true }
      : options;

  const expectedOwnedClaude = withGuidanceOwner(CLAUDE_GUIDANCE_TARGET.render(spec));
  const existingClaude = inspectClaudeGuidance(projectRoot, expectedOwnedClaude, options);
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  const expectedOwnedCodex = withGuidanceOwner(CODEX_GUIDANCE_TARGET.render(spec));
  const expectedOwnedShared = withGuidanceOwner(renderSharedGuidance(spec));
  const agentsContent = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : null;
  const migratableAgents = agentsContent === null
    || agentsContent === expectedOwnedCodex
    || agentsContent === expectedOwnedShared;
  const selection = selectClaudeGuidanceTarget({
    ...selectionOptions,
    claudeGuidancePresent: existingClaude.blockingPaths.length > 0
      || (selectionOptions.agentsMdCapability === true
        && existingClaude.ownedRoot
        && !migratableAgents),
  });
  const claudeTarget = selection.nativeAgentsMd
    ? { ...CLAUDE_GUIDANCE_TARGET, filePath: 'AGENTS.md', render: renderSharedGuidance }
    : CLAUDE_GUIDANCE_TARGET;
  const claude = writeGuidanceFile(
    projectRoot,
    claudeTarget,
    spec,
    (overwriteGuidance && !existingClaude.blockingPaths.includes(existingClaude.rootClaude))
      || (selection.nativeAgentsMd && agentsContent === expectedOwnedCodex)
  );
  if (selection.nativeAgentsMd
    && existingClaude.ownedRoot
    && (claude.written || agentsContent === expectedOwnedShared)) {
    fs.unlinkSync(existingClaude.rootClaude);
    claude.removedOwnedClaudeGuidance = true;
  }
  if (selection.nativeAgentsMd) {
    ensureDirectory(path.dirname(statePath));
    fs.writeFileSync(statePath, `${JSON.stringify({
      nativeAgentsMd: true,
    }, null, 2)}\n`, 'utf8');
  }
  const codex = selection.nativeAgentsMd
    ? { ...claude, shared: true }
    : writeGuidanceFile(projectRoot, CODEX_GUIDANCE_TARGET, spec, overwriteGuidance);

  return {
    specPath: ensured.specPath,
    specCreated: ensured.created,
    claude,
    codex,
    claudeGuidanceSelection: selection,
  };
}

module.exports = Object.freeze({
  bootstrapProjectGuidance,
  defaultProjectName,
  defaultProjectSummary,
  ensureProjectSpec,
  renderTemplate,
  inspectClaudeGuidance,
});

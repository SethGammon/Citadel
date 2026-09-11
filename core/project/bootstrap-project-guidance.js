#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { CLAUDE_GUIDANCE_TARGET } = require('../../runtimes/claude-code/guidance/render');
const { CODEX_GUIDANCE_TARGET } = require('../../runtimes/codex/guidance/render');
const { loadProjectSpec, resolveProjectSpecPath } = require('./load-project-spec');
const { withGuidanceOwner } = require('../runtime/install-contract');

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

  const claude = writeGuidanceFile(projectRoot, CLAUDE_GUIDANCE_TARGET, spec, overwriteGuidance);
  const codex = writeGuidanceFile(projectRoot, CODEX_GUIDANCE_TARGET, spec, overwriteGuidance);

  return {
    specPath: ensured.specPath,
    specCreated: ensured.created,
    claude,
    codex,
  };
}

module.exports = Object.freeze({
  bootstrapProjectGuidance,
  defaultProjectName,
  defaultProjectSummary,
  ensureProjectSpec,
  renderTemplate,
});

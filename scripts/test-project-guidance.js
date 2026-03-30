#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseProjectSpec, validateProjectSpec } = require(path.join(__dirname, '..', 'core', 'project', 'load-project-spec'));
const { renderCodexGuidance } = require(path.join(__dirname, '..', 'core', 'project', 'render-codex-guidance'));
const { CLAUDE_GUIDANCE_TARGET, renderClaudeGuidance } = require(path.join(__dirname, '..', 'runtimes', 'claude-code', 'guidance', 'render'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const templatePath = path.join(__dirname, '..', '.citadel', 'project.template.md');
  const template = fs.readFileSync(templatePath, 'utf8');
  const spec = parseProjectSpec(template);
  const errors = validateProjectSpec(spec);
  if (errors.length > 0) {
    fail(`Project template is invalid: ${errors.join('; ')}`);
  }

  const claude = renderClaudeGuidance(spec);
  const codex = renderCodexGuidance(spec);

  if (!claude.includes('# Claude Harness')) {
    fail('Claude guidance renderer must emit the Claude Harness heading');
  }
  if (CLAUDE_GUIDANCE_TARGET.filePath !== 'CLAUDE.md') {
    fail('Claude runtime guidance target must point to CLAUDE.md');
  }
  if (!codex.includes('## Citadel Project Guidance')) {
    fail('Codex guidance renderer must emit the Citadel Project Guidance section');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-project-guidance-'));
  const tempCitadel = path.join(tempRoot, '.citadel');
  fs.mkdirSync(tempCitadel, { recursive: true });
  fs.writeFileSync(path.join(tempCitadel, 'project.md'), template, 'utf8');
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log('Project guidance tests pass.');
}

main();

#!/usr/bin/env node

'use strict';

const { renderCodexGuidance } = require('./render-codex-guidance');

function renderSharedGuidance(spec) {
  return `<!-- citadel:shared-agents-guidance -->\n${renderCodexGuidance(spec).replace(
    'This file is the Codex-facing projection of the canonical Citadel project spec. Codex reads AGENTS.md files from the repository root down to the current working directory, so nested AGENTS.override.md files can add narrower rules when a package needs them.',
    'This file is the shared AGENTS.md projection of the canonical Citadel project spec. Claude Code v2.1.277 or later can read it when native AGENTS.md support is confirmed and no project CLAUDE.md takes precedence. Codex also reads it as repository guidance; nested Codex-only override files remain specific to Codex.'
  )}`;
}

module.exports = Object.freeze({ renderSharedGuidance });

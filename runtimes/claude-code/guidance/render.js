#!/usr/bin/env node

'use strict';

const { renderClaudeGuidance } = require('../../../core/project/render-claude-guidance');

const CLAUDE_GUIDANCE_TARGET = Object.freeze({
  runtime: 'claude-code',
  filePath: 'CLAUDE.md',
  render: renderClaudeGuidance,
});

module.exports = Object.freeze({
  CLAUDE_GUIDANCE_TARGET,
  renderClaudeGuidance,
});

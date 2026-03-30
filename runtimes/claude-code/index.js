#!/usr/bin/env node

'use strict';

const runtime = require('./runtime');
const hookInput = require('./adapters/hook-input');
const sessionTokens = require('./adapters/session-tokens');
const { installClaudeHooks } = require('./generators/install-hooks');
const { CLAUDE_GUIDANCE_TARGET, renderClaudeGuidance } = require('./guidance/render');

module.exports = Object.freeze({
  runtime,
  hookInput,
  sessionTokens,
  installClaudeHooks,
  guidance: Object.freeze({
    target: CLAUDE_GUIDANCE_TARGET,
    render: renderClaudeGuidance,
  }),
});

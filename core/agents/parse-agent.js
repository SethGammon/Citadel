#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const {
  AGENT_REQUIRED_FRONTMATTER,
} = require(path.join(__dirname, '..', 'contracts', 'agent-role'));

const { parseFrontmatter } = require('../utils/frontmatter');

function parseAgentFrontmatter(content) {
  return parseFrontmatter(content).frontmatter || {};
}

function extractAgentBody(content) {
  return parseFrontmatter(content).body.trim();
}

function validateParsedAgent(parsedAgent) {
  const errors = [];

  for (const field of AGENT_REQUIRED_FRONTMATTER) {
    if (!parsedAgent.frontmatter[field]) {
      errors.push(`missing frontmatter field: ${field}`);
    }
  }

  if (!parsedAgent.body) {
    errors.push('missing agent instructions body');
  }

  return errors;
}

function parseAgentContent(agentName, content, agentPath) {
  const frontmatter = parseAgentFrontmatter(content);
  const body = extractAgentBody(content);
  const parsedAgent = {
    name: agentName,
    path: agentPath || null,
    content,
    frontmatter,
    body,
  };

  return {
    ...parsedAgent,
    errors: validateParsedAgent(parsedAgent),
  };
}

function loadAgent(agentPath) {
  const resolvedPath = path.resolve(agentPath);
  const content = fs.readFileSync(resolvedPath, 'utf8');
  const agentName = path.basename(resolvedPath, path.extname(resolvedPath));
  return parseAgentContent(agentName, content, resolvedPath);
}

module.exports = Object.freeze({
  parseAgentFrontmatter,
  extractAgentBody,
  validateParsedAgent,
  parseAgentContent,
  loadAgent,
});

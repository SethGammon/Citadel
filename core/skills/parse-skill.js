#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { STRUCTURE_CHECKS, parseFrontmatter } = require('./structure');

function parseSkillFrontmatter(content) {
  return parseFrontmatter(content).frontmatter || {};
}

function extractSkillBody(content) {
  return parseFrontmatter(content).body.trim();
}

function validateParsedSkill(parsedSkill) {
  const { frontmatter, body } = typeof parsedSkill.content === 'string'
    ? parseFrontmatter(parsedSkill.content)
    : { frontmatter: parsedSkill.frontmatter, body: parsedSkill.body };
  return STRUCTURE_CHECKS.filter(check => check.check(frontmatter, body) !== true)
    .map(check => check.description);
}

function parseSkillContent(skillName, content, skillPath) {
  const frontmatter = parseSkillFrontmatter(content);
  const body = extractSkillBody(content);
  const parsedSkill = {
    name: skillName,
    path: skillPath || null,
    content,
    frontmatter,
    body,
  };

  return {
    ...parsedSkill,
    errors: validateParsedSkill(parsedSkill),
  };
}

function loadSkill(skillRoot, skillName) {
  const resolvedName = skillName || path.basename(skillRoot);
  const skillPath = path.join(skillRoot, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');
  return parseSkillContent(resolvedName, content, skillPath);
}

module.exports = Object.freeze({
  parseSkillFrontmatter,
  extractSkillBody,
  validateParsedSkill,
  parseSkillContent,
  loadSkill,
});

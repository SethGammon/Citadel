#!/usr/bin/env node

'use strict';

const SKILL_REQUIRED_FRONTMATTER = Object.freeze([
  'name',
  'description',
  'user-invocable',
]);

const SKILL_OPTIONAL_FRONTMATTER = Object.freeze([
  'auto-trigger',
  'last-updated',
  'dependencies',
]);

// Canonical authoring headings; execution aliases are defined by structure.js.
const SKILL_REQUIRED_SECTIONS = Object.freeze([
  'Protocol',
  'Quality Gates',
  'Exit Protocol',
]);

const SKILL_PROJECTIONS = Object.freeze([
  'skill_md',
  'openai_yaml',
]);

module.exports = Object.freeze({
  SKILL_REQUIRED_FRONTMATTER,
  SKILL_OPTIONAL_FRONTMATTER,
  SKILL_REQUIRED_SECTIONS,
  SKILL_PROJECTIONS,
});

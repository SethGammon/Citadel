'use strict';

const { parseFrontmatter: parseSharedFrontmatter } = require('../utils/frontmatter');
const parseFrontmatter = content => {
  const parsed = parseSharedFrontmatter(content);
  return { ...parsed, frontmatter: parsed.frontmatter || {} };
};
const fs = require('fs');
const path = require('path');
const { bundleForSkill } = require('../config');

const TASK_CLASSES = ['orchestration', 'quality', 'knowledge', 'research', 'creation', 'operations', 'integration', 'utility'];
const RISK_LEVELS = ['low', 'medium', 'high'];

function skillDirs(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir)
    .filter((name) => fs.existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .sort();
}

function inferTaskClass(name, fm, body) {
  if (fm['task-class']) return fm['task-class'];
  if (/archon|fleet|daemon|marshal|workspace|autopilot|do/.test(name)) return 'orchestration';
  if (/qa|review|verify|test|refactor|improve|organize/.test(name)) return 'quality';
  if (/learn|wiki|map|memory|doc|postmortem|session-handoff/.test(name)) return 'knowledge';
  if (/research|triage|prd|architect|design/.test(name)) return 'research';
  if (/create|scaffold/.test(name)) return 'creation';
  if (/setup|schedule|watch|telemetry|dashboard|cost|houseclean/.test(name)) return 'operations';
  if (/github|codex|runtime|infra|pr-watch/.test(`${name} ${body}`)) return 'integration';
  return 'utility';
}

function inferRiskLevel(fm, body) {
  if (fm['risk-level']) return fm['risk-level'];
  if (/Reversibility:\s*red|Red actions|force push|bulk delete|destructive/i.test(body)) return 'high';
  if (/Reversibility:\s*amber|writes|merge|daemon|budget/i.test(body)) return 'medium';
  return 'low';
}

function benchmarkStatus(benchDir) {
  if (!fs.existsSync(benchDir)) return { status: 'none', count: 0 };
  const count = fs.readdirSync(benchDir).filter((entry) => entry.endsWith('.md')).length;
  return { status: count > 0 ? 'present' : 'empty', count };
}

function readSkill(skillsDir, name) {
  const filePath = path.join(skillsDir, name, 'SKILL.md');
  const content = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(content);
  const bench = benchmarkStatus(path.join(skillsDir, name, '__benchmarks__'));
  return {
    name,
    description: frontmatter.description || '',
    triggerKeywords: Array.isArray(frontmatter.trigger_keywords) ? frontmatter.trigger_keywords : [],
    taskClass: inferTaskClass(name, frontmatter, body),
    riskLevel: inferRiskLevel(frontmatter, body),
    expectedArtifacts: frontmatter['expected-artifacts'] || [],
    verificationCommands: frontmatter['verification-commands'] || [],
    benchmarkStatus: frontmatter['benchmark-status'] || bench.status,
    benchmarkCount: bench.count,
    neighborSkills: frontmatter['neighbor-skills'] || [],
    userInvocable: frontmatter['user-invocable'],
    productBundle: bundleForSkill(name),
    filePath,
  };
}

function buildSkillCatalog(projectRoot) {
  const skillsDir = path.join(projectRoot, 'skills');
  const skills = skillDirs(skillsDir).map((name) => readSkill(skillsDir, name));
  return {
    generatedAt: new Date().toISOString(),
    skillCount: skills.length,
    taskClasses: TASK_CLASSES,
    riskLevels: RISK_LEVELS,
    skills,
  };
}

function validateOptionalMetadata(frontmatter) {
  const issues = [];
  if (frontmatter['task-class'] && !TASK_CLASSES.includes(frontmatter['task-class'])) {
    issues.push(`task-class must be one of: ${TASK_CLASSES.join(', ')}`);
  }
  if (frontmatter['risk-level'] && !RISK_LEVELS.includes(frontmatter['risk-level'])) {
    issues.push(`risk-level must be one of: ${RISK_LEVELS.join(', ')}`);
  }
  for (const key of ['expected-artifacts', 'verification-commands', 'neighbor-skills']) {
    if (frontmatter[key] && !Array.isArray(frontmatter[key])) {
      issues.push(`${key} must be an inline list, e.g. [item-a, item-b]`);
    }
  }
  return issues;
}

module.exports = {
  RISK_LEVELS,
  TASK_CLASSES,
  buildSkillCatalog,
  parseFrontmatter,
  validateOptionalMetadata,
};

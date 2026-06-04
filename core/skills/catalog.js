'use strict';

const fs = require('fs');
const path = require('path');

const TASK_CLASSES = ['orchestration', 'quality', 'knowledge', 'research', 'creation', 'operations', 'integration', 'utility'];
const RISK_LEVELS = ['low', 'medium', 'high'];

function parseFrontmatter(content) {
  const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content || '' };
  const raw = match[1];
  const body = match[2];
  const fm = {};
  const lines = raw.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const multiline = line.match(/^(\S[\w-]*):\s*[>|]-?\s*$/);
    if (multiline) {
      const key = multiline[1];
      const parts = [];
      index++;
      while (index < lines.length && /^\s+/.test(lines[index])) {
        parts.push(lines[index].trim());
        index++;
      }
      fm[key] = parts.join(' ');
      continue;
    }
    const kv = line.match(/^(\S[\w-]*):\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const value = kv[2].trim();
      if (value === 'true') fm[key] = true;
      else if (value === 'false') fm[key] = false;
      else if (value.startsWith('[') && value.endsWith(']')) {
        fm[key] = value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean);
      } else if (value) fm[key] = value;
      else fm[key] = null;
    }
    index++;
  }
  return { frontmatter: fm, body };
}

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
    taskClass: inferTaskClass(name, frontmatter, body),
    riskLevel: inferRiskLevel(frontmatter, body),
    expectedArtifacts: frontmatter['expected-artifacts'] || [],
    verificationCommands: frontmatter['verification-commands'] || [],
    benchmarkStatus: frontmatter['benchmark-status'] || bench.status,
    benchmarkCount: bench.count,
    neighborSkills: frontmatter['neighbor-skills'] || [],
    userInvocable: frontmatter['user-invocable'],
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

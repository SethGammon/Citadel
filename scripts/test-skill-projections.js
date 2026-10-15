#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSkill } = require(path.join(__dirname, '..', 'core', 'skills', 'parse-skill'));
const { renderOpenAIYaml, projectSkillToCodex } = require(path.join(__dirname, '..', 'core', 'skills', 'project-skill'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function testSkill(skillName) {
  const skillRoot = path.join(__dirname, '..', 'skills', skillName);
  const parsed = loadSkill(skillRoot, skillName);
  if (parsed.errors.length > 0) {
    fail(`Parsed ${skillName} skill has validation errors: ${parsed.errors.join('; ')}`);
  }

  const yaml = renderOpenAIYaml(parsed);
  if (!yaml.includes(`display_name: "${skillName}"`)) {
    fail('Generated openai.yaml is missing the expected display name');
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-skill-proj-'));
  const targetBase = path.join(tmpRoot, '.agents', 'skills');
  const result = projectSkillToCodex(skillRoot, targetBase, skillName);

  if (!fs.existsSync(result.outputs.skillPath)) {
    fail('Projected SKILL.md was not written');
  }
  if (!fs.existsSync(result.outputs.openaiYamlPath)) {
    fail('Projected openai.yaml was not written');
  }

  const projectedSkill = fs.readFileSync(result.outputs.skillPath, 'utf8');
  const projectedYaml = fs.readFileSync(result.outputs.openaiYamlPath, 'utf8');
  if (projectedSkill !== parsed.content || !projectedSkill.includes('## Protocol')) {
    fail('Projected SKILL.md does not contain expected canonical skill content');
  }
  if (!projectedYaml.includes('allow_implicit_invocation: true')) {
    fail('Projected openai.yaml does not contain expected policy');
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

function main() {
  for (const skillName of ['review', 'experiment']) testSkill(skillName);
  console.log('Skill projection tests pass.');
}

main();

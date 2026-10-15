#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSkill } = require(path.join(__dirname, '..', 'core', 'skills', 'parse-skill'));
const { renderOpenAIYaml, projectSkillToCodex } = require(path.join(__dirname, '..', 'core', 'skills', 'project-skill'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const skillRoot = path.join(__dirname, '..', 'skills', 'review');
  const parsed = loadSkill(skillRoot, 'review');
  if (parsed.errors.length > 0) {
    fail(`Parsed skill has validation errors: ${parsed.errors.join('; ')}`);
  }

  const yaml = renderOpenAIYaml(parsed);
  if (!yaml.includes('display_name: "review"')) {
    fail('Generated openai.yaml is missing the expected display name');
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-skill-proj-'));
  const targetBase = path.join(tmpRoot, '.agents', 'skills');
  const result = projectSkillToCodex(skillRoot, targetBase, 'review');

  if (!fs.existsSync(result.outputs.skillPath)) {
    fail('Projected SKILL.md was not written');
  }
  if (!fs.existsSync(result.outputs.openaiYamlPath)) {
    fail('Projected openai.yaml was not written');
  }

  const projectedSkill = fs.readFileSync(result.outputs.skillPath, 'utf8');
  const projectedYaml = fs.readFileSync(result.outputs.openaiYamlPath, 'utf8');
  if (!projectedSkill.includes('name: review') || !projectedSkill.includes('## Protocol')) {
    fail('Projected SKILL.md does not contain expected canonical skill content');
  }
  if (!projectedYaml.includes('allow_implicit_invocation: true')) {
    fail('Projected openai.yaml does not contain expected policy');
  }

  try {
    const { projectCodexSkills } = require('../runtimes/codex/generators/project-skills');
    const projected = projectCodexSkills({ projectRoot: tmpRoot, dryRun: true });
    assert(projected.length >= 48);
    for (const skill of projected) assert.deepEqual(skill.parsedSkill.errors, [], skill.skillName);

    const { parseSkillContent, parseSkillFrontmatter } = require('../core/skills/parse-skill');
    const { parseAgentFrontmatter } = require('../core/agents/parse-agent');
    const { parseFrontmatter } = require('../core/utils/frontmatter');
    const catalog = require('../core/skills/catalog');
    const fixture = [
      '---', 'name: "example"', 'description: >-', '  First line.', '  Second line.',
      '# model: ignored comment', 'user-invocable: false', 'maxTurns: 12',
      'expected-artifacts:', '  - "result.md"', 'tools: [Read, "Grep"]',
      'quoted: "false"', '---', '## Commands', 'Execute.',
      '## Quality Gates', 'Verify.', '## Exit Protocol', 'Report.',
    ].join('\n');
    for (const content of [fixture, fixture.replace(/\n/g, '\r\n')]) {
      const expected = parseFrontmatter(content).frontmatter;
      assert.deepEqual(parseSkillFrontmatter(content), expected);
      assert.deepEqual(parseAgentFrontmatter(content), expected);
      assert.deepEqual(catalog.parseFrontmatter(content).frontmatter, expected);
      assert.equal(expected.name, 'example');
      assert.equal(expected['user-invocable'], false);
      assert.equal(expected.quoted, 'false');
      assert.equal(expected.maxTurns, 12);
      assert.equal(expected.description, 'First line. Second line.');
      assert(!('# model' in expected));
      assert.deepEqual(expected['expected-artifacts'], ['result.md']);
      assert.deepEqual(expected.tools, ['Read', 'Grep']);
      assert.deepEqual(parseSkillContent('example', content).errors, []);
      for (const fragment of ['name: "example"', 'user-invocable: false', '## Commands',
        '## Quality Gates', '## Exit Protocol']) {
        assert(parseSkillContent('example', content.replace(fragment, '')).errors.length, fragment);
      }
    }
    assert(parseSkillContent('example', 'No metadata or sections').errors.length);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log('Skill projection tests pass.');
}

main();

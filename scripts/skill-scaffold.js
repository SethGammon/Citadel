#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const { RISK_LEVELS, TASK_CLASSES } = require('../core/skills/catalog');

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'new-skill';
}

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    taskClass: 'utility',
    riskLevel: 'medium',
    withBenchmark: false,
    write: false,
  };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--project-root') { args.projectRoot = path.resolve(value); index++; }
    else if (arg === '--name') { args.name = slug(value); index++; }
    else if (arg === '--description') { args.description = value; index++; }
    else if (arg === '--task-class') { args.taskClass = value; index++; }
    else if (arg === '--risk-level') { args.riskLevel = value; index++; }
    else if (arg === '--with-benchmark') args.withBenchmark = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return 'Usage: node scripts/skill-scaffold.js --name name --description "..." [--task-class utility] [--risk-level medium] [--with-benchmark] --write';
}

function skillMarkdown(args) {
  return `---
name: ${args.name}
description: >-
  ${args.description}
user-invocable: true
auto-trigger: false
last-updated: 2026-06-04
task-class: ${args.taskClass}
risk-level: ${args.riskLevel}
expected-artifacts: [HANDOFF]
verification-commands: [node scripts/skill-lint.js ${args.name}]
benchmark-status: ${args.withBenchmark ? 'present' : 'none'}
neighbor-skills: []
---

# /${args.name}

## Orientation

Use when this workflow is the narrowest fit for the user's request.
Do not use when another named skill is more specific.

## Protocol

1. Read the relevant project context.
2. Make the smallest scoped change that satisfies the request.
3. Verify with the commands listed in frontmatter.

## Fringe Cases

- **Missing project state:** Explain what is missing and stop before writing speculative files.

## Contextual Gates

**Disclosure:** State which files or state directories will be touched.
**Reversibility:** amber -- generated skill files can be removed if the workflow is not useful.
**Trust gates:** Any.

## Quality Gates

- \`node scripts/skill-lint.js ${args.name}\` passes.
- Any benchmark scaffold validates with \`node scripts/skill-bench.js --skill ${args.name}\`.

## Exit Protocol

\`\`\`
---HANDOFF---
- What changed
- Verification run
- Remaining risks or next steps
---
\`\`\`
`;
}

function benchmarkMarkdown(args) {
  return `---
name: basic-${args.name}
skill: ${args.name}
description: ${args.name} handles missing project state without crashing
input: /${args.name}
state: clean
behavior: invariant
assert-contains:
  - HANDOFF
---

A minimal benchmark scaffold for ${args.name}.
`;
}

function validateArgs(args) {
  const errors = [];
  if (!args.name) errors.push('--name is required');
  if (!args.description || args.description.length < 10) errors.push('--description must be at least 10 characters');
  if (!TASK_CLASSES.includes(args.taskClass)) errors.push(`--task-class must be one of: ${TASK_CLASSES.join(', ')}`);
  if (!RISK_LEVELS.includes(args.riskLevel)) errors.push(`--risk-level must be one of: ${RISK_LEVELS.join(', ')}`);
  return errors;
}

function scaffold(args) {
  const errors = validateArgs(args);
  if (errors.length) return { ok: false, errors };
  const skillDir = path.join(args.projectRoot, 'skills', args.name);
  const files = [{
    path: path.join(skillDir, 'SKILL.md'),
    content: skillMarkdown(args),
  }];
  if (args.withBenchmark) {
    files.push({
      path: path.join(skillDir, '__benchmarks__', 'basic.md'),
      content: benchmarkMarkdown(args),
    });
  }
  if (args.write) {
    if (fs.existsSync(skillDir)) return { ok: false, errors: [`skill already exists: ${args.name}`] };
    for (const file of files) {
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, file.content, 'utf8');
    }
  }
  return { ok: true, files: files.map((file) => file.path), preview: args.write ? null : files };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = scaffold(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  scaffold,
  skillMarkdown,
  usage,
};

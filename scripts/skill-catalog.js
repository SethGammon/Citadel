#!/usr/bin/env node

'use strict';

const path = require('path');

const { buildSkillCatalog } = require('../core/skills/catalog');

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), json: false };
  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--project-root') { args.projectRoot = path.resolve(value); index++; }
    else if (arg === '--task-class') { args.taskClass = value; index++; }
    else if (arg === '--risk-level') { args.riskLevel = value; index++; }
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return 'Usage: node scripts/skill-catalog.js [--task-class quality] [--risk-level medium] [--json]';
}

function filterCatalog(catalog, args) {
  return {
    ...catalog,
    skills: catalog.skills.filter((skill) => {
      return (!args.taskClass || skill.taskClass === args.taskClass) &&
        (!args.riskLevel || skill.riskLevel === args.riskLevel);
    }),
  };
}

function render(catalog) {
  const lines = [];
  lines.push('Skill Catalog');
  lines.push('='.repeat(40));
  lines.push(`Skills: ${catalog.skills.length}/${catalog.skillCount}`);
  for (const skill of catalog.skills) {
    lines.push(`  ${skill.name.padEnd(24)} ${skill.taskClass.padEnd(14)} ${skill.riskLevel.padEnd(6)} benchmarks=${skill.benchmarkCount}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const catalog = filterCatalog(buildSkillCatalog(args.projectRoot), args);
  process.stdout.write(args.json ? `${JSON.stringify(catalog, null, 2)}\n` : render(catalog));
}

if (require.main === module) {
  main();
}

module.exports = {
  filterCatalog,
  parseArgs,
  render,
  usage,
};

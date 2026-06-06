#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { buildProof } = require('./operating-proof');

const DEFAULT_TASK = 'review README.md for first-time developer friction';

function parseArgs(argv) {
  const args = {
    projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    json: false,
    write: false,
    runVerification: false,
    task: DEFAULT_TASK,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--json') args.json = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--run-verification') args.runVerification = true;
    else if (arg === '--task') args.task = argv[++index] || DEFAULT_TASK;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/usefulness-trial.js [--json] [--write] [--run-verification] [--task <request>] [--project-root <path>]',
    '',
    'Runs a first-use usefulness trial against a real project.',
    'The trial checks whether Citadel gives a user a setup path, next action, route, verification command, and durable evidence.',
    '--write records .planning/usefulness-trial/latest.md.',
  ].join('\n');
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function checkById(proof, id) {
  return proof.checks.find((check) => check.id === id) || {
    id,
    status: 'fail',
    detail: 'missing check',
    evidence: [],
  };
}

function criterion(id, label, status, detail, evidence = []) {
  return { id, label, status, detail, evidence };
}

function statusFromCheck(check, options = {}) {
  if (options.acceptPartial && check.status === 'partial') return 'pass';
  return check.status === 'pass' ? 'pass' : check.status;
}

function buildCriteria(proof) {
  const setup = checkById(proof, 'setup');
  const orient = checkById(proof, 'orient');
  const route = checkById(proof, 'route');
  const verify = checkById(proof, 'verify');
  const report = checkById(proof, 'report');

  return [
    criterion(
      'setup-path',
      'User can get to a working setup path',
      statusFromCheck(setup, { acceptPartial: true }),
      setup.detail,
      setup.evidence,
    ),
    criterion(
      'next-action',
      'User can understand the next action and risk boundary',
      statusFromCheck(orient),
      orient.detail,
      orient.evidence,
    ),
    criterion(
      'plain-language-routing',
      'User can ask a plain-English task without choosing a skill first',
      statusFromCheck(route),
      route.detail,
      route.evidence,
    ),
    criterion(
      'verification',
      'Citadel selects or runs a project-specific verification command',
      statusFromCheck(verify),
      verify.detail,
      verify.evidence,
    ),
    criterion(
      'durable-evidence',
      'The run leaves inspectable local evidence for another session',
      statusFromCheck(report),
      report.detail,
      report.evidence,
    ),
  ];
}

function decideTrial(proof, criteria) {
  if (proof.status === 'blocked' || criteria.some((item) => item.status === 'fail')) {
    return {
      status: 'blocked',
      nextAction: 'Fix failed trial criteria before using this project as Citadel usefulness evidence.',
    };
  }
  if (proof.summary.setup === 'partial') {
    return {
      status: 'setup-needed',
      nextAction: 'Run /do setup --express, then rerun node scripts/usefulness-trial.js --write --run-verification.',
    };
  }
  if (criteria.some((item) => item.status === 'partial')) {
    return {
      status: 'incomplete-evidence',
      nextAction: 'Create or refresh the missing proof artifacts, then rerun the usefulness trial.',
    };
  }
  return {
    status: 'ready-for-dogfood',
    nextAction: 'Use this project for the post-landing first-use audit and capture the generated report.',
  };
}

function score(criteria) {
  const passed = criteria.filter((item) => item.status === 'pass').length;
  return {
    passed,
    total: criteria.length,
    label: `${passed}/${criteria.length}`,
  };
}

function buildTrial(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const task = options.task || DEFAULT_TASK;
  const proof = buildProof(root, {
    routeRequest: task,
    runVerification: Boolean(options.runVerification),
    now: options.now,
  });
  const criteria = buildCriteria(proof);
  const decision = decideTrial(proof, criteria);

  return {
    generatedAt: options.now || proof.generatedAt,
    projectRoot: root,
    task,
    decision: decision.status,
    nextAction: decision.nextAction,
    score: score(criteria),
    proofStatus: proof.status,
    criteria,
    proofSummary: proof.summary,
  };
}

function renderTrial(trial) {
  const lines = [
    'Citadel Usefulness Trial',
    '='.repeat(40),
    `Generated: ${trial.generatedAt}`,
    `Project: ${trial.projectRoot}`,
    `Task: ${trial.task}`,
    `Decision: ${trial.decision}`,
    `Score: ${trial.score.label}`,
    `Proof status: ${trial.proofStatus}`,
    '',
    'Criteria',
  ];

  for (const item of trial.criteria) {
    lines.push(`- ${item.id}: ${item.status} - ${item.label}`);
    lines.push(`  detail: ${item.detail}`);
    for (const evidence of (item.evidence || []).slice(0, 4)) {
      lines.push(`  evidence: ${evidence}`);
    }
  }

  lines.push('');
  lines.push('Next Action');
  lines.push(`  ${trial.nextAction}`);

  lines.push('');
  lines.push('---HANDOFF---');
  lines.push(`- Decision: ${trial.decision}`);
  lines.push(`- Score: ${trial.score.label}`);
  lines.push(`- Task: ${trial.task}`);
  lines.push(`- Next: ${trial.nextAction}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function writeTrial(projectRoot, trial) {
  const outDir = path.join(projectRoot, '.planning', 'usefulness-trial');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'latest.md');
  fs.writeFileSync(outPath, renderTrial(trial), 'utf8');
  trial.reportPath = normalizePath(path.relative(projectRoot, outPath));
  return trial.reportPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const trial = buildTrial(args.projectRoot, {
    task: args.task,
    runVerification: args.runVerification,
  });
  if (args.write) writeTrial(path.resolve(args.projectRoot), trial);

  if (args.json) process.stdout.write(`${JSON.stringify(trial, null, 2)}\n`);
  else {
    process.stdout.write(renderTrial(trial));
    if (trial.reportPath) process.stdout.write(`Report: ${trial.reportPath}\n`);
  }

  process.exitCode = trial.decision === 'blocked' ? 1 : 0;
}

if (require.main === module) main();

module.exports = {
  buildCriteria,
  buildTrial,
  decideTrial,
  parseArgs,
  renderTrial,
  usage,
  writeTrial,
};

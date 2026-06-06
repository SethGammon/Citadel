#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const path = require('path');

function parseArgs(argv) {
  const args = {
    input: [],
    json: false,
    projectRoot: process.cwd(),
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') args.json = true;
    else if (arg === '--project-root') args.projectRoot = path.resolve(argv[++index] || '.');
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--') {
      args.input.push(...argv.slice(index + 1));
      break;
    }
    else args.input.push(arg);
  }

  return {
    ...args,
    input: args.input.join(' ').trim(),
  };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/route-preview.js [--json] [--project-root <path>] -- <request>',
    '',
    'Shows the proportional /do route, alternatives, boundary, and verification before execution.',
  ].join('\n');
}

const TIER0 = [
  {
    id: 'status',
    pattern: /\b(status|dashboard|what'?s happening|what'?s going on|show activity)\b/i,
    selected: '/dashboard',
    command: 'node scripts/dashboard.js',
    reason: 'status language maps directly to the dashboard without orchestration.',
    verification: 'Confirm the dashboard renders the expected pending counts and next action.',
  },
  {
    id: 'next',
    pattern: /\b(next|what should i do next|fix harness state|repair harness)\b/i,
    selected: '/do next',
    command: 'node scripts/operator-console.js --run',
    reason: 'operator language maps to the next-action cockpit and deterministic local repairs.',
    verification: 'Confirm the operator report reaches idle or an explicit approval boundary.',
  },
  {
    id: 'operator',
    pattern: /\b(operator|operator console|approval capsule|what'?s up|what should happen next)\b/i,
    selected: '/do operator',
    command: 'node scripts/operator-console.js',
    reason: 'operator-inspection language asks for the cockpit without running repairs.',
    verification: 'Confirm the report names the next action, boundary, risk, and verification profile.',
  },
  {
    id: 'continue',
    pattern: /\b(continue|keep going)\b/i,
    selected: '/do continue',
    command: 'node scripts/continue-action.js --run',
    reason: 'continuation language should resume active campaign or fleet state when present.',
    verification: 'Confirm the continuation report either resumes work or says no active work exists.',
  },
  {
    id: 'setup',
    pattern: /\b(setup|first run|configure harness)\b/i,
    selected: '/setup',
    command: '/do setup --express',
    reason: 'first-run language should initialize project harness state before deeper routing.',
    verification: 'Run the dashboard and confirm `.planning/` exists for the current project.',
  },
  {
    id: 'test',
    pattern: /\b(test|tests)\b/i,
    selected: 'direct-command',
    command: 'npm run test',
    reason: 'test language maps to the project verification command.',
    verification: 'Confirm the command exits 0 or reports actionable failures.',
  },
  {
    id: 'build',
    pattern: /\b(build)\b/i,
    selected: 'direct-command',
    command: 'npm run build',
    reason: 'build language maps to the project build command.',
    verification: 'Confirm the command exits 0 or reports actionable failures.',
  },
  {
    id: 'typecheck',
    pattern: /\b(typecheck|type check)\b/i,
    selected: 'direct-command',
    command: 'npm run typecheck',
    reason: 'typecheck language maps to the project type verification command.',
    verification: 'Confirm the command exits 0 or reports actionable type errors.',
  },
];

const SKILLS = [
  skill('/review', ['review', 'code review'], 'Code Quality'),
  skill('/test-gen', ['generate tests', 'write tests', 'test coverage'], 'Code Quality'),
  skill('/doc-gen', ['document', 'docs', 'docstring', 'readme'], 'Documentation'),
  skill('/refactor', ['refactor', 'extract', 'split file'], 'Code Quality'),
  skill('/scaffold', ['scaffold', 'new module', 'new component', 'bootstrap'], 'Creation'),
  skill('/create-skill', ['create skill', 'new skill', 'repeated pattern'], 'Harness'),
  skill('/session-handoff', ['handoff', 'session summary'], 'Harness'),
  skill('/research', ['research', 'investigate', 'look into', 'find out'], 'Research'),
  skill('/research-fleet', ['research fleet', 'parallel research', 'multi-angle research'], 'Research'),
  skill('/systematic-debugging', ['debug', 'root cause', 'diagnose', 'why is', 'investigate bug'], 'Debugging'),
  skill('/live-preview', ['preview', 'screenshot', 'visual check', 'does it render'], 'Verification'),
  skill('/qa', ['qa', 'click through', 'browser test', 'test the app'], 'Verification'),
  skill('/triage', ['triage', 'open issues', 'investigate issue', 'review pr'], 'GitHub'),
  skill('/pr-watch', ['watch pr', 'watch ci', 'fix ci', 'checks failing'], 'GitHub'),
  skill('/telemetry', ['telemetry', 'session cost', 'spending', 'what hooks fired'], 'Observability'),
  skill('/merge-review', ['merge review', 'safe to merge', 'pending branches'], 'Git'),
  skill('/improve', ['improve', 'quality loop', 'rubric', 'score against'], 'Improvement'),
  skill('/evolve', ['evolve', 'improve until', 'hypothesis', 'sustained improve'], 'Improvement'),
  skill('/organize', ['organize', 'folder structure', 'project structure'], 'Maintenance'),
  skill('/houseclean', ['houseclean', 'disk space', 'free space', 'orphaned worktrees'], 'Maintenance'),
  skill('/daemon', ['daemon', 'continuous', 'overnight', '24/7'], 'Automation'),
  skill('/map', ['map', 'index codebase', 'structural index'], 'Codebase'),
  skill('/watch', ['watch files', 'marker comments', '@citadel'], 'Automation'),
  skill('/infra-audit', ['infra', 'infrastructure', 'docker-compose'], 'Infrastructure'),
  skill('/workspace', ['workspace', 'multi-repo', 'cross-repo', 'multiple repos'], 'Workspace'),
  skill('/prd', ['prd', 'requirements', 'spec', 'plan an app'], 'Planning'),
  skill('/architect', ['architect', 'architecture', 'design the system', 'file structure'], 'Planning'),
  skill('/create-app', ['create app', 'build app', 'make an app', 'add auth', 'add payments'], 'Creation'),
  skill('/marshal', ['orchestrate', 'chain skills', 'multi-step'], 'Orchestration'),
  skill('/archon', ['campaign', 'multi-session', 'phases'], 'Orchestration'),
  skill('/fleet --quick', ['parallel', 'simultaneous', 'multiple agents', 'at the same time'], 'Orchestration'),
];

function skill(route, keywords, category) {
  return { route, keywords, category };
}

function normalized(value) {
  return String(value || '').toLowerCase();
}

function words(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

function matchesKeyword(input, keyword) {
  const lower = normalized(input);
  const needle = normalized(keyword);
  if (needle.includes(' ')) return lower.includes(needle);
  return new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(input);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatches(input) {
  return SKILLS
    .map((entry) => ({
      ...entry,
      matches: entry.keywords.filter((keyword) => matchesKeyword(input, keyword)),
    }))
    .filter((entry) => entry.matches.length > 0)
    .sort((a, b) => b.matches.length - a.matches.length || a.keywords.length - b.keywords.length);
}

function hasSingleFileSignal(input) {
  return /\b[\w.-]+\.(js|jsx|ts|tsx|mjs|cjs|json|md|css|html|py|rb|go|rs|java|cs)\b/i.test(input);
}

function classifyComplexity(input, matches) {
  const count = words(input).length;
  const lower = normalized(input);
  const parallel = /\b(parallel|simultaneous|multiple agents|at the same time|both\b.+\band)\b/i.test(input);
  const persistent = /\b(campaign|multi-session|phases|overnight|continue until|run until)\b/i.test(input);
  const crossDomain = /\b(platform|across|all|entire|multi-repo|cross-repo|multiple repos)\b/i.test(input);
  const taste = /\b(design|experience|quality|polish|intuitive)\b/i.test(input);
  const complexity = persistent || parallel || crossDomain ? 4 : count > 24 || taste ? 3 : matches.length > 1 ? 3 : count > 8 ? 2 : 1;

  return {
    scope: crossDomain ? 'cross-domain' : hasSingleFileSignal(input) ? 'single-file' : 'single-domain',
    complexity,
    requiresPersistence: persistent,
    requiresParallel: parallel,
    requiresTaste: taste,
  };
}

function selectTier0(input) {
  return TIER0.find((entry) => {
    if (!entry.pattern.test(input)) return false;
    if (entry.id === 'status' && hasSingleFileSignal(input)) return false;
    return true;
  }) || null;
}

function selectRoute(input) {
  if (!input.trim()) {
    return {
      tier: 0,
      selected: '/do --list',
      command: '/do --list',
      reason: 'empty input should show available routes instead of guessing.',
      confidence: 'high',
      alternatives: [],
      verification: 'Confirm the skill list renders and asks for a direction.',
      dimensions: classifyComplexity(input, []),
    };
  }

  const tier0 = selectTier0(input);
  if (tier0) {
    return {
      tier: 0,
      selected: tier0.selected,
      command: tier0.command,
      reason: tier0.reason,
      confidence: 'high',
      alternatives: alternativesFor(input, []),
      verification: tier0.verification,
      dimensions: classifyComplexity(input, []),
    };
  }

  const matches = keywordMatches(input);
  const dimensions = classifyComplexity(input, matches);
  if (matches.length === 1) {
    let selected = matches[0].route;
    let reason = `one high-confidence keyword group matched ${matches[0].route}: ${matches[0].matches.join(', ')}.`;
    const proportional = applyProportionality(input, selected, dimensions);
    selected = proportional.selected;
    if (proportional.reason) reason = proportional.reason;

    return {
      tier: 2,
      selected,
      command: selected,
      reason,
      confidence: 'high',
      alternatives: alternativesFor(input, matches),
      verification: verificationFor(selected),
      dimensions,
    };
  }

  if (matches.length > 1) {
    return {
      tier: 3,
      selected: '/marshal',
      command: '/marshal',
      reason: `multiple route families matched (${matches.slice(0, 3).map((item) => item.route).join(', ')}), so Marshal should sequence the work before escalating.`,
      confidence: 'medium',
      alternatives: alternativesFor(input, matches),
      verification: verificationFor('/marshal'),
      dimensions,
    };
  }

  let selected = fallbackRoute(dimensions);
  let reason = fallbackReason(selected, dimensions);
  const proportional = applyProportionality(input, selected, dimensions);
  selected = proportional.selected;
  if (proportional.reason) reason = proportional.reason;

  return {
    tier: 3,
    selected,
    command: selected,
    reason,
    confidence: 'medium',
    alternatives: alternativesFor(input, matches),
    verification: verificationFor(selected),
    dimensions,
  };
}

function fallbackRoute(dimensions) {
  if (dimensions.requiresParallel) return '/fleet --quick';
  if (dimensions.requiresPersistence || dimensions.complexity >= 4) return '/archon';
  if (dimensions.complexity <= 1) return 'direct-edit';
  return '/marshal';
}

function fallbackReason(selected, dimensions) {
  if (selected === '/fleet --quick') return 'the request signals independent parallel work.';
  if (selected === '/archon') return 'the request appears persistent or campaign-sized.';
  if (selected === 'direct-edit') return 'the request appears small enough for a direct edit.';
  return 'the request needs sequencing but not campaign persistence yet.';
}

function applyProportionality(input, selected, dimensions) {
  if (selected.startsWith('/fleet') && dimensions.scope === 'single-file') {
    return {
      selected: '/marshal',
      reason: 'proportionality downgraded Fleet because the request mentions a single file.',
    };
  }
  if ((selected === '/archon' || selected.startsWith('/fleet')) && words(input).length < 20) {
    return {
      selected: '/marshal',
      reason: 'proportionality downgraded campaign-level routing because the input is brief.',
    };
  }
  return { selected, reason: null };
}

function alternativesFor(_input, matches) {
  const alternatives = [];
  for (const item of matches.slice(0, 4)) {
    alternatives.push({
      route: item.route,
      why: `matched ${item.matches.join(', ')}`,
    });
  }

  if (!alternatives.some((item) => item.route === '/marshal')) {
    alternatives.push({ route: '/marshal', why: 'safe fallback for unclear multi-step work' });
  }
  if (!alternatives.some((item) => item.route === '/archon')) {
    alternatives.push({ route: '/archon', why: 'use only when persistence or phases are needed' });
  }
  if (!alternatives.some((item) => item.route === '/fleet --quick')) {
    alternatives.push({ route: '/fleet --quick', why: 'use only for independent parallel scopes' });
  }
  return alternatives.slice(0, 5);
}

function verificationFor(route) {
  if (route === '/marshal') return 'Confirm the selected skill sequence, changed files, and final verification command.';
  if (route === '/archon') return 'Confirm campaign phases, claimed scope, exit evidence, and verification profile.';
  if (route.startsWith('/fleet')) return 'Confirm independent scopes, merge order, and per-branch verification reports.';
  if (route === 'direct-edit') return 'Inspect the diff and run the smallest relevant verification command.';
  if (route.startsWith('/')) return `Confirm ${route} reports its own handoff and verification evidence.`;
  return 'Run the command and confirm it exits 0 or reports actionable failures.';
}

function gitDirty(projectRoot) {
  const result = childProcess.spawnSync('git', ['status', '--short'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) return false;
  return Boolean(String(result.stdout || '').trim());
}

function boundaryFor(route, dirty) {
  if (dirty && route !== '/dashboard' && route !== '/do operator') {
    return {
      canRunNow: false,
      boundary: 'worktree-review',
      risk: 'low',
      approval: 'Review uncommitted worktree changes before starting the routed action.',
    };
  }
  if (route === '/fleet --quick') {
    return {
      canRunNow: false,
      boundary: 'parallel-agent-approval',
      risk: 'medium-high',
      approval: 'Approve Fleet only after scopes are independent and merge order is clear.',
    };
  }
  if (route === '/archon') {
    return {
      canRunNow: false,
      boundary: 'campaign-approval',
      risk: 'medium',
      approval: 'Approve campaign persistence after phases and exit evidence are clear.',
    };
  }
  return {
    canRunNow: true,
    boundary: route.startsWith('/') ? 'agent-route' : 'local-command',
    risk: route === 'direct-edit' ? 'low' : 'medium',
    approval: null,
  };
}

function buildPreview(input, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const selected = selectRoute(input);
  const dirty = options.gitDirty === undefined ? gitDirty(projectRoot) : Boolean(options.gitDirty);
  const boundary = boundaryFor(selected.selected, dirty);

  return {
    generatedAt: options.now || new Date().toISOString(),
    projectRoot,
    input: String(input || ''),
    ...selected,
    ...boundary,
    gitDirty: dirty,
  };
}

function render(preview) {
  const lines = [
    'Routing Preview',
    '='.repeat(40),
    `Input: ${preview.input || '(empty)'}`,
    `Selected: ${preview.selected}`,
    `Command: ${preview.command}`,
    `Tier: ${preview.tier}`,
    `Confidence: ${preview.confidence}`,
    `Why: ${preview.reason}`,
    '',
    'Dimensions',
    `  Scope: ${preview.dimensions.scope}`,
    `  Complexity: ${preview.dimensions.complexity}`,
    `  Persistence: ${preview.dimensions.requiresPersistence ? 'yes' : 'no'}`,
    `  Parallel: ${preview.dimensions.requiresParallel ? 'yes' : 'no'}`,
    `  Taste: ${preview.dimensions.requiresTaste ? 'yes' : 'no'}`,
    '',
    'Boundary',
    `  Can run now: ${preview.canRunNow ? 'yes' : 'no'}`,
    `  Boundary: ${preview.boundary}`,
    `  Risk: ${preview.risk}`,
  ];

  if (preview.approval) lines.push(`  Approval: ${preview.approval}`);

  lines.push('');
  lines.push('Alternatives');
  for (const alternative of preview.alternatives) {
    lines.push(`  - ${alternative.route}: ${alternative.why}`);
  }

  lines.push('');
  lines.push('Verify');
  lines.push(`  ${preview.verification}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const preview = buildPreview(args.input, { projectRoot: args.projectRoot });
  if (args.json) process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  else process.stdout.write(render(preview));
}

if (require.main === module) main();

module.exports = {
  buildPreview,
  keywordMatches,
  parseArgs,
  render,
  selectRoute,
  usage,
};

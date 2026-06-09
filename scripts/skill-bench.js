#!/usr/bin/env node

/**
 * skill-bench.js — Scenario-based benchmark runner for Citadel skills
 *
 * Discovers scenario files in skills/{name}/__benchmarks__/*.md, sets up
 * isolated temp project states, invokes Claude Code CLI in --print mode,
 * and asserts the output against expected patterns.
 *
 * TWO MODES:
 *   Static (default): validates scenario files + state setup. Zero cost.
 *   Execute (--execute): runs scenarios against the real Claude CLI or Codex exec.
 *
 * Usage:
 *   node scripts/skill-bench.js                            # static validate all
 *   node scripts/skill-bench.js --execute                  # run against claude
 *   node scripts/skill-bench.js --execute --runtime codex-exec
 *   node scripts/skill-bench.js --execute --runtime codex-exec --codex-bin C:\path\to\codex.exe --codex-model gpt-5.5 --codex-service-tier fast
 *   node scripts/skill-bench.js --execute --verify-hooks   # also assert hooks fired
 *   node scripts/skill-bench.js --skill dashboard          # filter by skill name
 *   node scripts/skill-bench.js --scenario missing-state   # filter by scenario name
 *   node scripts/skill-bench.js --tag fringe               # filter by tag
 *   node scripts/skill-bench.js --invariant-only           # only invariant-behavior scenarios
 *   node scripts/skill-bench.js --list                     # list scenarios, no run
 *   node scripts/skill-bench.js --json                     # machine-readable output
 *
 * Scenario files live at: skills/{skill}/__benchmarks__/{scenario}.md
 *
 * Exit codes:
 *   0 = all scenarios pass (or static-only mode completed)
 *   1 = one or more scenarios failed
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { execFileSync, execSync } = require('child_process');
const { buildCodexExecArgs } = require('../core/codex/native-integrations');

const PLUGIN_ROOT   = path.resolve(__dirname, '..');
const SKILLS_DIR    = path.join(PLUGIN_ROOT, 'skills');
const RESULTS_DIR   = path.join(PLUGIN_ROOT, '.planning', 'benchmark-results');

// ── CLI args ─────────────────────────────────────────────────────────────────

const args           = process.argv.slice(2);
const EXECUTE_MODE   = args.includes('--execute');
const LIST_MODE      = args.includes('--list');
const JSON_MODE      = args.includes('--json');
const VERIFY_HOOKS   = args.includes('--verify-hooks'); // install hooks + assert telemetry grew
const INVARIANT_ONLY = args.includes('--invariant-only'); // filter to invariant-behavior scenarios only
function getArgValue(flag) {
  // --flag=value  OR  --flag value (next token, only if it doesn't start with --)
  const eq = args.find(a => a.startsWith(flag + '='));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return null;
}

const skillFilter = getArgValue('--skill');
const scenarioFilter = getArgValue('--scenario');
const tagFilter   = getArgValue('--tag');
const runtimeFilter = getArgValue('--runtime') || 'claude';
const CODEX_SANDBOX = getArgValue('--codex-sandbox') || 'read-only';
const CODEX_BIN = getArgValue('--codex-bin') || process.env.CODEX_CLI_PATH || process.env.CITADEL_CODEX_BIN || null;
const CODEX_MODEL = getArgValue('--codex-model') || process.env.CITADEL_CODEX_MODEL || null;
const CODEX_SERVICE_TIER = getArgValue('--codex-service-tier') || process.env.CITADEL_CODEX_SERVICE_TIER || null;

// ── Scenario parsing ──────────────────────────────────────────────────────────

/**
 * Parse a scenario .md file.
 * Frontmatter fields supported:
 *   name            — scenario identifier
 *   skill           — which skill this tests
 *   description     — human-readable summary
 *   tags            — comma-separated or YAML list: [fringe, missing-state]
 *   input           — the prompt to send to the skill
 *   state           — named project state: clean | with-campaign | with-completed-campaign | with-telemetry
 *   behavior        — invariant | implementation (default: invariant)
 *   assert-contains — YAML list: patterns that MUST appear in output (case-insensitive substring)
 *   assert-not-contains — YAML list: patterns that must NOT appear in output
 *   timeout         — milliseconds before giving up (default: 180000)
 *   skip-execute    — true: skip in execute mode (not a failure); for external services or agent spawning
 *   skip-reason     — why skip-execute is set: requires-agent-spawn | requires-web-search | requires-github-pr | requires-playwright | requires-ui-codebase | interactive-setup
 *
 * @param {string} filePath
 * @returns {object|null} parsed scenario, or null with error logged
 */
function parseScenario(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`  ERROR reading ${filePath}: ${e.message}`);
    return null;
  }

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    console.error(`  ERROR: ${path.basename(filePath)} has no frontmatter block`);
    return null;
  }

  const raw  = fmMatch[1];
  const body = fmMatch[2].trim();
  const fm   = {};

  // Parse YAML-like frontmatter
  const lines = raw.split(/\r?\n/);
  let i = 0;
  let currentListKey = null;

  while (i < lines.length) {
    const line = lines[i];

    // YAML list item
    if (/^\s+-\s+/.test(line) && currentListKey) {
      let value = line.replace(/^\s+-\s+/, '').trim();
      // Strip surrounding quotes (YAML allows quoting list values: - "pattern")
      value = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      fm[currentListKey] = fm[currentListKey] || [];
      fm[currentListKey].push(value);
      i++;
      continue;
    }

    // Key: value or Key: (list follows)
    const kvMatch = line.match(/^([\w-]+):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].trim();
      currentListKey = null;

      if (val === '' || val === '[]') {
        // empty or explicit empty list — will be populated by list items below
        fm[key] = [];
        currentListKey = key;
      } else if (val.startsWith('[') && val.endsWith(']')) {
        // Inline list: [a, b, c]
        fm[key] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
      } else {
        fm[key] = val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    } else {
      currentListKey = null;
    }
    i++;
  }

  // Validate required fields
  const errors = [];
  if (!fm.name)  errors.push('missing `name`');
  if (!fm.skill) errors.push('missing `skill`');
  if (!fm.input) errors.push('missing `input`');
  if (errors.length) {
    console.error(`  ERROR: ${path.basename(filePath)}: ${errors.join(', ')}`);
    return null;
  }

  return {
    name:             fm.name,
    skill:            fm.skill,
    description:      fm.description || '',
    tags:             Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
    input:            fm.input,
    state:            fm.state || 'clean',
    behavior:         fm.behavior || 'invariant',
    assertContains:    Array.isArray(fm['assert-contains'])     ? fm['assert-contains']     : [],
    assertNotContains: Array.isArray(fm['assert-not-contains']) ? fm['assert-not-contains'] : [],
    timeout:          parseInt(fm.timeout, 10) || 180000,
    skipExecute:      fm['skip-execute'] === 'true' || fm['skip-execute'] === true,
    skipReason:       fm['skip-reason'] || null,
    filePath,
    body,
  };
}

// ── Scenario discovery ────────────────────────────────────────────────────────

function discoverScenarios() {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const scenarios = [];
  // Discover skill names from nested skills/{name}/SKILL.md directories
  const skillNames = fs.readdirSync(SKILLS_DIR)
    .filter(name => {
      const skillFile = path.join(SKILLS_DIR, name, 'SKILL.md');
      return fs.existsSync(skillFile) && fs.statSync(skillFile).isFile();
    });

  for (const skillName of skillNames) {
    const benchDir = path.join(SKILLS_DIR, skillName, '__benchmarks__');
    if (!fs.existsSync(benchDir)) continue;

    const files = fs.readdirSync(benchDir)
      .filter(f => f.endsWith('.md'))
      .sort();

    for (const file of files) {
      const scenario = parseScenario(path.join(benchDir, file));
      if (scenario) scenarios.push(scenario);
    }
  }

  return scenarios;
}

// ── Project state setup ───────────────────────────────────────────────────────

/**
 * Named project states for scenario setup.
 * Each state function writes files into the given tmpDir.
 */
const STATES = {
  'clean': (tmpDir) => {
    // Empty project — no .planning/, no .claude/
    // Nothing to write
  },

  'with-loop-project': (tmpDir) => {
    const scriptsDir = path.join(tmpDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: {
        lint: 'node scripts/lint.js',
      },
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(scriptsDir, 'lint.js'), "console.log('lint ok');\n");
  },

  'with-campaign': (tmpDir) => {
    const campaignDir = path.join(tmpDir, '.planning', 'campaigns');
    fs.mkdirSync(campaignDir, { recursive: true });
    fs.writeFileSync(path.join(campaignDir, 'test-campaign.md'), [
      '# Campaign: Test Campaign',
      '',
      'Status: active',
      'Started: 2026-03-26T00:00:00.000Z',
      'Direction: Build the test feature — a sample campaign for benchmark testing.',
      '',
      '## Claimed Scope',
      '- src/',
      '',
      '## Phases',
      '',
      '1. [complete] build: Phase 1',
      '2. [in-progress] build: Phase 2',
      '3. [pending] verify: Phase 3',
      '',
      '## Feature Ledger',
      '',
      '| Feature | Status | Phase | Notes |',
      '|---|---|---|---|',
      '| Test feature | complete | 1 | Built and verified |',
      '',
      '## Decision Log',
      '',
      '- 2026-03-26: Used TypeScript for type safety.',
      '',
      '## Active Context',
      '',
      'Currently in Phase 2 — building main module.',
      '',
      '## Continuation State',
      '',
      'Phase: 2',
      'Sub-step: Writing tests',
      'Blocking: none',
    ].join('\n'));

    // Add harness.json so setup/already-configured tests the right code path
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'harness.json'), JSON.stringify({
      language: 'typescript', framework: 'react', packageManager: 'npm',
      typecheck: { command: 'npm run typecheck', perFile: true },
      test: { command: 'npm test', framework: 'jest' },
      qualityRules: { builtIn: ['no-confirm-alert', 'no-transition-all'], custom: [] },
      protectedFiles: ['.claude/harness.json'],
      features: { intakeScanner: true, telemetry: true },
    }, null, 2));

    // Add some telemetry
    const telemetryDir = path.join(tmpDir, '.planning', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(telemetryDir, 'hook-timing.jsonl'), [
      JSON.stringify({ hook: 'post-edit', duration_ms: 120, timestamp: now, file: 'src/index.ts', typecheck: 'pass' }),
      JSON.stringify({ hook: 'quality-gate', duration_ms: 45, timestamp: now }),
    ].join('\n') + '\n');
  },

  'with-completed-campaign': (tmpDir) => {
    const completedDir = path.join(tmpDir, '.planning', 'campaigns', 'completed');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.writeFileSync(path.join(completedDir, 'auth-overhaul.md'), [
      '# Campaign: Auth Overhaul',
      '',
      'Status: completed',
      'Started: 2026-03-20T00:00:00.000Z',
      'Direction: Replace legacy auth with JWT.',
      '',
      '## Phases',
      '1. [complete] research: Audit existing auth',
      '2. [complete] build: Implement JWT middleware',
      '3. [complete] verify: All auth tests pass',
      '',
      '## Feature Ledger',
      '| Feature | Status | Phase | Notes |',
      '|---|---|---|---|',
      '| JWT middleware | complete | 2 | 0 type errors |',
      '| Auth tests | complete | 3 | 42 tests pass |',
      '',
      '## Decision Log',
      '- 2026-03-21: Chose jose library over jsonwebtoken for browser compat.',
      '- 2026-03-22: Refresh tokens stored in httpOnly cookies only.',
    ].join('\n'));
  },

  'with-telemetry': (tmpDir) => {
    const telemetryDir = path.join(tmpDir, '.planning', 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    const now = new Date().toISOString();
    const entries = [
      { hook: 'post-edit', duration_ms: 110, timestamp: now, file: 'src/auth.ts', typecheck: 'pass' },
      { event: 'tool-call', tool: 'Edit', target: 'src/auth.ts', timestamp: now, project: 'myapp' },
      { hook: 'quality-gate', duration_ms: 55, timestamp: now },
      { event: 'campaign-start', agent: 'archon', session: 'auth-overhaul', timestamp: now },
    ];
    fs.writeFileSync(
      path.join(telemetryDir, 'hook-timing.jsonl'),
      entries.filter(e => e.hook).map(e => JSON.stringify(e)).join('\n') + '\n'
    );
    fs.writeFileSync(
      path.join(telemetryDir, 'audit.jsonl'),
      entries.filter(e => e.event).map(e => JSON.stringify(e)).join('\n') + '\n'
    );
  },

  'with-intake': (tmpDir) => {
    const intakeDir = path.join(tmpDir, '.planning', 'intake');
    fs.mkdirSync(intakeDir, { recursive: true });
    fs.writeFileSync(path.join(intakeDir, 'add-logging.md'), [
      '---',
      'status: briefed',
      'priority: high',
      '---',
      '',
      '# Add structured logging to API endpoints',
      '',
      '## Problem',
      'No visibility into API call patterns or errors in production.',
      '',
      '## Approach',
      'Add a logging middleware that records method, path, status, and duration.',
      'Write logs to .planning/telemetry/api-requests.jsonl.',
      '',
      '## Acceptance criteria',
      '- Every API call logged with timestamp, method, path, status, duration_ms',
      '- No existing tests broken',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), [
      '# Test Project',
      '',
      'A simple Express API.',
      '',
      '## Stack',
      '- Node.js + Express',
      '- Jest for tests',
    ].join('\n'));
  },

  'with-fleet-session': (tmpDir) => {
    const fleetDir = path.join(tmpDir, '.planning', 'fleet');
    fs.mkdirSync(fleetDir, { recursive: true });
    fs.writeFileSync(path.join(fleetDir, 'session-feature-build.md'), [
      '# Fleet Session: feature-build',
      '',
      'status: active',
      'wave: 2',
      'agents: 3',
      'coordinator: archon',
    ].join('\n'));
  },

  'with-source': (tmpDir) => {
    // Project with existing TypeScript React components — for scaffold exemplar tests
    const srcDir = path.join(tmpDir, 'src', 'components');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'UserCard.tsx'), [
      "import React from 'react';",
      '',
      'interface UserCardProps {',
      '  name: string;',
      '  email: string;',
      '  avatarUrl?: string;',
      '}',
      '',
      'export const UserCard: React.FC<UserCardProps> = ({ name, email, avatarUrl }) => {',
      '  return (',
      '    <div className="user-card">',
      '      {avatarUrl && <img src={avatarUrl} alt={name} />}',
      '      <h3>{name}</h3>',
      '      <p>{email}</p>',
      '    </div>',
      '  );',
      '};',
      '',
      'export default UserCard;',
    ].join('\n'));

    fs.writeFileSync(path.join(srcDir, 'StatusBadge.tsx'), [
      "import React from 'react';",
      '',
      'interface StatusBadgeProps {',
      '  status: "active" | "inactive" | "pending";',
      '  label?: string;',
      '}',
      '',
      'export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {',
      '  return (',
      '    <span className={`badge badge--${status}`}>',
      '      {label ?? status}',
      '    </span>',
      '  );',
      '};',
      '',
      'export default StatusBadge;',
    ].join('\n'));

    fs.writeFileSync(path.join(srcDir, 'index.ts'), [
      "export { UserCard } from './UserCard';",
      "export { StatusBadge } from './StatusBadge';",
    ].join('\n'));

    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), [
      '# Test Project',
      '',
      'A TypeScript React application.',
      '',
      '## Stack',
      '- TypeScript + React',
      '- Components in src/components/',
      '- Named exports, barrel index at src/components/index.ts',
    ].join('\n'));
  },

  'with-ui-source': (tmpDir) => {
    // Project with CSS custom properties, Tailwind config, and components — for design extraction
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(path.join(tmpDir, 'tailwind.config.js'), [
      "/** @type {import('tailwindcss').Config} */",
      'module.exports = {',
      "  content: ['./src/**/*.{ts,tsx}'],",
      '  theme: {',
      '    extend: {',
      '      colors: {',
      "        brand: { DEFAULT: '#2563eb', light: '#93c5fd', dark: '#1d4ed8' },",
      "        surface: { DEFAULT: '#ffffff', muted: '#f8fafc', subtle: '#f1f5f9' },",
      "        danger: '#ef4444',",
      "        success: '#22c55e',",
      '      },',
      '      fontFamily: {',
      "        sans: ['Inter', 'system-ui', 'sans-serif'],",
      "        mono: ['JetBrains Mono', 'monospace'],",
      '      },',
      '      spacing: {',
      "        '4xs': '2px', '3xs': '4px', '2xs': '8px', xs: '12px',",
      "        sm: '16px', md: '24px', lg: '32px', xl: '48px',",
      '      },',
      '    },',
      '  },',
      '};',
    ].join('\n'));

    fs.writeFileSync(path.join(srcDir, 'tokens.css'), [
      ':root {',
      '  --color-brand: #2563eb;',
      '  --color-brand-light: #93c5fd;',
      '  --color-brand-dark: #1d4ed8;',
      '  --color-surface: #ffffff;',
      '  --color-surface-muted: #f8fafc;',
      '  --color-text: #0f172a;',
      '  --color-text-muted: #64748b;',
      '  --font-sans: Inter, system-ui, sans-serif;',
      '  --font-mono: "JetBrains Mono", monospace;',
      '  --text-xs: 0.75rem;',
      '  --text-sm: 0.875rem;',
      '  --text-base: 1rem;',
      '  --text-lg: 1.125rem;',
      '  --text-xl: 1.25rem;',
      '  --radius-sm: 4px;',
      '  --radius-md: 8px;',
      '  --radius-lg: 12px;',
      '  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);',
      '  --shadow-md: 0 4px 6px rgba(0,0,0,0.1);',
      '}',
    ].join('\n'));

    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), [
      '# Test Project',
      '',
      'A TypeScript React application with a defined design system.',
      '',
      '## Stack',
      '- TypeScript + React',
      '- Tailwind CSS with custom design tokens',
      '- CSS custom properties in src/tokens.css',
      '- Color, typography, and spacing defined in tailwind.config.js',
    ].join('\n'));
  },

  'with-git-remote': (tmpDir) => {
    // Minimal git repo with a GitHub remote — for git-dependent skills (pr-watch, triage)
    try {
      execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
      execSync('git remote add origin https://github.com/example/test-repo.git', { cwd: tmpDir, stdio: 'pipe' });
      execSync('git config user.email "bench@citadel.test"', { cwd: tmpDir, stdio: 'pipe' });
      execSync('git config user.name "Bench"', { cwd: tmpDir, stdio: 'pipe' });
    } catch { /* ignore git init errors in restricted envs */ }
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), [
      '# Test Project',
      '',
      'A TypeScript project.',
    ].join('\n'));
  },
};

/**
 * Set up a temp project directory with the named state.
 * If VERIFY_HOOKS is set, also installs Citadel hooks and inits .planning/.
 */
function setupProjectState(state) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-bench-'));

  if (STATES[state]) {
    STATES[state](tmpDir);
  } else {
    console.warn(`  WARN: Unknown state "${state}" — using clean state`);
  }

  if (VERIFY_HOOKS) {
    try {
      execFileSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'install-hooks.js'), tmpDir], {
        encoding: 'utf8', timeout: 10000, stdio: 'pipe',
      });
      const { spawnSync } = require('child_process');
      spawnSync('node', [path.join(PLUGIN_ROOT, 'hooks_src', 'init-project.js')], {
        cwd: tmpDir,
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir, CLAUDE_PLUGIN_DATA: path.join(tmpDir, '.claude') },
        encoding: 'utf8', timeout: 10000,
      });
    } catch { /* best-effort — don't fail scenario setup */ }
  }

  return tmpDir;
}

function setupCodexProjectRuntime(tmpDir) {
  execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'codex-compat.js'), tmpDir], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60000,
  });
}

/**
 * Snapshot telemetry line counts before execution (used with --verify-hooks).
 */
function snapshotTelemetry(tmpDir) {
  const read = (rel) => {
    const full = path.join(tmpDir, rel);
    if (!fs.existsSync(full)) return 0;
    return fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).length;
  };
  return {
    timing: read('.planning/telemetry/hook-timing.jsonl'),
    audit:  read('.planning/telemetry/audit.jsonl'),
    errors: read('.planning/telemetry/hook-errors.log'),
  };
}

/**
 * Assert hooks fired by comparing telemetry before/after.
 * Returns array of hook assertion strings that failed, or empty if all pass.
 */
function assertHooksFired(tmpDir, before) {
  const after = snapshotTelemetry(tmpDir);
  const failures = [];
  if (after.timing <= before.timing) failures.push('hook-timing.jsonl did not grow (hooks may not have fired)');
  if (after.errors > before.errors)  failures.push(`${after.errors - before.errors} new hook error(s) — check hook-errors.log`);
  return failures;
}

// ── Claude CLI detection ──────────────────────────────────────────────────────

let _claudeCmd = undefined;
let _codexCmd = undefined;

function findClaudeCLI() {
  if (_claudeCmd !== undefined) return _claudeCmd;

  const candidates = ['claude', 'claude.exe', 'npx claude'];
  for (const cmd of candidates) {
    try {
      const [bin, ...binArgs] = cmd.split(' ');
      execFileSync(bin, [...binArgs, '--version'], { stdio: 'pipe', timeout: 5000 });
      _claudeCmd = cmd;
      return cmd;
    } catch { /* not found */ }
  }
  _claudeCmd = null;
  return null;
}

function findCodexCLI() {
  if (_codexCmd !== undefined) return _codexCmd;

  const candidates = [CODEX_BIN, 'codex', 'codex.exe'].filter(Boolean);
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'pipe', timeout: 5000 });
      _codexCmd = cmd;
      return cmd;
    } catch { /* not found */ }
  }
  _codexCmd = null;
  return null;
}

// ── Scenario execution ────────────────────────────────────────────────────────

/**
 * Run a scenario against the real Claude CLI.
 * Returns { output: string, error: string|null, timedOut: boolean }
 */
function executeClaudeScenario(scenario, claudeCmd, tmpDir) {
  const [bin, ...binArgs] = claudeCmd.split(' ');
  try {
    const output = execFileSync(
      bin,
      [...binArgs, '--plugin-dir', PLUGIN_ROOT, '--print', '--dangerously-skip-permissions', scenario.input],
      {
        cwd: tmpDir,
        timeout: scenario.timeout,
        encoding: 'utf8',
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: tmpDir,
          CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }
    );
    return { output, error: null, timedOut: false };
  } catch (err) {
    if (err.killed) {
      return { output: err.stdout || '', error: 'timed out', timedOut: true };
    }
    return {
      output: err.stdout || '',
      error:  err.message || 'unknown error',
      timedOut: false,
    };
  }
}

function executeCodexScenario(scenario, codexCmd, tmpDir) {
  const outputPath = path.join(tmpDir, '.planning', 'benchmark-results', `${scenario.skill}-${scenario.name}-codex.md`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const codexArgs = buildCodexExecArgs({
    projectRoot: tmpDir,
    sandbox: CODEX_SANDBOX,
    model: CODEX_MODEL,
    outputLastMessagePath: outputPath,
    prompt: scenario.input,
    json: true,
  });
  if (CODEX_SERVICE_TIER) {
    codexArgs.splice(1, 0, '-c', `service_tier="${CODEX_SERVICE_TIER}"`);
  }
  try {
    const output = execFileSync(
      codexCmd,
      codexArgs,
      {
        cwd: tmpDir,
        timeout: scenario.timeout,
        encoding: 'utf8',
        env: {
          ...process.env,
          CITADEL_RUNTIME: 'codex',
        },
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    const finalMessage = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    return { output: finalMessage || output, rawOutput: output, error: null, timedOut: false, command: ['codex', ...codexArgs].join(' ') };
  } catch (err) {
    if (err.killed) {
      return { output: err.stdout || '', error: 'timed out', timedOut: true, command: ['codex', ...codexArgs].join(' ') };
    }
    return {
      output: err.stdout || '',
      error: err.message || 'unknown error',
      timedOut: false,
      command: ['codex', ...codexArgs].join(' '),
    };
  }
}

// ── Assertion running ─────────────────────────────────────────────────────────

/**
 * Run all assertions against the captured output.
 * Returns array of { assertion, passed, type }
 */
function runAssertions(scenario, output) {
  const results = [];
  const lowerOutput = output.toLowerCase();

  for (const pattern of scenario.assertContains) {
    const passed = lowerOutput.includes(pattern.toLowerCase());
    results.push({ assertion: `contains: "${pattern}"`, passed, type: 'contains' });
  }

  for (const pattern of scenario.assertNotContains) {
    const passed = !lowerOutput.includes(pattern.toLowerCase());
    results.push({ assertion: `not-contains: "${pattern}"`, passed, type: 'not-contains' });
  }

  return results;
}

// ── Static validation ─────────────────────────────────────────────────────────

/**
 * Validate a scenario file structurally without executing it.
 */
function validateScenario(scenario) {
  const issues = [];

  if (!scenario.input) issues.push('missing input');
  if (scenario.assertContains.length === 0 && scenario.assertNotContains.length === 0) {
    issues.push('no assertions defined (add assert-contains or assert-not-contains)');
  }
  if (!STATES[scenario.state]) {
    issues.push(`unknown state "${scenario.state}" — valid: ${Object.keys(STATES).join(', ')}`);
  }

  return issues;
}

// ── Results writing ───────────────────────────────────────────────────────────

function writeResults(allResults) {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outFile = path.join(RESULTS_DIR, `bench-${date}.jsonl`);
    const lines = allResults.map(r => JSON.stringify(r));
    fs.writeFileSync(outFile, lines.join('\n') + '\n');
    return outFile;
  } catch { return null; }
}

// ── Output formatting ─────────────────────────────────────────────────────────

function printScenarioResult(scenario, result, verbose) {
  const tag = result.passed ? 'PASS' : result.skipped ? 'SKIP' : 'FAIL';
  const note = result.mode === 'static-only' ? ' [static]' : '';
  console.log(`  ${tag.padEnd(5)} ${scenario.skill}/${scenario.name}${note}`);

  if (result.skipped && scenario.skipReason) {
    console.log(`         Reason: ${scenario.skipReason}`);
  }

  if (!result.passed && !result.skipped) {
    if (result.executionError) {
      console.log(`         Execution error: ${result.executionError}`);
    }
    for (const ar of (result.assertionResults || [])) {
      if (!ar.passed) console.log(`         FAIL assertion: ${ar.assertion}`);
    }
  }

  if (result.mode === 'static-only' && result.validationIssues && result.validationIssues.length > 0) {
    for (const issue of result.validationIssues) {
      console.log(`         WARN: ${issue}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const allScenarios = discoverScenarios();

  if (allScenarios.length === 0) {
    console.log('\nNo benchmark scenarios found.');
    console.log('Add scenario files at skills/{skill-name}/__benchmarks__/{scenario}.md');
    console.log('\nSee skills/dashboard/__benchmarks__/ for examples.');
    process.exit(0);
  }

  // Apply filters
  let scenarios = allScenarios;
  if (skillFilter) {
    scenarios = scenarios.filter(s => s.skill === skillFilter || s.skill.includes(skillFilter));
    if (scenarios.length === 0) {
      console.error(`No scenarios found for skill "${skillFilter}".`);
      console.error(`Available skills with scenarios: ${[...new Set(allScenarios.map(s => s.skill))].join(', ')}`);
      process.exit(1);
    }
  }
  if (scenarioFilter) {
    scenarios = scenarios.filter(s => s.name === scenarioFilter || s.name.includes(scenarioFilter));
    if (scenarios.length === 0) {
      console.error(`No scenarios found for scenario "${scenarioFilter}".`);
      process.exit(1);
    }
  }
  if (tagFilter) {
    scenarios = scenarios.filter(s => s.tags.includes(tagFilter));
    if (scenarios.length === 0) {
      console.error(`No scenarios found with tag "${tagFilter}".`);
      process.exit(1);
    }
  }
  if (INVARIANT_ONLY) {
    scenarios = scenarios.filter(s => s.behavior === 'invariant');
    if (scenarios.length === 0) {
      console.error('No invariant-behavior scenarios found.');
      process.exit(1);
    }
  }

  // List mode
  if (LIST_MODE) {
    console.log(`\nBenchmark scenarios (${scenarios.length}):\n`);
    const bySkill = {};
    for (const s of scenarios) {
      bySkill[s.skill] = bySkill[s.skill] || [];
      bySkill[s.skill].push(s);
    }
    for (const [skill, skillScenarios] of Object.entries(bySkill)) {
      console.log(`  ${skill}/`);
      for (const s of skillScenarios) {
        const tags    = s.tags.length ? ` [${s.tags.join(', ')}]` : '';
        const bTag    = s.behavior === 'implementation' ? ' (impl)' : '';
        const skipTag = s.skipExecute
          ? ` [SKIP${s.skipReason ? ': ' + s.skipReason : ''}]`
          : '';
        console.log(`    ${s.name}${tags}${bTag}${skipTag} — ${s.description || s.input}`);
      }
    }
    process.exit(0);
  }

  // Detect the selected runtime CLI for execute mode.
  const isCodexRuntime = runtimeFilter === 'codex-exec';
  const runtimeName = isCodexRuntime ? 'codex exec' : 'claude';
  const runtimeCmd = EXECUTE_MODE
    ? (isCodexRuntime ? findCodexCLI() : findClaudeCLI())
    : null;
  const canExecute = EXECUTE_MODE && runtimeCmd !== null;

  if (EXECUTE_MODE && !runtimeCmd) {
    console.warn(`\nWARN: ${runtimeName} CLI not found in PATH - running static validation only.`);
    console.warn(`Install ${runtimeName} to enable execution testing.\n`);
  }

  const mode = canExecute ? 'execute' : 'static';
  console.log(`\nCitadel Skill Bench (${mode} mode)\n` + '='.repeat(40));
  if (mode === 'static') {
    console.log(`Validating scenario structure. Use --execute --runtime ${runtimeFilter} to run against ${runtimeName}.\n`);
  }

  const allResults = [];
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;

  for (const scenario of scenarios) {
    let result;
    let tmpDir = null;

    if (canExecute && scenario.skipExecute) {
      // skip-execute: true — scenario requires sub-agent spawning or external services
      // that can't reliably run in bench. Count as skipped (not failed).
      result = {
        scenario: scenario.name,
        skill:    scenario.skill,
        mode:     isCodexRuntime ? 'codex-exec' : 'execute',
        passed:   true,
        skipped:  true,
        assertionResults: [],
      };
    } else if (canExecute) {
      // Execute mode: set up state, run, assert
      try {
        tmpDir = setupProjectState(scenario.state);
        if (isCodexRuntime) setupCodexProjectRuntime(tmpDir);
        const telemetryBefore = VERIFY_HOOKS ? snapshotTelemetry(tmpDir) : null;
        const execResult = isCodexRuntime
          ? executeCodexScenario(scenario, runtimeCmd, tmpDir)
          : executeClaudeScenario(scenario, runtimeCmd, tmpDir);

        if (execResult.timedOut) {
          result = {
            scenario: scenario.name,
            skill:    scenario.skill,
            mode:     isCodexRuntime ? 'codex-exec' : 'execute',
            passed:   false,
            skipped:  false,
            executionError: `timed out after ${scenario.timeout}ms`,
            assertionResults: [],
          };
        } else if (execResult.error && !execResult.output) {
          result = {
            scenario: scenario.name,
            skill:    scenario.skill,
            mode:     isCodexRuntime ? 'codex-exec' : 'execute',
            passed:   false,
            skipped:  false,
            executionError: execResult.error,
            assertionResults: [],
          };
        } else {
          const assertionResults = runAssertions(scenario, execResult.output);

          // Hook telemetry assertions (--verify-hooks mode)
          if (VERIFY_HOOKS && telemetryBefore) {
            const hookFailures = assertHooksFired(tmpDir, telemetryBefore);
            for (const msg of hookFailures) {
              assertionResults.push({ assertion: `hooks: ${msg}`, passed: false, type: 'hooks' });
            }
          }

          const allPass = assertionResults.every(a => a.passed);
          result = {
            scenario: scenario.name,
            skill:    scenario.skill,
            mode:     isCodexRuntime ? 'codex-exec' : 'execute',
            passed:   allPass,
            skipped:  false,
            output:   execResult.output.slice(0, 2000), // cap stored output
            assertionResults,
          };
        }
      } catch (err) {
        result = {
          scenario: scenario.name,
          skill:    scenario.skill,
          mode:     isCodexRuntime ? 'codex-exec' : 'execute',
          passed:   false,
          skipped:  false,
          executionError: err.message,
          assertionResults: [],
        };
      } finally {
        if (tmpDir) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
        }
      }
    } else {
      // Static mode: validate scenario structure only
      const issues = validateScenario(scenario);
      result = {
        scenario:         scenario.name,
        skill:            scenario.skill,
        mode:             'static-only',
        passed:           issues.length === 0,
        skipped:          false,
        validationIssues: issues,
        assertionResults: [],
      };
    }

    result.tags        = scenario.tags;
    result.behavior    = scenario.behavior;
    result.description = scenario.description;
    result.timestamp   = new Date().toISOString();
    allResults.push(result);

    if (result.skipped)    totalSkip++;
    else if (result.passed) totalPass++;
    else                   totalFail++;

    if (!JSON_MODE) printScenarioResult(scenario, result, false);
  }

  // Summary
  if (!JSON_MODE) {
    console.log('\n' + '='.repeat(40));
    if (mode === 'static') {
      console.log(`Static validation: ${totalPass} valid, ${totalFail} invalid, ${totalSkip} skipped`);
    } else {
      console.log(`Results: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`);
    }
  }

  // Write results to disk
  const outFile = writeResults(allResults);
  if (outFile && !JSON_MODE) {
    console.log(`Results written: ${path.relative(PLUGIN_ROOT, outFile)}\n`);
  }

  if (JSON_MODE) {
    console.log(JSON.stringify(allResults, null, 2));
  } else if (totalFail > 0) {
    if (mode === 'static') {
      console.log('Fix invalid scenario files before running --execute.\n');
    } else {
      console.log('Some scenarios failed. Review output above.\n');
    }
  } else if (mode === 'static') {
    console.log(`All ${totalPass} scenario files are valid.\n`);
    if (!EXECUTE_MODE) {
      console.log('To run against a live runtime:');
      console.log('  node scripts/skill-bench.js --execute');
      console.log('  node scripts/skill-bench.js --execute --runtime codex-exec\n');
    }
  } else {
    console.log(`All ${totalPass} scenarios passed.\n`);
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

main();

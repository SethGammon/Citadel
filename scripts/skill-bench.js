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
 *   Execute (--execute): runs scenarios against the real claude CLI.
 *
 * Usage:
 *   node scripts/skill-bench.js                       # static validate all
 *   node scripts/skill-bench.js --execute             # run against claude
 *   node scripts/skill-bench.js --skill dashboard     # filter by skill name
 *   node scripts/skill-bench.js --tag fringe          # filter by tag
 *   node scripts/skill-bench.js --list                # list scenarios, no run
 *   node scripts/skill-bench.js --json                # machine-readable output
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

const PLUGIN_ROOT   = path.resolve(__dirname, '..');
const SKILLS_DIR    = path.join(PLUGIN_ROOT, 'skills');
const RESULTS_DIR   = path.join(PLUGIN_ROOT, '.planning', 'benchmark-results');

// ── CLI args ─────────────────────────────────────────────────────────────────

const args         = process.argv.slice(2);
const EXECUTE_MODE = args.includes('--execute');
const LIST_MODE    = args.includes('--list');
const JSON_MODE    = args.includes('--json');
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
const tagFilter   = getArgValue('--tag');

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
 *   assert-contains — YAML list: patterns that MUST appear in output (case-insensitive substring)
 *   assert-not-contains — YAML list: patterns that must NOT appear in output
 *   timeout         — milliseconds before giving up (default: 180000)
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
      const value = line.replace(/^\s+-\s+/, '').trim();
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
        fm[key] = val;
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
    assertContains:    Array.isArray(fm['assert-contains'])     ? fm['assert-contains']     : [],
    assertNotContains: Array.isArray(fm['assert-not-contains']) ? fm['assert-not-contains'] : [],
    timeout:          parseInt(fm.timeout, 10) || 180000,
    filePath,
    body,
  };
}

// ── Scenario discovery ────────────────────────────────────────────────────────

function discoverScenarios() {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const scenarios = [];
  const skillDirs = fs.readdirSync(SKILLS_DIR).filter(name => {
    const p = path.join(SKILLS_DIR, name);
    return fs.statSync(p).isDirectory();
  });

  for (const skillName of skillDirs) {
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
};

/**
 * Set up a temp project directory with the named state.
 */
function setupProjectState(state) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-bench-'));

  if (STATES[state]) {
    STATES[state](tmpDir);
  } else {
    console.warn(`  WARN: Unknown state "${state}" — using clean state`);
  }

  return tmpDir;
}

// ── Claude CLI detection ──────────────────────────────────────────────────────

let _claudeCmd = undefined;

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

// ── Scenario execution ────────────────────────────────────────────────────────

/**
 * Run a scenario against the real claude CLI.
 * Returns { output: string, error: string|null, timedOut: boolean }
 */
function executeScenario(scenario, claudeCmd, tmpDir) {
  const [bin, ...binArgs] = claudeCmd.split(' ');
  try {
    const output = execFileSync(
      bin,
      [...binArgs, '--print', '--dangerously-skip-permissions', scenario.input],
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
  if (tagFilter) {
    scenarios = scenarios.filter(s => s.tags.includes(tagFilter));
    if (scenarios.length === 0) {
      console.error(`No scenarios found with tag "${tagFilter}".`);
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
        const tags = s.tags.length ? ` [${s.tags.join(', ')}]` : '';
        console.log(`    ${s.name}${tags} — ${s.description || s.input}`);
      }
    }
    process.exit(0);
  }

  // Detect claude CLI for execute mode
  const claudeCmd = EXECUTE_MODE ? findClaudeCLI() : null;
  const canExecute = EXECUTE_MODE && claudeCmd !== null;

  if (EXECUTE_MODE && !claudeCmd) {
    console.warn('\nWARN: claude CLI not found in PATH — running static validation only.');
    console.warn('Install Claude Code CLI to enable execution testing.\n');
  }

  const mode = canExecute ? 'execute' : 'static';
  console.log(`\nCitadel Skill Bench (${mode} mode)\n` + '='.repeat(40));
  if (mode === 'static') {
    console.log('Validating scenario structure. Use --execute to run against claude CLI.\n');
  }

  const allResults = [];
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;

  for (const scenario of scenarios) {
    let result;
    let tmpDir = null;

    if (canExecute) {
      // Execute mode: set up state, run, assert
      try {
        tmpDir = setupProjectState(scenario.state);
        const execResult = executeScenario(scenario, claudeCmd, tmpDir);

        if (execResult.timedOut) {
          result = {
            scenario: scenario.name,
            skill:    scenario.skill,
            mode:     'execute',
            passed:   false,
            skipped:  false,
            executionError: `timed out after ${scenario.timeout}ms`,
            assertionResults: [],
          };
        } else if (execResult.error && !execResult.output) {
          result = {
            scenario: scenario.name,
            skill:    scenario.skill,
            mode:     'execute',
            passed:   false,
            skipped:  false,
            executionError: execResult.error,
            assertionResults: [],
          };
        } else {
          const assertionResults = runAssertions(scenario, execResult.output);
          const allPass = assertionResults.every(a => a.passed);
          result = {
            scenario: scenario.name,
            skill:    scenario.skill,
            mode:     'execute',
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
          mode:     'execute',
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
      console.log('To run against the live claude CLI:');
      console.log('  node scripts/skill-bench.js --execute\n');
    }
  } else {
    console.log(`All ${totalPass} scenarios passed.\n`);
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

main();

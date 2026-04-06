#!/usr/bin/env node

/**
 * run-all.js -- Codex compatibility test runner.
 *
 * Runs all COMPAT-* tests and reports results.
 *
 * Usage:
 *   node scripts/compat-tests/run-all.js           # offline tests only
 *   node scripts/compat-tests/run-all.js --live     # include tests requiring live Codex session
 *   node scripts/compat-tests/run-all.js --json     # machine-readable output
 *
 * Exit codes:
 *   0 = all tests pass
 *   1 = one or more tests fail
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const LIVE_MODE = args.includes('--live');
const JSON_MODE = args.includes('--json');

// Test registry: each entry is { id, name, file, requiresLive }
const TESTS = [
  { id: 'COMPAT-01', name: 'Skill discovery',            file: 'compat-01-skill-discovery.js',      requiresLive: true },
  { id: 'COMPAT-02', name: 'Project guidance merge',     file: 'compat-02-guidance-merge.js',       requiresLive: true },
  { id: 'COMPAT-03', name: 'Hook translation',           file: 'compat-03-hook-translation.js',     requiresLive: true },
  { id: 'COMPAT-04', name: 'Hook adapter input',         file: 'compat-04-hook-adapter.js',         requiresLive: false },
  { id: 'COMPAT-05', name: 'MCP config translation',     file: 'compat-05-mcp-translation.js',      requiresLive: false },
  { id: 'COMPAT-06', name: 'Plugin manifest validity',   file: 'compat-06-plugin-manifest.js',      requiresLive: true },
  { id: 'COMPAT-07', name: 'Agent definition translation',file: 'compat-07-agent-translation.js',   requiresLive: false },
  { id: 'COMPAT-08', name: 'Worktree adapter',           file: 'compat-08-worktree-adapter.js',     requiresLive: true },
  { id: 'COMPAT-09', name: 'Multi-agent collision',      file: 'compat-09-collision.js',            requiresLive: true },
  { id: 'COMPAT-10', name: 'Campaign state portability', file: 'compat-10-campaign-portability.js', requiresLive: false },
  { id: 'COMPAT-11', name: 'Telemetry portability',      file: 'compat-11-telemetry-portability.js',requiresLive: false },
  { id: 'COMPAT-12', name: 'Windows degraded mode',      file: 'compat-12-windows-degraded.js',     requiresLive: true },
  { id: 'COMPAT-13', name: 'Plugin package smoke',       file: 'compat-13-plugin-smoke.js',         requiresLive: true },
  { id: 'COMPAT-14', name: 'Runtime detection',          file: 'compat-14-runtime-detection.js',    requiresLive: false },
  { id: 'COMPAT-15', name: 'Config generation',          file: 'compat-15-config-generation.js',    requiresLive: false },
  { id: 'COMPAT-16', name: 'Size limit guard',           file: 'compat-16-size-limit.js',           requiresLive: false },
];

async function runTest(test) {
  if (test.requiresLive && !LIVE_MODE) {
    return { ...test, status: 'skipped', message: 'Requires --live flag' };
  }

  const testPath = path.join(__dirname, test.file);
  if (!fs.existsSync(testPath)) {
    return { ...test, status: 'skipped', message: 'Test file not yet implemented' };
  }

  try {
    const mod = require(testPath);
    const result = await mod.run();
    return {
      ...test,
      status: result.pass ? 'pass' : 'fail',
      message: result.message,
    };
  } catch (err) {
    return {
      ...test,
      status: 'error',
      message: err.message,
    };
  }
}

async function main() {
  const results = [];

  for (const test of TESTS) {
    const result = await runTest(test);
    results.push(result);

    if (!JSON_MODE) {
      const icon = result.status === 'pass' ? 'PASS'
        : result.status === 'fail' ? 'FAIL'
        : result.status === 'skipped' ? 'SKIP'
        : 'ERR ';
      console.log(`  [${icon}] ${result.id}: ${result.name} -- ${result.message}`);
    }
  }

  const passed  = results.filter(r => r.status === 'pass').length;
  const failed  = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors  = results.filter(r => r.status === 'error').length;

  if (JSON_MODE) {
    console.log(JSON.stringify({ results, summary: { passed, failed, skipped, errors } }, null, 2));
  } else {
    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${errors} errors`);
    if (!LIVE_MODE && skipped > 0) {
      console.log('Run with --live to include tests requiring a Codex session.');
    }
  }

  process.exit(failed > 0 || errors > 0 ? 1 : 0);
}

main();

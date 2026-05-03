#!/usr/bin/env node

/**
 * test-all.js - Full fast test suite for Citadel
 *
 * Runs both hook smoke tests and skill lint checks in sequence.
 * Fast (no network, no LLM calls). Suitable for CI and pre-commit.
 *
 * For execution-based scenario testing (requires claude CLI):
 *   node scripts/skill-bench.js --execute
 *
 * Usage:
 *   node scripts/test-all.js           # hooks + skills
 *   node scripts/test-all.js --strict  # treat skill WARNs as failures
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SMOKE_TEST = path.join(PLUGIN_ROOT, 'hooks_src', 'smoke-test.js');
const SKILL_LINT = path.join(PLUGIN_ROOT, 'scripts', 'skill-lint.js');
const DEMO_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-demo.js');
const SECURITY_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-security.js');
const RUNTIME_CONTRACT_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-runtime-contracts.js');
const HOOK_EVENT_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-hook-events.js');
const RUNTIME_REGISTRY_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-runtime-registry.js');
const TELEMETRY_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-telemetry-core.js');
const COORDINATION_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-coordination-core.js');
const HOOK_INSTALLER_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-hook-installers.js');
const CAMPAIGN_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-campaign-core.js');
const DISCOVERY_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-discovery-core.js');
const DISCOVERY_WRITER_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-discovery-writer.js');
const MOMENTUM_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-momentum-synthesizer.js');
const MOMENTUM_WATCHER_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-momentum-watcher.js');
const POLICY_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-policy-core.js');
const CLAUDE_RUNTIME_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-claude-runtime.js');
const CODEX_RUNTIME_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-codex-runtime.js');
const PROJECT_BOOTSTRAP_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-project-bootstrap.js');
const COMPAT_FIXTURE_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-compat-fixtures.js');
const BACKWARD_COMPAT_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-backward-compat.js');
const COST_TRACKER_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-cost-tracker.js');

const STRICT = process.argv.includes('--strict');

console.log('\nCitadel Full Test Suite\n' + '='.repeat(40));
console.log('Running: hook smoke test + security tests + runtime contract test + runtime registry test + hook event test + skill lint + demo routing check + telemetry core check + coordination core check + hook installer check + campaign core check + discovery core check + discovery writer check + momentum synthesizer check + policy core check + Claude runtime check + Codex runtime check + project bootstrap check + compat fixtures + backward compat + cost tracker\n');

function run(label, scriptPath, extraArgs = []) {
  console.log(`\n> ${label}`);
  console.log('-'.repeat(40));

  try {
    execFileSync(process.execPath, [scriptPath, ...extraArgs], {
      cwd: PLUGIN_ROOT,
      stdio: 'inherit',
      encoding: 'utf8',
    });
    return true;
  } catch (_err) {
    return false;
  }
}

const hooksPassed = run('Hook Smoke Test', SMOKE_TEST);
const securityPassed = run('Security Tests', SECURITY_TEST);
const contractsPassed = run('Runtime Contract Tests', RUNTIME_CONTRACT_TEST);
const runtimeRegistryPassed = run('Runtime Registry Tests', RUNTIME_REGISTRY_TEST);
const hookEventsPassed = run('Hook Event Tests', HOOK_EVENT_TEST);
const lintArgs = STRICT ? ['--warn-as-fail'] : [];
const skillsPassed = run('Skill Lint', SKILL_LINT, lintArgs);
const demoPassed = run('Demo Routing Check', DEMO_TEST);
const telemetryPassed = run('Telemetry Core Check', TELEMETRY_TEST);
const coordinationPassed = run('Coordination Core Check', COORDINATION_TEST);
const hookInstallerPassed = run('Hook Installer Check', HOOK_INSTALLER_TEST);
const campaignPassed = run('Campaign Core Check', CAMPAIGN_TEST);
const discoveryPassed = run('Discovery Core Check', DISCOVERY_TEST);
const discoveryWriterPassed = run('Discovery Writer Check', DISCOVERY_WRITER_TEST);
const momentumPassed = run('Momentum Synthesizer Check', MOMENTUM_TEST);
const momentumWatcherPassed = run('Momentum Watcher Check', MOMENTUM_WATCHER_TEST);
const policyPassed = run('Policy Core Check', POLICY_TEST);
const claudeRuntimePassed = run('Claude Runtime Check', CLAUDE_RUNTIME_TEST);
const codexRuntimePassed = run('Codex Runtime Check', CODEX_RUNTIME_TEST);
const projectBootstrapPassed = run('Project Bootstrap Check', PROJECT_BOOTSTRAP_TEST);
const compatFixturePassed = STRICT ? run('Compatibility Fixtures', COMPAT_FIXTURE_TEST) : true;
const backwardCompatPassed = run('Backward Compatibility', BACKWARD_COMPAT_TEST);
const costTrackerPassed = run('Cost Tracker Tests', COST_TRACKER_TEST);

console.log('\n' + '='.repeat(40));
console.log('SUMMARY');
console.log(`  Hook smoke test:    ${hooksPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Security tests:     ${securityPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Runtime contracts:  ${contractsPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Runtime registry:   ${runtimeRegistryPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Hook events:        ${hookEventsPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Skill lint:         ${skillsPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Demo routing check: ${demoPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Telemetry core:     ${telemetryPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Coordination core:  ${coordinationPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Hook installers:    ${hookInstallerPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Campaign core:      ${campaignPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Discovery core:     ${discoveryPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Discovery writer:   ${discoveryWriterPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Momentum synth:     ${momentumPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Momentum watcher:   ${momentumWatcherPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Policy core:        ${policyPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Claude runtime:     ${claudeRuntimePassed ? 'PASS' : 'FAIL'}`);
console.log(`  Codex runtime:      ${codexRuntimePassed ? 'PASS' : 'FAIL'}`);
console.log(`  Project bootstrap:  ${projectBootstrapPassed ? 'PASS' : 'FAIL'}`);
if (STRICT) console.log(`  Compat fixtures:    ${compatFixturePassed ? 'PASS' : 'FAIL'}`);
console.log(`  Backward compat:    ${backwardCompatPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Cost tracker:       ${costTrackerPassed ? 'PASS' : 'FAIL'}`);
console.log('');

if (hooksPassed && securityPassed && contractsPassed && runtimeRegistryPassed && hookEventsPassed && skillsPassed && demoPassed && telemetryPassed && coordinationPassed && hookInstallerPassed && campaignPassed && discoveryPassed && discoveryWriterPassed && momentumPassed && momentumWatcherPassed && policyPassed && claudeRuntimePassed && codexRuntimePassed && projectBootstrapPassed && compatFixturePassed && backwardCompatPassed && costTrackerPassed) {
  console.log('All tests pass.\n');
  console.log('Next steps:');
  console.log('  node scripts/skill-bench.js --list      see benchmark scenarios');
  console.log('  node scripts/skill-bench.js             validate scenario files');
  console.log('  node scripts/skill-bench.js --execute   run against claude CLI\n');
  process.exit(0);
}

const hookFail = !hooksPassed ? 1 : 0;
const securityFail = !securityPassed ? 2 : 0;
const contractFail = !contractsPassed ? 4 : 0;
const runtimeRegistryFail = !runtimeRegistryPassed ? 8 : 0;
const hookEventFail = !hookEventsPassed ? 16 : 0;
const skillFail = !skillsPassed ? 32 : 0;
const demoFail = !demoPassed ? 64 : 0;
const telemetryFail = !telemetryPassed ? 128 : 0;
const coordinationFail = !coordinationPassed ? 256 : 0;
const hookInstallerFail = !hookInstallerPassed ? 512 : 0;
const campaignFail = !campaignPassed ? 1024 : 0;
const discoveryFail = !discoveryPassed ? 2048 : 0;
const discoveryWriterFail = !discoveryWriterPassed ? 4096 : 0;
const momentumFail = !momentumPassed ? 8192 : 0;
const momentumWatcherFail = !momentumWatcherPassed ? 16384 : 0;
const policyFail = !policyPassed ? 32768 : 0;
const claudeRuntimeFail = !claudeRuntimePassed ? 65536 : 0;
const codexRuntimeFail = !codexRuntimePassed ? 131072 : 0;
const projectBootstrapFail = !projectBootstrapPassed ? 262144 : 0;
const compatFixtureFail = !compatFixturePassed ? 524288 : 0;
const backwardCompatFail = !backwardCompatPassed ? 1048576 : 0;
const costTrackerFail = !costTrackerPassed ? 2097152 : 0;
const code = hookFail | securityFail | contractFail | runtimeRegistryFail | hookEventFail | skillFail | demoFail | telemetryFail | coordinationFail | hookInstallerFail | campaignFail | discoveryFail | discoveryWriterFail | momentumFail | momentumWatcherFail | policyFail | claudeRuntimeFail | codexRuntimeFail | projectBootstrapFail | compatFixtureFail | backwardCompatFail | costTrackerFail;

if (!hooksPassed) console.log('Hook smoke test failed. Fix hook issues before proceeding.');
if (!securityPassed) console.log('Security tests failed. DO NOT SHIP - critical vulnerabilities present.');
if (!contractsPassed) console.log('Runtime contract tests failed. Fix the contract skeleton before proceeding.');
if (!runtimeRegistryPassed) console.log('Runtime registry tests failed. Fix runtime metadata and detection before proceeding.');
if (!hookEventsPassed) console.log('Hook event tests failed. Fix event normalization before proceeding.');
if (!skillsPassed) console.log('Skill lint failed. Fix FAIL-level issues before shipping.');
if (!demoPassed) console.log('Demo routing check failed. Fix routing bugs in docs/index.html before shipping.');
if (!telemetryPassed) console.log('Telemetry core check failed. Fix telemetry regressions before shipping.');
if (!coordinationPassed) console.log('Coordination core check failed. Fix coordination regressions before shipping.');
if (!hookInstallerPassed) console.log('Hook installer check failed. Fix runtime installer regressions before shipping.');
if (!campaignPassed) console.log('Campaign core check failed. Fix campaign regressions before shipping.');
if (!discoveryPassed) console.log('Discovery core check failed. Fix discovery relay regressions before shipping.');
if (!discoveryWriterPassed) console.log('Discovery writer check failed. Fix discovery-writer regressions before shipping.');
if (!momentumPassed) console.log('Momentum synthesizer check failed. Fix momentum synthesizer before shipping.');
if (!momentumWatcherPassed) console.log('Momentum watcher check failed. Fix momentum watcher before shipping.');
if (!policyPassed) console.log('Policy core check failed. Fix policy regressions before shipping.');
if (!claudeRuntimePassed) console.log('Claude runtime check failed. Fix runtime adapter regressions before shipping.');
if (!codexRuntimePassed) console.log('Codex runtime check failed. Fix runtime adapter regressions before shipping.');
if (!projectBootstrapPassed) console.log('Project bootstrap check failed. Fix canonical guidance bootstrap before shipping.');
if (!compatFixturePassed) console.log('Compatibility fixture check failed. Run: node scripts/generate-fixtures.js --write');
if (!backwardCompatPassed) console.log('Backward compatibility check failed. Legacy data formats may be broken.');
if (!costTrackerPassed) console.log('Cost tracker tests failed. Fix cost-tracker.js behavior before shipping.');
console.log('');
process.exit(code);

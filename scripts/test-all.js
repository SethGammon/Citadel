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
const RUNTIME_MATRIX_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-runtime-matrix.js');
const TELEMETRY_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-telemetry-core.js');
const TELEMETRY_INTEGRITY_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-telemetry-integrity.js');
const MEMORY_BLOCK_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-memory-blocks.js');
const EVIDENCE_CONTRACT_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-evidence-contracts.js');
const SANDBOX_PROVIDER_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-sandbox-provider.js');
const SKILL_PACKAGING_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-skill-packaging.js');
const MAP_SUBSTRATE_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-map-substrate.js');
const DELIVERY_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-deliver.js');
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
const CODEX_NATIVE_INTEGRATION_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-codex-native-integrations.js');
const CODEX_OPERATIONAL_IMPROVEMENT_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-codex-operational-improvements.js');
const INSTALLER_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-installers.js');
const PROJECT_BOOTSTRAP_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-project-bootstrap.js');
const COMPAT_FIXTURE_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-compat-fixtures.js');
const BACKWARD_COMPAT_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-backward-compat.js');
const COST_TRACKER_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-cost-tracker.js');
const DASHBOARD_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-dashboard.js');
const FLEET_SESSION_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-fleet-session.js');
const WORKTREE_READINESS_TEST = path.join(PLUGIN_ROOT, 'scripts', 'test-worktree-readiness.js');

const STRICT = process.argv.includes('--strict');

console.log('\nCitadel Full Test Suite\n' + '='.repeat(40));
console.log('Running: hook smoke test + security tests + runtime contract test + runtime registry test + runtime matrix test + hook event test + skill lint + demo routing check + telemetry core check + telemetry integrity check + memory block check + evidence contract check + sandbox provider check + skill packaging check + map substrate check + delivery preflight check + coordination core check + hook installer check + campaign core check + discovery core check + discovery writer check + momentum synthesizer check + policy core check + Claude runtime check + Codex runtime check + Codex native integration check + Codex operational improvement check + installer check + project bootstrap check + compat fixtures + backward compat + cost tracker + dashboard + fleet session + worktree readiness\n');

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
const runtimeMatrixPassed = run('Runtime Matrix Tests', RUNTIME_MATRIX_TEST);
const hookEventsPassed = run('Hook Event Tests', HOOK_EVENT_TEST);
const lintArgs = STRICT ? ['--warn-as-fail'] : [];
const skillsPassed = run('Skill Lint', SKILL_LINT, lintArgs);
const demoPassed = run('Demo Routing Check', DEMO_TEST);
const telemetryPassed = run('Telemetry Core Check', TELEMETRY_TEST);
const telemetryIntegrityPassed = run('Telemetry Integrity Check', TELEMETRY_INTEGRITY_TEST);
const memoryBlockPassed = run('Memory Block Check', MEMORY_BLOCK_TEST);
const evidenceContractPassed = run('Evidence Contract Check', EVIDENCE_CONTRACT_TEST);
const sandboxProviderPassed = run('Sandbox Provider Check', SANDBOX_PROVIDER_TEST);
const skillPackagingPassed = run('Skill Packaging Check', SKILL_PACKAGING_TEST);
const mapSubstratePassed = run('Map Substrate Check', MAP_SUBSTRATE_TEST);
const deliveryPassed = run('Delivery Preflight Check', DELIVERY_TEST);
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
const codexNativeIntegrationPassed = run('Codex Native Integration Check', CODEX_NATIVE_INTEGRATION_TEST);
const codexOperationalImprovementPassed = run('Codex Operational Improvement Check', CODEX_OPERATIONAL_IMPROVEMENT_TEST);
const installerPassed = run('Installer Check', INSTALLER_TEST);
const projectBootstrapPassed = run('Project Bootstrap Check', PROJECT_BOOTSTRAP_TEST);
const compatFixturePassed = STRICT ? run('Compatibility Fixtures', COMPAT_FIXTURE_TEST) : true;
const backwardCompatPassed = run('Backward Compatibility', BACKWARD_COMPAT_TEST);
const costTrackerPassed = run('Cost Tracker Tests', COST_TRACKER_TEST);
const dashboardPassed = run('Dashboard Tests', DASHBOARD_TEST);
const fleetSessionPassed = run('Fleet Session Tests', FLEET_SESSION_TEST);
const worktreeReadinessPassed = run('Worktree Readiness Tests', WORKTREE_READINESS_TEST);

console.log('\n' + '='.repeat(40));
console.log('SUMMARY');
console.log(`  Hook smoke test:    ${hooksPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Security tests:     ${securityPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Runtime contracts:  ${contractsPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Runtime registry:   ${runtimeRegistryPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Runtime matrix:     ${runtimeMatrixPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Hook events:        ${hookEventsPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Skill lint:         ${skillsPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Demo routing check: ${demoPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Telemetry core:     ${telemetryPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Telemetry integrity: ${telemetryIntegrityPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Memory blocks:      ${memoryBlockPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Evidence contracts: ${evidenceContractPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Sandbox provider:   ${sandboxProviderPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Skill packaging:    ${skillPackagingPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Map substrate:      ${mapSubstratePassed ? 'PASS' : 'FAIL'}`);
console.log(`  Delivery preflight: ${deliveryPassed ? 'PASS' : 'FAIL'}`);
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
console.log(`  Codex native:       ${codexNativeIntegrationPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Codex operational:  ${codexOperationalImprovementPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Installers:         ${installerPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Project bootstrap:  ${projectBootstrapPassed ? 'PASS' : 'FAIL'}`);
if (STRICT) console.log(`  Compat fixtures:    ${compatFixturePassed ? 'PASS' : 'FAIL'}`);
console.log(`  Backward compat:    ${backwardCompatPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Cost tracker:       ${costTrackerPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Dashboard:          ${dashboardPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Fleet session:      ${fleetSessionPassed ? 'PASS' : 'FAIL'}`);
console.log(`  Worktree readiness: ${worktreeReadinessPassed ? 'PASS' : 'FAIL'}`);
console.log('');

if (hooksPassed && securityPassed && contractsPassed && runtimeRegistryPassed && runtimeMatrixPassed && hookEventsPassed && skillsPassed && demoPassed && telemetryPassed && telemetryIntegrityPassed && memoryBlockPassed && evidenceContractPassed && sandboxProviderPassed && skillPackagingPassed && mapSubstratePassed && deliveryPassed && coordinationPassed && hookInstallerPassed && campaignPassed && discoveryPassed && discoveryWriterPassed && momentumPassed && momentumWatcherPassed && policyPassed && claudeRuntimePassed && codexRuntimePassed && codexNativeIntegrationPassed && codexOperationalImprovementPassed && installerPassed && projectBootstrapPassed && compatFixturePassed && backwardCompatPassed && costTrackerPassed && dashboardPassed && fleetSessionPassed && worktreeReadinessPassed) {
  console.log('All tests pass.\n');
  console.log('Next steps:');
  console.log('  node scripts/skill-bench.js --list      see benchmark scenarios');
  console.log('  node scripts/skill-bench.js             validate scenario files');
  console.log('  node scripts/skill-bench.js --execute   run against Claude CLI');
  console.log('  node scripts/skill-bench.js --execute --runtime codex-exec   run against Codex exec\n');
  process.exit(0);
}

const hookFail = !hooksPassed ? 1 : 0;
const securityFail = !securityPassed ? 2 : 0;
const contractFail = !contractsPassed ? 4 : 0;
const runtimeRegistryFail = !runtimeRegistryPassed ? 8 : 0;
const runtimeMatrixFail = !runtimeMatrixPassed ? 8 : 0;
const hookEventFail = !hookEventsPassed ? 16 : 0;
const skillFail = !skillsPassed ? 32 : 0;
const demoFail = !demoPassed ? 64 : 0;
const telemetryFail = !telemetryPassed ? 128 : 0;
const telemetryIntegrityFail = !telemetryIntegrityPassed ? 268435456 : 0;
const memoryBlockFail = !memoryBlockPassed ? 536870912 : 0;
const evidenceContractFail = !evidenceContractPassed ? 1073741824 : 0;
const sandboxProviderFail = !sandboxProviderPassed ? 2 : 0;
const skillPackagingFail = !skillPackagingPassed ? 4 : 0;
const mapSubstrateFail = !mapSubstratePassed ? 8 : 0;
const deliveryFail = !deliveryPassed ? 16 : 0;
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
const codexNativeIntegrationFail = !codexNativeIntegrationPassed ? 262144 : 0;
const codexOperationalImprovementFail = !codexOperationalImprovementPassed ? 524288 : 0;
const installerFail = !installerPassed ? 1048576 : 0;
const projectBootstrapFail = !projectBootstrapPassed ? 2097152 : 0;
const compatFixtureFail = !compatFixturePassed ? 4194304 : 0;
const backwardCompatFail = !backwardCompatPassed ? 8388608 : 0;
const costTrackerFail = !costTrackerPassed ? 16777216 : 0;
const dashboardFail = !dashboardPassed ? 33554432 : 0;
const fleetSessionFail = !fleetSessionPassed ? 67108864 : 0;
const worktreeReadinessFail = !worktreeReadinessPassed ? 134217728 : 0;
const code = hookFail | securityFail | contractFail | runtimeRegistryFail | runtimeMatrixFail | hookEventFail | skillFail | demoFail | telemetryFail | telemetryIntegrityFail | memoryBlockFail | evidenceContractFail | sandboxProviderFail | skillPackagingFail | mapSubstrateFail | deliveryFail | coordinationFail | hookInstallerFail | campaignFail | discoveryFail | discoveryWriterFail | momentumFail | momentumWatcherFail | policyFail | claudeRuntimeFail | codexRuntimeFail | codexNativeIntegrationFail | codexOperationalImprovementFail | installerFail | projectBootstrapFail | compatFixtureFail | backwardCompatFail | costTrackerFail | dashboardFail | fleetSessionFail | worktreeReadinessFail;

if (!hooksPassed) console.log('Hook smoke test failed. Fix hook issues before proceeding.');
if (!securityPassed) console.log('Security tests failed. DO NOT SHIP - critical vulnerabilities present.');
if (!contractsPassed) console.log('Runtime contract tests failed. Fix the contract skeleton before proceeding.');
if (!runtimeRegistryPassed) console.log('Runtime registry tests failed. Fix runtime metadata and detection before proceeding.');
if (!runtimeMatrixPassed) console.log('Runtime matrix tests failed. Fix adapter levels or runtime tradeoff metadata before proceeding.');
if (!hookEventsPassed) console.log('Hook event tests failed. Fix event normalization before proceeding.');
if (!skillsPassed) console.log('Skill lint failed. Fix FAIL-level issues before shipping.');
if (!demoPassed) console.log('Demo routing check failed. Fix routing bugs in docs/index.html before shipping.');
if (!telemetryPassed) console.log('Telemetry core check failed. Fix telemetry regressions before shipping.');
if (!telemetryIntegrityPassed) console.log('Telemetry integrity check failed. Fix hashing, IDs, signing, or verifier behavior before shipping.');
if (!memoryBlockPassed) console.log('Memory block check failed. Fix memory compilation, source linting, or scoped load behavior before shipping.');
if (!evidenceContractPassed) console.log('Evidence contract check failed. Fix exit evidence parsing, validation, or repair task behavior before shipping.');
if (!sandboxProviderPassed) console.log('Sandbox provider check failed. Fix provider capabilities, worktree status, or unsupported-provider errors before shipping.');
if (!skillPackagingPassed) console.log('Skill packaging check failed. Fix metadata, catalog, or scaffold behavior before shipping.');
if (!mapSubstratePassed) console.log('Map substrate check failed. Fix map generation, scoped slices, or stale detection before shipping.');
if (!deliveryPassed) console.log('Delivery preflight check failed. Fix intake parsing, campaign scaffolding, or delivery evidence contracts before shipping.');
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
if (!codexNativeIntegrationPassed) console.log('Codex native integration check failed. Fix Codex bridge scripts, MCP, plugin, or docs before shipping.');
if (!codexOperationalImprovementPassed) console.log('Codex operational improvement check failed. Fix readiness, review ingestion, artifacts, or app-server event summarization before shipping.');
if (!installerPassed) console.log('Installer check failed. Fix Claude/Codex installer regressions before shipping.');
if (!projectBootstrapPassed) console.log('Project bootstrap check failed. Fix canonical guidance bootstrap before shipping.');
if (!compatFixturePassed) console.log('Compatibility fixture check failed. Run: node scripts/generate-fixtures.js --write');
if (!backwardCompatPassed) console.log('Backward compatibility check failed. Legacy data formats may be broken.');
if (!costTrackerPassed) console.log('Cost tracker tests failed. Fix cost-tracker.js behavior before shipping.');
if (!dashboardPassed) console.log('Dashboard tests failed. Fix dashboard rendering before shipping.');
if (!fleetSessionPassed) console.log('Fleet session tests failed. Fix Fleet work queue parsing or steward behavior before shipping.');
if (!worktreeReadinessPassed) console.log('Worktree readiness tests failed. Fix readiness profile checks before shipping.');
console.log('');
process.exit(code);

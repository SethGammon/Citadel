#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const compiler = require('../core/operations/compiler');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'workflows', 'verify-change.citadel.json');
const GOLDEN = path.join(ROOT, 'scripts', 'fixtures', 'workflow-compiler');
const workflow = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const targets = ['local', 'codex', 'github-actions'];
const suffix = { local: 'local.json', codex: 'codex.json', 'github-actions': 'github.yml' };

assert.deepEqual(compiler.validateWorkflow(workflow), []);

const compiled = Object.fromEntries(targets.map((target) => [target, compiler.compileWorkflow(workflow, target)]));
for (const target of targets) {
  const first = compiled[target];
  const second = compiler.compileWorkflow(JSON.parse(JSON.stringify(workflow)), target);
  assert.equal(first.content, second.content, `${target} output must be deterministic`);
  assert.deepEqual(first.core_contract, second.core_contract);
  assert.equal(first.semantic_proof.status, 'passed');
  assert(first.semantic_proof.checks.includes('argv_digest'));
  assert.deepEqual(first.semantic_proof.evidence_mapping, {
    states: ['passed', 'failed', 'blocked', 'unknown'], required_status: 'passed', missing_status: 'unknown',
  });
  assert.deepEqual(first.semantic_proof.outcome_mapping, {
    success: 'passed', failure: 'failed', cancellation: 'unknown',
  });
  assert.deepEqual(first.semantic_proof.receipt_mapping, {
    path: '.planning/receipts/verify-change.json', required_for_pass: true, missing_status: 'unknown',
  });
  assert.equal(first.content, fs.readFileSync(path.join(GOLDEN, `verify-change.${suffix[target]}`), 'utf8'), `${target} golden drift`);
}

assert.deepEqual(compiled.local.core_contract, compiled.codex.core_contract);
assert.deepEqual(compiled.local.core_contract, compiled['github-actions'].core_contract);
assert.deepEqual(compiled.local.core_contract.step_ids, workflow.steps.map((step) => step.id));
assert.equal(compiled.local.core_contract.verifier.step_id, 'run-verifier');
assert.deepEqual(compiled.local.core_contract.evidence_states, ['passed', 'failed', 'blocked', 'unknown']);
assert.equal(compiled.local.core_contract.failure_status, 'failed');
assert.equal(compiled.local.core_contract.cancellation_status, 'unknown');
assert.equal(compiled.local.core_contract.receipt_path, '.planning/receipts/verify-change.json');

const withUnsupported = { ...workflow, required_capabilities: [...workflow.required_capabilities, 'approvals'] };
assert.throws(() => compiler.compileWorkflow(withUnsupported, 'local'), /does not support: approvals/);
assert.throws(() => compiler.compileWorkflow(workflow, 'future-runtime'), /Unknown workflow target/);

assert.match(compiler.validateWorkflow({ ...workflow, prompt: 'fork this behavior' }).join('; '), /fields must exactly match/);
assert.match(compiler.validateWorkflow({ ...workflow, operation: { ...workflow.operation, step_ids: ['run-verifier', 'inspect-change'] } }).join('; '), /must exactly match/);
assert.match(compiler.validateWorkflow({ ...workflow, receipt: { ...workflow.receipt, path: '../../receipt.json' } }).join('; '), /contained path/);
assert.match(compiler.validateWorkflow({ ...workflow, receipt: { ...workflow.receipt,
  path: '.planning/receipts/${{ secrets.PWN }}.json' } }).join('; '), /contained path/);
assert.match(compiler.validateWorkflow({ ...workflow, steps: [{ ...workflow.steps[0], argv: [] }, workflow.steps[1]] }).join('; '), /argv/);
assert.match(compiler.validateWorkflow({ ...workflow, operation: { ...workflow.operation,
  operation_id: 'verify:change' } }).join('; '), /artifact paths/);

assert(!JSON.stringify(workflow).toLowerCase().includes('prompt'), 'canonical workflow must not contain a prompt');
for (const result of Object.values(compiled)) {
  assert(!result.content.toLowerCase().includes('prompt'), `${result.target} must not fork behavior through a prompt`);
  assert.equal(result.core_contract.step_commands_digest, compiled.local.core_contract.step_commands_digest);
}

const github = compiled['github-actions'].content;
assert.match(github, /permissions:\n  contents: read/);
assert.doesNotMatch(github, /contents: write|pull-requests: write|actions: write/);
assert.match(github, /CITADEL_CANCELLATION_STATUS: "unknown"/);
assert.match(github, /CITADEL_RECEIPT_PATH: "\.planning\/receipts\/verify-change\.json"/);
assert.match(github, /id: citadel-semantic-contract/);
assert.match(github, /CITADEL_ARGV_B64:/);
assert.doesNotMatch(github, /run: git diff|run: npm test/);
const guardCode = JSON.parse(github.match(/id: citadel-semantic-contract[\s\S]*?run: node -e ("[^"\r\n]*")/)[1]);
const semanticB64 = JSON.parse(github.match(/^\s+CITADEL_SEMANTIC_CONTRACT_B64: ("[^"\r\n]*")$/m)[1]);
const guardPass = spawnSync(process.execPath, ['-e', guardCode], {
  encoding: 'utf8', shell: false, env: { ...process.env, CITADEL_SEMANTIC_CONTRACT_B64: semanticB64 },
});
assert.equal(guardPass.status, 0, guardPass.stderr);
const badSemantics = JSON.parse(Buffer.from(semanticB64, 'base64').toString('utf8'));
badSemantics.outcomes.failure = 'passed';
const guardFail = spawnSync(process.execPath, ['-e', guardCode], {
  encoding: 'utf8', shell: false,
  env: { ...process.env, CITADEL_SEMANTIC_CONTRACT_B64: Buffer.from(JSON.stringify(badSemantics)).toString('base64') },
});
assert.notEqual(guardFail.status, 0, 'executable semantic guard must reject a dishonest failure mapping');

const malicious = JSON.parse(JSON.stringify(workflow));
malicious.operation.title = '${{ secrets.PWN }}: injected';
malicious.steps[0].name = '${{ github.token }}: injected';
malicious.steps[0].argv = [
  'node', '-e', "require('fs').writeFileSync('/tmp/citadel-pwn','x')", '$(touch /tmp/citadel-shell-pwn)',
];
const maliciousGithub = compiler.compileWorkflow(malicious, 'github-actions');
assert.equal(maliciousGithub.semantic_proof.status, 'passed');
assert.doesNotMatch(maliciousGithub.content, /\$\{\{|citadel-pwn|citadel-shell-pwn|github\.token|secrets\.PWN/);
assert.match(maliciousGithub.content, /shell:false/);

const localMappingTamper = compiled.local.content.replace(/"failure": "failed"/g, '"failure": "passed"');
assert.throws(() => compiler.verifyCompiledArtifact(workflow, 'local', localMappingTamper), /outcome_mapping|semantic_contract/);
const githubMappingTamper = github.replace('CITADEL_FAILURE_STATUS: "failed"', 'CITADEL_FAILURE_STATUS: "passed"');
assert.throws(() => compiler.verifyCompiledArtifact(workflow, 'github-actions', githubMappingTamper), /outcome_mapping|semantic_contract/);
const githubRunnerTamper = github.replace('shell:false', 'shell:true');
assert.throws(() => compiler.verifyCompiledArtifact(workflow, 'github-actions', githubRunnerTamper), /step runner was modified/);

const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'compile-workflow.js'), '--input', SOURCE, '--target', 'local'], {
  cwd: ROOT, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
});
assert.equal(cli.status, 0, cli.stderr);
assert.equal(cli.stdout, compiled.local.content);

process.stdout.write('Workflow compiler tests passed: 3 targets with artifact-derived semantic proof and injection resistance.\n');

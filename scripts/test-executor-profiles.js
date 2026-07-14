#!/usr/bin/env node

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const forks = require('../core/forks');

let profiles;
try {
  profiles = require('../core/forks/executor-profiles');
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND'
      && error.message.includes('core/forks/executor-profiles')) {
    throw Object.assign(new Error(
      'EXECUTOR_PROFILES_NOT_IMPLEMENTED: production support is absent; frozen acceptance contract is ready'
    ), { code: 'EXECUTOR_PROFILES_NOT_IMPLEMENTED' });
  }
  throw error;
}

const REQUIRED_EXPORTS = [
  'assertValidExecutorFile',
  'normalizeExecutorFile',
  'executorProfileDigest',
  'executorSetDigest',
  'synthesizeLegacyExecutors',
  'branchIdForProfile',
  'resolveExecutorSelection',
  'runtimeInvocationForProfile',
  'bindExecutorProfiles',
  'createForkReceiptWrapper',
  'verifyForkReceiptWrapper',
  'evaluateModelProof',
  'missionControlExecutorState',
  'publicExecutorReplay',
];
for (const name of REQUIRED_EXPORTS) {
  assert.equal(typeof profiles[name], 'function', `missing executor profile export: ${name}`);
}

const claude = Object.freeze({
  profile_id: 'claude-sonnet',
  runtime: 'claude',
  model: 'claude-sonnet-4-5',
  local_provider: null,
  adapter_options: Object.freeze({ permission_mode: 'dontAsk', effort: 'high' }),
});
const codex = Object.freeze({
  profile_id: 'codex-hosted',
  runtime: 'codex',
  model: 'gpt-5-codex',
  local_provider: null,
  adapter_options: Object.freeze({ sandbox: 'read-only' }),
});
const local = Object.freeze({
  profile_id: 'codex-local-qwen',
  runtime: 'codex',
  model: 'qwen3-coder:30b',
  local_provider: 'ollama',
  adapter_options: Object.freeze({ sandbox: 'workspace-write' }),
});
const validFile = Object.freeze({ schema_version: 1, executors: [claude, codex, local] });

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function rejects(file, pattern) {
  assert.throws(() => profiles.assertValidExecutorFile(file), pattern);
}

assert.strictEqual(profiles.assertValidExecutorFile(validFile), validFile);
rejects({ ...copy(validFile), extra: true }, /field|unknown/i);
rejects({ ...copy(validFile), executors: [{ ...copy(claude), command: 'pwsh' }, copy(codex)] }, /field|unknown/i);
rejects({ ...copy(validFile), executors: [copy(claude), { ...copy(codex), profile_id: claude.profile_id }] }, /profile_id|duplicate|unique/i);
rejects({ ...copy(validFile), executors: [copy(claude), { ...copy(codex), adapter_options: { permission_mode: 'plan' } }] }, /option|permission_mode/i);
rejects({ ...copy(validFile), executors: [{ ...copy(claude), adapter_options: { permission_mode: 'bypassPermissions' } }, copy(codex)] }, /permission_mode|bypass/i);
rejects({ ...copy(validFile), executors: [copy(claude), { ...copy(codex), adapter_options: { sandbox: 'danger-full-access' } }] }, /sandbox|danger/i);
rejects({ ...copy(validFile), executors: [copy(claude), { ...copy(local), runtime: 'claude' }] }, /provider|runtime/i);
rejects({ ...copy(validFile), executors: [copy(claude), { ...copy(local), local_provider: 'docker' }] }, /provider|allow/i);
rejects({ ...copy(validFile), executors: [copy(claude), { ...copy(local), model: null }] }, /model/i);

const duplicateRuntime = profiles.normalizeExecutorFile({
  schema_version: 1,
  executors: [copy(codex), copy(local)],
});
assert.deepEqual(duplicateRuntime.executors.map((item) => item.profile_id), [
  'codex-hosted', 'codex-local-qwen',
]);
assert.deepEqual(duplicateRuntime.executors.map((item) => item.runtime), ['codex', 'codex']);

const reordered = { schema_version: 1, executors: [copy(local), copy(claude), copy(codex)] };
assert.equal(profiles.executorSetDigest(validFile), profiles.executorSetDigest(reordered));
assert.notEqual(profiles.executorProfileDigest(codex), profiles.executorProfileDigest({ ...copy(codex), model: 'gpt-5.1-codex' }));
assert.notEqual(profiles.executorProfileDigest(local), profiles.executorProfileDigest({ ...copy(local), local_provider: 'lmstudio' }));
assert.notEqual(profiles.executorProfileDigest(codex), profiles.executorProfileDigest({ ...copy(codex), adapter_options: { sandbox: 'workspace-write' } }));

const legacy = profiles.synthesizeLegacyExecutors(['claude', 'codex']);
assert.deepEqual(legacy, [
  { profile_id: 'claude', runtime: 'claude', model: null, local_provider: null, adapter_options: {} },
  { profile_id: 'codex', runtime: 'codex', model: null, local_provider: null, adapter_options: {} },
]);
assert.deepEqual(legacy.map(profiles.branchIdForProfile), ['branch-claude', 'branch-codex']);
assert.throws(() => profiles.resolveExecutorSelection({ executors: validFile, runtimes: ['claude'] }), /mutually exclusive/i);
assert.deepEqual(profiles.resolveExecutorSelection({ runtimes: ['claude', 'codex'] }).profiles, legacy);

assert.deepEqual(profiles.runtimeInvocationForProfile(claude), {
  command: 'claude',
  args: ['--print', '--output-format', 'json', '--permission-mode', 'dontAsk',
    '--model', 'claude-sonnet-4-5', '--effort', 'high'],
});
assert.deepEqual(profiles.runtimeInvocationForProfile(local), {
  command: 'codex',
  args: ['exec', '--json', '--sandbox', 'workspace-write', '--oss', '--local-provider', 'ollama',
    '--model', 'qwen3-coder:30b', '-'],
});
let spawnOptions;
const invocation = profiles.runtimeInvocationForProfile(local);
forks.safeSpawn(invocation.command, invocation.args, {
  spawn: (_command, _args, options) => {
    spawnOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  },
});
assert.equal(spawnOptions.shell, false);

const profileDigests = new Map(validFile.executors.map((profile) => [
  profile.profile_id, profiles.executorProfileDigest(profile),
]));
const forkV2 = profiles.bindExecutorProfiles({
  schema_version: 1,
  fork_id: 'fork-executor-proof',
  contract_digest: `sha256:${'a'.repeat(64)}`,
  branches: [],
}, validFile);
assert.equal(forkV2.schema_version, 2);
assert.equal(forkV2.executor_set_digest, profiles.executorSetDigest(validFile));
assert.deepEqual(forkV2.branches.map((branch) => branch.branch_id), [
  'branch-claude-sonnet', 'branch-codex-hosted', 'branch-codex-local-qwen',
]);
for (const branch of forkV2.branches) {
  assert.equal(branch.executor_profile_digest,
    profileDigests.get(branch.branch_id.slice('branch-'.length)));
}

const signingKey = crypto.generateKeyPairSync('ed25519').privateKey;
const wrapperInput = {
  fork_id: forkV2.fork_id,
  branch_id: 'branch-codex-local-qwen',
  contract_digest: forkV2.contract_digest,
  executor_profile_digest: profileDigests.get(local.profile_id),
  execution_receipt_digest: `sha256:${'b'.repeat(64)}`,
  issued_at: '2026-07-13T18:00:00.000Z',
  issuer_id: 'issuer-fork-executor-proof',
};
const wrapper = profiles.createForkReceiptWrapper({ ...wrapperInput, signingKey });
const publicKey = crypto.createPublicKey(signingKey);
assert.equal(profiles.verifyForkReceiptWrapper(wrapper, { publicKey, expected: wrapperInput }).status, 'verified');
for (const field of ['fork_id', 'branch_id', 'contract_digest', 'executor_profile_digest', 'execution_receipt_digest']) {
  const tampered = copy(wrapper);
  tampered.receipt[field] = field.endsWith('digest') ? `sha256:${'c'.repeat(64)}` : `${tampered.receipt[field]}-tampered`;
  assert.notEqual(profiles.verifyForkReceiptWrapper(tampered, { publicKey, expected: wrapperInput }).status, 'verified', field);
}

assert.deepEqual(profiles.evaluateModelProof(local, null), {
  requested_model: local.model, observed_model: null, status: 'unknown', reason_code: 'MODEL_OBSERVATION_MISSING',
});
assert.equal(profiles.evaluateModelProof(local, { model: local.model, trusted: true }).status, 'passed');
assert.equal(profiles.evaluateModelProof(local, { model: 'other-model', trusted: true }).status, 'failed');
assert.equal(profiles.evaluateModelProof(local, { model: local.model, trusted: false }).status, 'unknown');

const missionUnknown = profiles.missionControlExecutorState({ profile: local, observation: null, wrapper: null });
assert.equal(missionUnknown.requested_model, local.model);
assert.equal(missionUnknown.observed_model, null);
assert.equal(missionUnknown.model_status, 'unknown');
assert.equal(missionUnknown.receipt_status, 'unknown');
assert.equal(missionUnknown.cost, null);
assert.equal(missionUnknown.cost_status, 'unknown');

const replay = profiles.publicExecutorReplay({ profile: local, observation: null, wrapper });
const serialized = JSON.stringify(replay);
for (const forbidden of ['signature', 'private', 'raw_output', 'env', 'command', 'args']) {
  assert(!serialized.includes(forbidden), `public executor replay leaked ${forbidden}`);
}
assert.equal(replay.model_status, 'unknown');

process.stdout.write('Executor profiles passed: strict profiles, canonical digests, literal invocations, bound receipts, and honest model proof.\n');

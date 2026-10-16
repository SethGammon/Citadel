#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const governance = require('../core/governance');
const { taskGovernanceAuthority, serializeWorkQueue } = require('../core/fleet/session');
const { buildIntegrationPlan, integrationEvidenceDigest } = require('../core/fleet/integration-queue');
const { collect, parseArgs, resolveCommit } = require('./fleet-steward');

const baseOid = 'a'.repeat(40);
const candidateOid = 'b'.repeat(40);
const changedOid = 'c'.repeat(40);
const sessionId = 'session-integration-test';
const now = '2026-10-15T10:05:00.000Z';
const roots = [];
let assertions = 0;
function test(name, run) {
  run();
  assertions++;
  console.log(`PASS ${name}`);
}
function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-integration-queue-'));
  roots.push(value);
  return value;
}
function task(id, extra = {}) {
  return {
    id, campaign: `Task ${id}`, scope: [`src/${id}`], deps: [], status: 'complete',
    wave: 1, agent: 'build', branch: `topic-${id}`, evidence: 'validator passed', ...extra,
  };
}
function options(tasks, projectRoot, extra = {}) {
  return {
    projectRoot, sessionId, now,
    base: { ref: 'main', oid: baseOid },
    candidates: tasks.map((entry) => ({ taskId: entry.id, ref: entry.branch, oid: candidateOid })),
    ...extra,
  };
}
function codes(plan, id = plan.entries[0]?.taskId) {
  return plan.entries.find((entry) => entry.taskId === id).blockers.map((entry) => entry.code);
}
function record(projectRoot, item, extra = {}) {
  const authority = taskGovernanceAuthority(item, { sessionId });
  const subject = { kind: authority.kind, id: authority.id };
  const producerContract = governance.sha256Digest({ contract: 'test-integration-validator-v1' });
  const producers = extra.producers || ['validator'];
  const policy = governance.createGatePolicy({
    contract_version: 1, policy_id: `integration-${producers.join('-')}`,
    subject_kind: 'fleet-task',
    required_observations: producers.map((id) => ({
      observation_id: id, producer_kind: 'mechanical-validator', producer_contract_digest: producerContract,
    })),
    retry_policy: { max_attempts: 1, initial_delay_ms: 0, backoff_multiplier: 1, max_delay_ms: 0 },
    deadline_policy: { attempt_timeout_ms: 1000, overall_deadline_ms: 10000 },
    checkpoint_requirement: 'none', human_gate: { required: false, observation_id: null },
    allowed_dispositions: ['hold', 'merge'],
  });
  const binding = integrationEvidenceDigest(item, {
    sessionId, baseOid: extra.baseOid || baseOid, candidateOid: extra.candidateOid || candidateOid,
  });
  const observedAt = extra.observedAt || '2026-10-15T10:00:00.000Z';
  const observations = producers.map((producer, index) => governance.createEvidenceObservation({
    contract_version: 1,
    observation_id: `${authority.id}-${producer}-${extra.attempt || 'one'}`,
    subject, subject_digest: authority.digest, subject_generation: authority.generation,
    attempt_id: `attempt-${extra.attempt || 'one'}`,
    producer: { kind: 'mechanical-validator', id: producer }, producer_contract_digest: producerContract,
    truth_status: 'passed', coverage: { required: 1, observed: 1, passed: 1, complete: true },
    reason_code: 'VERIFIED',
    artifact_digests: extra.unbound || extra.unboundSecond && index === 1
      ? [governance.sha256Digest({ legacy: 'task-only-proof' })] : [binding],
    observed_at: observedAt, expires_at: extra.expiresAt || null,
  }));
  return governance.evaluateAndRecord({
    projectRoot, policy, observations, subject,
    subjectDigest: authority.digest, subjectGeneration: authority.generation,
    decidedAt: observedAt, requestedDisposition: 'merge',
  });
}
function files(directory) {
  const output = {};
  const visit = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) visit(full);
      else output[path.relative(directory, full)] = governance.sha256Digest(fs.readFileSync(full).toString('base64'));
    }
  };
  visit(directory);
  return output;
}

try {
  test('status-only, missing identities, and a bare authorized flag cannot admit work', () => {
    const items = [task('1')];
    const missing = buildIntegrationPlan(items, { sessionId, authorize: () => ({ authorized: true }), now });
    assert.equal(missing.next, null);
    for (const code of ['BASE_IDENTITY_REQUIRED', 'CANDIDATE_IDENTITY_REQUIRED', 'GOVERNANCE_AUTHORITY_REQUIRED']) {
      assert(codes(missing).includes(code));
    }
    const resolved = buildIntegrationPlan(items, options(items, root()));
    assert(codes(resolved).includes('RECEIPT_MISSING'));
    assert.equal(resolved.next, null);
  });

  test('exact revision proof and existing durable governance admit a candidate without writing', () => {
    const projectRoot = root();
    const items = [task('1')];
    record(projectRoot, items[0]);
    const before = files(projectRoot);
    const plan = buildIntegrationPlan(items, options(items, projectRoot));
    assert.equal(plan.next, '1');
    assert.deepEqual(codes(plan), []);
    assert.equal(plan.entries[0].evidence.observations.length, 1);
    assert(Object.isFrozen(plan.entries[0]));
    assert.deepEqual(files(projectRoot), before);
  });

  test('old task-only evidence and partially bound policies do not imply acceptance', () => {
    for (const extra of [{ unbound: true }, { producers: ['validator', 'reviewer'], unboundSecond: true }]) {
      const projectRoot = root();
      const items = [task('1')];
      record(projectRoot, items[0], extra);
      const plan = buildIntegrationPlan(items, options(items, projectRoot));
      assert.equal(plan.entries[0].governance.authorized, true, 'legacy gate is still authoritative and untouched');
      assert(codes(plan).includes('INTEGRATION_PROOF_MISSING_OR_STALE'));
      assert.equal(plan.next, null);
    }
  });

  test('base and candidate changes invalidate proof; new recorded proof restores admission', () => {
    const projectRoot = root();
    const items = [task('1')];
    record(projectRoot, items[0]);
    const original = buildIntegrationPlan(items, options(items, projectRoot));
    const newBase = buildIntegrationPlan(items, options(items, projectRoot, { base: { ref: 'main', oid: changedOid } }));
    const changedOptions = options(items, projectRoot, {
      candidates: [{ taskId: '1', ref: items[0].branch, oid: changedOid }],
    });
    const newHead = buildIntegrationPlan(items, changedOptions);
    for (const plan of [newBase, newHead]) {
      assert.equal(plan.next, null);
      assert(codes(plan).includes('INTEGRATION_PROOF_MISSING_OR_STALE'));
      assert.notEqual(plan.planDigest, original.planDigest);
    }
    record(projectRoot, items[0], { attempt: 'two', candidateOid: changedOid, observedAt: '2026-10-15T10:01:00.000Z' });
    assert.equal(buildIntegrationPlan(items, changedOptions).next, '1');
    assert.equal(buildIntegrationPlan(items, options(items, projectRoot)).next, null, 'historical matching evidence cannot satisfy the latest decision');
  });

  test('changed task contract or latest unbound observation cannot reuse an older passing proof', () => {
    const projectRoot = root();
    const items = [task('1')];
    record(projectRoot, items[0]);
    const changed = [task('1', { scope: ['new/scope'] })];
    assert(codes(buildIntegrationPlan(changed, options(changed, projectRoot))).includes('SUBJECT_STALE'));
    record(projectRoot, items[0], { attempt: 'two', unbound: true, observedAt: '2026-10-15T10:01:00.000Z' });
    assert.equal(buildIntegrationPlan(items, options(items, projectRoot)).next, null);
  });

  test('expired observations and tampered journals fail closed', () => {
    const projectRoot = root();
    const items = [task('1')];
    record(projectRoot, items[0], { expiresAt: '2026-10-15T10:02:00.000Z' });
    assert(codes(buildIntegrationPlan(items, options(items, projectRoot))).includes('INTEGRATION_PROOF_EXPIRED'));
    fs.appendFileSync(governance.governanceStorePaths(projectRoot).journal, '{malformed}\n');
    const broken = buildIntegrationPlan(items, options(items, projectRoot));
    assert.equal(broken.next, null);
    assert(codes(broken).includes('JOURNAL_INVALID'));
  });

  test('dependencies order the queue but only actually merged dependencies release candidates', () => {
    const projectRoot = root();
    const items = [task('1', { deps: ['2'], wave: 1 }), task('2', { wave: 2 })];
    for (const item of items) record(projectRoot, item);
    const plan = buildIntegrationPlan(items, options(items, projectRoot));
    assert.deepEqual(plan.order, ['2', '1']);
    assert.equal(plan.next, '2');
    assert(codes(plan, '1').includes('DEPENDENCY_NOT_MERGED'));
    items[1].status = 'merged';
    assert.equal(buildIntegrationPlan(items, options(items, projectRoot)).next, '1');
    items[0].deps = ['missing'];
    assert(codes(buildIntegrationPlan(items, options(items, projectRoot)), '1').includes('DEPENDENCY_NOT_MERGED'));
  });

  test('cycles including self-dependencies cannot yield admission', () => {
    const items = [task('1', { deps: ['2'] }), task('2', { deps: ['1'] }), task('3', { deps: ['3'] })];
    const plan = buildIntegrationPlan(items, options(items, root()));
    assert.equal(plan.next, null);
    assert(plan.entries.every((entry) => entry.blockers.some((blocker) => blocker.code === 'DEPENDENCY_CYCLE')));
  });

  test('overlapping independent scopes block across waves and Windows spellings', () => {
    const projectRoot = root();
    const items = [task('1', { scope: ['src/API/**'], wave: 1 }), task('2', { scope: ['src\\api\\auth'], wave: 2 })];
    for (const item of items) record(projectRoot, item);
    const plan = buildIntegrationPlan(items, options(items, projectRoot));
    assert.deepEqual(plan.scopeConflicts, [{ left: '1', right: '2', ordered: false }]);
    assert.equal(plan.next, null);
    assert(plan.entries.every((entry) => entry.blockers.some((blocker) => blocker.code === 'SCOPE_CONFLICT')));
  });

  test('integration uses the same path boundaries and glob prefixes as live claims', () => {
    for (const [left, right, conflicts] of [
      ['src/api', 'src/api', 1],
      ['./src/api', 'src\\api', 1],
      ['src/API', 'src/api', 1],
      ['src/api/**', 'src/api/auth', 1],
      ['src/api*', 'src/api-client', 1],
      ['src/api', 'src/api-client', 0],
      ['src/api/**', 'src/api-client', 0],
    ]) {
      const items = [task('1', { scope: [left] }), task('2', { scope: [right] })];
      assert.equal(buildIntegrationPlan(items, options(items, root())).scopeConflicts.length,
        conflicts, `${left} versus ${right}`);
    }
  });

  test('dependency-ordered overlap does not deadlock prerequisites; read-only scopes do not conflict', () => {
    const projectRoot = root();
    const items = [task('1', { scope: ['src'] }), task('2', { scope: ['src/api'], deps: ['1'] })];
    for (const item of items) record(projectRoot, item);
    const plan = buildIntegrationPlan(items, options(items, projectRoot));
    assert.equal(plan.next, '1');
    assert.deepEqual(plan.scopeConflicts, [{ left: '1', right: '2', ordered: true }]);
    assert(!codes(plan, '1').includes('SCOPE_CONFLICT'));
    const readOnly = [task('1', { scope: ['src (read-only)'] }), task('2', { scope: ['src/api'] })];
    assert.deepEqual(buildIntegrationPlan(readOnly, options(readOnly, root())).scopeConflicts, []);
  });

  test('equivalent input permutations produce byte-identical plans and preserve inputs', () => {
    const projectRoot = root();
    const items = [task('2', { deps: ['3', '1'] }), task('3', { status: 'merged' }), task('1', { status: 'merged' }), task('4')];
    record(projectRoot, items[0]);
    record(projectRoot, items[3]);
    const original = JSON.stringify(items);
    const left = buildIntegrationPlan(items, options(items, projectRoot));
    const reversed = JSON.parse(original).reverse();
    reversed.find((entry) => entry.id === '2').deps.reverse();
    const right = buildIntegrationPlan(reversed, options(reversed, projectRoot));
    assert.equal(JSON.stringify(left), JSON.stringify(right));
    assert.equal(JSON.stringify(items), original);
    assert.equal(buildIntegrationPlan([], options([], projectRoot)).next, null);
  });

  test('malformed and ambiguous identities reject; bad scopes, revisions and branches block', () => {
    for (const malformed of [null, {}, [null], [task('1'), task('1')], [task('A'), task('a')], [task('1', { deps: '2' })], [task('1', { scope: [null] })], [task('1\n')], [task('1', { wave: NaN })]]) {
      assert.throws(() => buildIntegrationPlan(malformed, { sessionId }), TypeError);
    }
    const items = [task('1')];
    assert.throws(() => buildIntegrationPlan(items, { sessionId, candidates: {} }), TypeError);
    assert.throws(() => buildIntegrationPlan(items, { sessionId, candidates: [{ taskId: '1' }, { taskId: '1' }] }), TypeError);
    assert.throws(() => buildIntegrationPlan(items, { sessionId, candidates: [{ taskId: 'unknown' }] }), TypeError);
    assert.throws(() => buildIntegrationPlan(items, { sessionId, now: 'invalid' }), TypeError);
    assert.throws(() => integrationEvidenceDigest(items[0], { baseOid: 'abc', candidateOid }), TypeError);
    assert.throws(() => integrationEvidenceDigest(items[0], { baseOid: [baseOid], candidateOid }), TypeError);
    const missingScopes = [task('1', { scope: [] })];
    assert(codes(buildIntegrationPlan(missingScopes, options(missingScopes))).includes('SCOPE_REQUIRED_OR_INVALID'));
    const traversal = [task('1', { scope: ['../secret'] })];
    assert(codes(buildIntegrationPlan(traversal, options(traversal))).includes('SCOPE_REQUIRED_OR_INVALID'));
    const wrongBranch = options(items, undefined, { candidates: [{ taskId: '1', ref: 'other', oid: candidateOid }] });
    assert(codes(buildIntegrationPlan(items, wrongBranch)).includes('CANDIDATE_BRANCH_MISMATCH'));
    const abbreviated = options(items, undefined, { base: { ref: 'main', oid: 'abcdef' } });
    assert(codes(buildIntegrationPlan(items, abbreviated)).includes('BASE_IDENTITY_REQUIRED'));
    const trailingControl = options(items, undefined, { base: { ref: 'main', oid: `${baseOid}\n` } });
    assert(codes(buildIntegrationPlan(items, trailingControl)).includes('BASE_IDENTITY_REQUIRED'));
    const polluted = JSON.parse('{"__proto__":{"authorized":true}}');
    assert.equal(buildIntegrationPlan(items, { ...polluted, sessionId }).next, null);
    assert.equal({}.authorized, undefined);
  });

  test('CLI resolves actual local refs, remains read-only, rejects malicious refs and preserves legacy mode', () => {
    const projectRoot = root();
    const git = (args) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '--initial-branch=main']);
    const commit = () => git(['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fleet Test', '-c', 'user.email=fleet@example.test', 'commit', '--allow-empty', '-m', 'test commit']);
    commit();
    const actualBase = git(['rev-parse', 'HEAD']);
    git(['checkout', '-b', 'topic-1']);
    commit();
    const actualHead = git(['rev-parse', 'HEAD']);
    const sessionFile = path.join(projectRoot, '.planning', 'fleet', `${sessionId}.md`);
    const items = [task('1')];
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, `# Test\n\n## Work Queue\n${serializeWorkQueue(items)}\n`);
    record(projectRoot, items[0], { baseOid: actualBase, candidateOid: actualHead });
    const script = path.join(__dirname, 'fleet-steward.js');
    const common = [script, '--project-root', projectRoot, '--session', sessionFile];
    const run = (args) => spawnSync(process.execPath, [...common, ...args], { encoding: 'utf8' });
    const before = files(projectRoot);
    const good = run(['--plan', '--base', 'main', '--json']);
    assert.equal(good.status, 0, good.stderr);
    const result = JSON.parse(good.stdout);
    assert.equal(result.next, '1');
    assert.equal(result.base.oid, actualBase);
    assert.equal(result.entries[0].candidate.oid, actualHead);
    assert.equal(run(['--plan', '--base', 'main', '--json']).stdout, good.stdout);
    const human = run(['--plan', '--base', 'main']);
    assert(human.stdout.includes('Next eligible: #1'));
    for (const args of [
      ['--plan'], ['--plan', '--base'], ['--plan', '--base', 'missing', '--json'],
      ['--plan', '--base', 'main', '--write', '--mark-failed', '1', '--json'],
      ['--plan', '--base', 'main', '--override-readiness'],
      ['--plan', '--base', 'main', '--unknown'], ['--plan', '--project-root'],
      ['--mark-failed', '1', '--write', '--reason', '--plan'],
    ]) assert.equal(run(args).status, 1, `expected rejection: ${args.join(' ')}`);
    for (const ref of ['--help', 'main;echo hacked', '$(touch hacked)', 'main^{tree}', '../main', 'main\n']) {
      assert.equal(resolveCommit(projectRoot, ref), null);
      assert.equal(run(['--plan', '--base', ref, '--json']).status, 1, `expected rejected ref: ${ref}`);
    }
    assert.deepEqual(files(projectRoot), before, 'all plan invocations must preserve repo and receipts');
    const legacy = JSON.parse(run(['--json']).stdout);
    assert.deepEqual(legacy.analysis.mergeCandidates.map((item) => item.id), ['1']);
    assert.equal(legacy.kind, undefined);
    assert.equal(parseArgs(['node', 'fleet-steward', '--plan', '--base', 'main']).plan, true);
    assert(collect({ projectRoot, plan: true, base: 'main', markFailed: '1', write: true }).error);
    git(['branch', '-f', 'main', actualHead]);
    assert.equal(JSON.parse(run(['--plan', '--base', 'main', '--json']).stdout).next, null, 'base movement must invalidate CLI admission');
  });
} finally {
  for (const directory of roots) fs.rmSync(directory, { recursive: true, force: true });
}

console.log(`fleet integration queue tests passed (${assertions} scenarios)`);

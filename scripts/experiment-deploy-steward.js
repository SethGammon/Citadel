#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  acquireLease,
  readLease,
  readQueue,
  runDeploySteward,
} = require('../core/deploy-steward/steward');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments', 'deploy-steward', 'contract.json');
const OUTPUT_DIR = path.join(ROOT, '.planning', 'research', 'citadel-proof-experiments');
const RAW_PATH = path.join(OUTPUT_DIR, 'deploy-steward-raw.json');
const RESULT_PATH = path.join(OUTPUT_DIR, 'deploy-steward-results.json');
const REPORT_PATH = path.join(OUTPUT_DIR, 'deploy-steward-report.md');
const RECORDED_AT = '2026-08-04T12:00:00.000Z';
const BOUNDARY = Object.freeze({
  evidence_class: 'deterministic_local_fake_provider_state_machine',
  supports: 'paired behavior of independent loops and the real provider-injected deploy-steward path',
  github_branch_protection_observed: false,
  github_actions_observed: false,
  github_api_races_observed: false,
  public_artifacts_published: false,
  real_deployment_observed: false,
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadContract() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  assert.equal(contract.schema, 1);
  assert.equal(contract.experiment_id, 'deploy-steward');
  assert.deepStrictEqual(contract.batch_ids, ['batch-01', 'batch-02', 'batch-03']);
  assert.equal(contract.prs_per_arm_per_batch, 15);
  assert.equal(contract.treatment_seam, 'core/deploy-steward/steward.js#runDeploySteward');
  assert.deepStrictEqual(contract.public_arm_required_gates.map((gate) => gate.id), [
    'explicit_mutation_approval',
    'authenticated_github',
    'disposable_protected_repositories',
    'github_actions',
  ]);
  return contract;
}

function prId(batchId, number) {
  return `pr-acme-${batchId}-${number}`;
}

function initialState(batchId, count) {
  return Array.from({ length: count }, (_value, index) => {
    const number = index + 1;
    return {
      id: prId(batchId, number),
      number,
      url: `https://github.com/acme/${batchId}/pull/${number}`,
      branch: `agent/${number}`,
      base_version: 0,
      head: `${batchId}-agent-${number}-v0`,
      checks: 'pass',
      state: 'open',
    };
  });
}

function signedEvents(events) {
  let previous = null;
  const signed = events.map((event, index) => {
    const envelope = { sequence: index + 1, previous_sha256: previous, event };
    const sha256 = digest(envelope);
    previous = sha256;
    return { ...envelope, sha256 };
  });
  return { events: signed, event_chain_sha256: previous };
}

function verifyEventChain(arm) {
  let previous = null;
  for (let index = 0; index < arm.events.length; index += 1) {
    const entry = arm.events[index];
    assert.equal(entry.sequence, index + 1, 'event sequence changed');
    assert.equal(entry.previous_sha256, previous, 'event hash chain predecessor changed');
    assert.equal(entry.sha256, digest({
      sequence: entry.sequence,
      previous_sha256: entry.previous_sha256,
      event: entry.event,
    }), 'event hash changed');
    previous = entry.sha256;
  }
  assert.equal(arm.event_chain_sha256, previous, 'event chain head changed');
}

class DeterministicProviderModel {
  constructor(batchId, state, events) {
    this.batchId = batchId;
    this.mainVersion = 0;
    this.events = events;
    this.prs = new Map(state.map((entry) => [entry.id, {
      ...entry,
      baseVersion: entry.base_version,
      merged: false,
      pendingChecks: 0,
      deploys: 0,
    }]));
  }

  emit(action, fields = {}) {
    this.events.push({ action, main_version: this.mainVersion, ...fields });
  }

  refresh(id) {
    const pr = this.prs.get(id);
    assert(pr, `unknown PR ${id}`);
    const behind = !pr.merged && pr.baseVersion < this.mainVersion;
    let check = 'pass';
    if (!behind && pr.pendingChecks > 0) {
      pr.pendingChecks -= 1;
      check = 'pending';
    }
    this.emit('refresh', {
      pr: id,
      head: pr.head,
      base_version: pr.baseVersion,
      state: pr.merged ? 'merged' : 'open',
      behind,
      check,
    });
    return {
      number: pr.number,
      url: pr.url,
      branch: pr.branch,
      base: 'main',
      head: pr.head,
      state: pr.merged ? 'merged' : 'open',
      behindBase: behind,
      mergeStateStatus: behind ? 'BEHIND' : 'CLEAN',
      mergeable: 'MERGEABLE',
      checks: [{ name: 'ci', status: check }],
    };
  }

  updateBranch(id) {
    const pr = this.prs.get(id);
    assert(pr && !pr.merged, `cannot update ${id}`);
    pr.baseVersion = this.mainVersion;
    pr.head = `${this.batchId}-agent-${pr.number}-main-${this.mainVersion}`;
    pr.pendingChecks = 1;
    this.emit('updated-branch', { pr: id, head: pr.head, base_version: pr.baseVersion });
  }

  merge(id, detail) {
    const pr = this.prs.get(id);
    const stale = detail.head !== pr.head || pr.baseVersion !== this.mainVersion;
    this.emit('merge-attempt', {
      pr: id,
      refreshed_head: detail.head,
      current_head: pr.head,
      base_version: pr.baseVersion,
      stale,
    });
    if (stale) {
      this.emit('merge-rejected', { pr: id, reason: 'stale-head-race', stale_head_attempt: true });
      throw new Error(`stale-head race rejected for ${id}`);
    }
    pr.merged = true;
    const before = this.mainVersion;
    this.mainVersion += 1;
    this.emit('merge-accepted', { pr: id, head: pr.head, main_version_before: before });
  }

  deploy(id) {
    const pr = this.prs.get(id);
    assert(pr.merged, `cannot deploy unmerged ${id}`);
    assert.equal(pr.deploys, 0, `duplicate deploy for ${id}`);
    pr.deploys += 1;
    this.emit('deployed', { pr: id, deploy_number: pr.deploys });
  }

  count(action) {
    return this.events.filter((event) => event.action === action).length;
  }

  summary(extra = {}) {
    return {
      initial_valid_prs: this.prs.size,
      landed_prs: [...this.prs.values()].filter((pr) => pr.merged).length,
      deploys: [...this.prs.values()].reduce((total, pr) => total + pr.deploys, 0),
      branch_updates: this.count('updated-branch'),
      waiting_for_checks: this.events.filter((event) => event.action === 'refresh' && event.check === 'pending').length,
      merge_attempts: this.count('merge-attempt'),
      race_failures: this.count('merge-rejected'),
      stale_head_attempts: this.events.filter((event) => event.stale_head_attempt === true).length,
      stale_head_merges: this.events.filter((event) => event.action === 'merge-accepted' && event.stale === true).length,
      repair_tasks: 0,
      ...extra,
    };
  }
}

function readinessReport(entry, generatedAt) {
  return [
    'Citadel PR Readiness',
    '========================================',
    `Generated: ${generatedAt}`,
    'Status: ready',
    `PR: ${entry.url}`,
    `Branch: ${entry.branch}`,
    `Head: ${entry.head}`,
    '',
    '| Gate | Status | Detail |',
    '|---|---|---|',
    '| Pull request URL | pass | present |',
    '| Verification | pass | deterministic fixture |',
    '',
  ].join('\n');
}

function runControl(batchId, state) {
  const events = [];
  const model = new DeterministicProviderModel(batchId, state, events);
  let rounds = 0;
  while ([...model.prs.values()].some((pr) => !pr.merged)) {
    rounds += 1;
    assert(rounds <= 100, 'independent control loops did not converge');
    const open = [...model.prs.values()].filter((pr) => !pr.merged);
    model.emit('independent-loop-round', { round: rounds, loop_count: open.length, global_lease: false, shared_queue: false });
    const refreshed = open.map((pr) => ({ id: pr.id, detail: model.refresh(pr.id) }));
    for (const candidate of refreshed) {
      if (candidate.detail.behindBase) model.updateBranch(candidate.id);
    }
    for (const candidate of refreshed) {
      const check = candidate.detail.checks[0].status;
      if (candidate.detail.behindBase || check !== 'pass') continue;
      try {
        model.merge(candidate.id, candidate.detail);
        model.deploy(candidate.id);
      } catch (error) {
        assert.match(error.message, /stale-head race rejected/);
      }
    }
  }
  const summary = model.summary({ rounds, interventions: model.count('merge-rejected'), lease_acquisitions: 0 });
  assert.equal(summary.landed_prs, state.length);
  assert.equal(summary.deploys, state.length);
  assert(summary.race_failures > 0);
  return { summary, ...signedEvents(events) };
}

function runTreatment(batchId, batchIndex, state) {
  const events = [];
  const model = new DeterministicProviderModel(batchId, state, events);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `citadel-deploy-experiment-${batchId}-`));
  const readinessDir = path.join(root, '.planning', 'pr-readiness');
  fs.mkdirSync(readinessDir, { recursive: true });
  for (const entry of state) {
    fs.writeFileSync(
      path.join(readinessDir, `agent-${String(entry.number).padStart(2, '0')}.md`),
      readinessReport(entry, `2026-08-04T${String(12 + batchIndex).padStart(2, '0')}:00:${String(entry.number).padStart(2, '0')}.000Z`),
      'utf8',
    );
  }

  let cycles = 0;
  let competingLeaseBlocked = false;
  let repairTasks = 0;
  const provider = {
    refresh(item) {
      const active = readLease(root);
      assert(active, 'provider refresh occurred outside the real steward lease');
      model.emit('lease-active-at-refresh', { pr: item.id, holder: active.holder });
      if (!competingLeaseBlocked) {
        assert.throws(() => acquireLease(root, {
          holder: `${batchId}-competing-steward`,
          now: active.acquiredAt,
        }), /deploy steward lease is active/);
        competingLeaseBlocked = true;
        model.emit('competing-lease-blocked', { holder: `${batchId}-competing-steward` });
      }
      return model.refresh(item.id);
    },
    updateBranch(item) { model.updateBranch(item.id); },
    merge(item, detail) { model.merge(item.id, detail); },
    deploy(item) { model.deploy(item.id); },
    enqueueMergeQueue() { throw new Error('serial treatment must not use merge queue'); },
  };

  try {
    while (cycles < 100) {
      cycles += 1;
      model.emit('steward-cycle', { cycle: cycles, treatment_path: 'core/deploy-steward/steward.js#runDeploySteward' });
      const result = runDeploySteward(root, {
        scan: cycles === 1,
        run: true,
        write: true,
        provider,
        deployCommand: 'fake-provider-deploy',
        holder: `${batchId}-single-steward`,
        command: 'local deterministic deploy-steward experiment',
        now: `2026-08-04T${String(12 + batchIndex).padStart(2, '0')}:${String(cycles).padStart(2, '0')}:00.000Z`,
      });
      assert(result.lease, 'real steward path did not return its lease');
      repairTasks += result.events.filter((event) => event.action === 'repair-needed').length;
      model.emit('steward-result', {
        cycle: cycles,
        lease_holder: result.lease.holder,
        actions: result.events.map((event) => event.action),
      });
      assert.equal(readLease(root), null, 'steward lease was not released');
      model.emit('lease-released', { cycle: cycles });
      const queue = readQueue(root);
      if (queue.length === state.length && queue.every((item) => item.status === 'landed')) break;
    }
    const summary = model.summary({
      cycles,
      interventions: repairTasks,
      repair_tasks: repairTasks,
      lease_acquisitions: cycles,
      competing_lease_attempts_blocked: competingLeaseBlocked ? 1 : 0,
    });
    assert.equal(summary.landed_prs, state.length);
    assert.equal(summary.deploys, state.length);
    assert.equal(summary.race_failures, 0);
    assert.equal(summary.stale_head_attempts, 0);
    assert.equal(summary.stale_head_merges, 0);
    assert.equal(summary.repair_tasks, 0);
    assert.equal(summary.branch_updates, state.length - 1);
    return { summary, ...signedEvents(events) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function sum(batches, arm, field) {
  return batches.reduce((total, batch) => total + batch[arm].summary[field], 0);
}

function gate(id, expected, observed, pass) {
  return { id, expected, observed, pass };
}

function buildEvidence() {
  const contract = loadContract();
  const batches = contract.batch_ids.map((batchId, batchIndex) => {
    const state = initialState(batchId, contract.prs_per_arm_per_batch);
    const stateSha = digest(state);
    return {
      batch_id: batchId,
      initial_state_sha256: stateSha,
      control_initial_state_sha256: stateSha,
      treatment_initial_state_sha256: stateSha,
      control: runControl(batchId, state),
      treatment: runTreatment(batchId, batchIndex, state),
    };
  });
  const metrics = {};
  for (const arm of ['control', 'treatment']) {
    metrics[arm] = {
      batches: batches.length,
      initial_valid_prs: sum(batches, arm, 'initial_valid_prs'),
      landed_prs: sum(batches, arm, 'landed_prs'),
      deploys: sum(batches, arm, 'deploys'),
      branch_updates: sum(batches, arm, 'branch_updates'),
      waiting_for_checks: sum(batches, arm, 'waiting_for_checks'),
      merge_attempts: sum(batches, arm, 'merge_attempts'),
      race_failures: sum(batches, arm, 'race_failures'),
      stale_head_attempts: sum(batches, arm, 'stale_head_attempts'),
      stale_head_merges: sum(batches, arm, 'stale_head_merges'),
      repair_tasks: sum(batches, arm, 'repair_tasks'),
      interventions: sum(batches, arm, 'interventions'),
      deploys_per_merge: sum(batches, arm, 'deploys') / sum(batches, arm, 'landed_prs'),
    };
  }
  const publicArm = {
    status: 'blocked',
    ready: false,
    reason: 'All remote authority and infrastructure gates are unobserved; no remote action was attempted.',
    gates: contract.public_arm_required_gates.map((required) => ({
      ...required,
      required: true,
      observed: false,
      status: 'blocked',
    })),
  };
  const gates = [
    gate('three_matched_batches', 3, batches.length, batches.length === 3),
    gate('treatment_landed_prs', '45/45', `${metrics.treatment.landed_prs}/${metrics.treatment.initial_valid_prs}`, metrics.treatment.landed_prs === 45),
    gate('treatment_each_batch_landed', '15/15', batches.map((batch) => `${batch.treatment.summary.landed_prs}/15`), batches.every((batch) => batch.treatment.summary.landed_prs === 15)),
    gate('treatment_deploy_once_per_merge', 1, metrics.treatment.deploys_per_merge, metrics.treatment.deploys_per_merge === 1),
    gate('treatment_stale_head_merges', 0, metrics.treatment.stale_head_merges, metrics.treatment.stale_head_merges === 0),
    gate('treatment_stale_head_attempts', 0, metrics.treatment.stale_head_attempts, metrics.treatment.stale_head_attempts === 0),
    gate('treatment_repair_tasks', 0, metrics.treatment.repair_tasks, metrics.treatment.repair_tasks === 0),
    gate('treatment_race_failures_below_control', `< ${metrics.control.race_failures}`, metrics.treatment.race_failures, metrics.treatment.race_failures < metrics.control.race_failures),
    gate('public_arm_blocked_without_authority_and_infra', 'blocked', publicArm.status, publicArm.status === 'blocked' && publicArm.gates.every((item) => !item.observed)),
  ];
  const raw = {
    schema: 1,
    kind: 'citadel_deploy_steward_raw_evidence',
    experiment_id: 'deploy-steward',
    recorded_at: RECORDED_AT,
    contract_sha256: fileDigest(CONTRACT_PATH),
    treatment_source_sha256: fileDigest(path.join(ROOT, 'core', 'deploy-steward', 'steward.js')),
    boundary: BOUNDARY,
    batches,
  };
  const result = {
    schema: 1,
    kind: 'citadel_deploy_steward_result',
    experiment_id: 'deploy-steward',
    recorded_at: RECORDED_AT,
    outcome: gates.every((item) => item.pass) ? 'local_pass_external_promotion_blocked' : 'failed',
    claim_boundary: 'Fake provider and deterministic local state-machine evidence only; not GitHub branch protection, GitHub Actions, GitHub API race, public artifact, or real deployment evidence.',
    raw_evidence_sha256: digest(raw),
    metrics,
    gates,
    public_arm: publicArm,
  };
  return { raw, result };
}

function reportMarkdown(result) {
  const c = result.metrics.control;
  const t = result.metrics.treatment;
  return [
    '# Deploy steward paired local experiment',
    '',
    `Outcome: **${result.outcome}**`,
    '',
    result.claim_boundary,
    '',
    '| Metric | Independent loops | Leased steward |',
    '|---|---:|---:|',
    `| Landed PRs | ${c.landed_prs}/${c.initial_valid_prs} | ${t.landed_prs}/${t.initial_valid_prs} |`,
    `| Deploys | ${c.deploys} | ${t.deploys} |`,
    `| Race failures | ${c.race_failures} | ${t.race_failures} |`,
    `| Stale-head attempts | ${c.stale_head_attempts} | ${t.stale_head_attempts} |`,
    `| Stale-head merges | ${c.stale_head_merges} | ${t.stale_head_merges} |`,
    `| Branch updates | ${c.branch_updates} | ${t.branch_updates} |`,
    `| Repair tasks | ${c.repair_tasks} | ${t.repair_tasks} |`,
    '',
    '## Public arm readiness',
    '',
    `Status: **${result.public_arm.status}**`,
    '',
    ...result.public_arm.gates.map((item) => `- [ ] ${item.category}: ${item.id}`),
    '',
    `Raw evidence SHA-256: \`${result.raw_evidence_sha256}\``,
    '',
  ].join('\n');
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return 'unchanged';
  const existed = fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return existed ? 'updated' : 'created';
}

function writeEvidence(evidence, paths = {}) {
  const rawPath = paths.rawPath || RAW_PATH;
  const resultPath = paths.resultPath || RESULT_PATH;
  const reportPath = paths.reportPath || REPORT_PATH;
  return {
    raw: writeIfChanged(rawPath, `${JSON.stringify(evidence.raw, null, 2)}\n`),
    result: writeIfChanged(resultPath, `${JSON.stringify(evidence.result, null, 2)}\n`),
    report: writeIfChanged(reportPath, reportMarkdown(evidence.result)),
    paths: { rawPath, resultPath, reportPath },
  };
}

function verifyEvidence(raw, result, report) {
  for (const batch of raw.batches) {
    verifyEventChain(batch.control);
    verifyEventChain(batch.treatment);
    assert.equal(batch.control_initial_state_sha256, batch.initial_state_sha256, 'control fixture mismatch');
    assert.equal(batch.treatment_initial_state_sha256, batch.initial_state_sha256, 'treatment fixture mismatch');
  }
  assert.equal(result.raw_evidence_sha256, digest(raw), 'raw evidence digest mismatch');
  const rerun = buildEvidence();
  assert.deepStrictEqual(raw, rerun.raw, 'raw evidence differs from deterministic replay');
  assert.deepStrictEqual(result, rerun.result, 'results differ from deterministic replay');
  assert.equal(report, reportMarkdown(rerun.result), 'markdown report differs from deterministic replay');
  assert.equal(result.outcome, 'local_pass_external_promotion_blocked');
  return {
    outcome: 'verified',
    claim_status: result.outcome,
    raw_evidence_sha256: result.raw_evidence_sha256,
    metrics: result.metrics,
    public_arm: result.public_arm.status,
  };
}

function verify(paths = {}) {
  const rawPath = paths.rawPath || RAW_PATH;
  const resultPath = paths.resultPath || RESULT_PATH;
  const reportPath = paths.reportPath || REPORT_PATH;
  return verifyEvidence(
    JSON.parse(fs.readFileSync(rawPath, 'utf8')),
    JSON.parse(fs.readFileSync(resultPath, 'utf8')),
    fs.readFileSync(reportPath, 'utf8'),
  );
}

function runCli(argv = process.argv.slice(2), paths = {}) {
  if (argv.length !== 1 || !['run', 'verify'].includes(argv[0])) {
    throw new Error('Usage: node scripts/experiment-deploy-steward.js <run|verify>');
  }
  if (argv[0] === 'verify') return verify(paths);
  const evidence = buildEvidence();
  const artifacts = writeEvidence(evidence, paths);
  return {
    outcome: evidence.result.outcome,
    raw_evidence_sha256: evidence.result.raw_evidence_sha256,
    metrics: evidence.result.metrics,
    public_arm: evidence.result.public_arm,
    artifacts: { raw: artifacts.raw, result: artifacts.result, report: artifacts.report },
  };
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(runCli(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Deploy steward experiment failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = Object.freeze({
  BOUNDARY,
  CONTRACT_PATH,
  RAW_PATH,
  REPORT_PATH,
  RESULT_PATH,
  buildEvidence,
  digest,
  reportMarkdown,
  runCli,
  verify,
  verifyEvidence,
  verifyEventChain,
  writeEvidence,
});

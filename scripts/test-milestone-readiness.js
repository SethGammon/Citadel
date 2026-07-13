#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluateGate, evaluatePortfolio } = require('../core/milestones/external-gates');

const empty = evaluatePortfolio();
assert.equal(empty.status, 'awaiting_external_evidence');
assert.equal(empty.ready_count, 0);
assert.equal(empty.gate_count, 6);
assert(empty.gates.every((gate) => gate.status === 'awaiting_external_evidence'));

const demandByRequests = evaluateGate('relay_demand', { recurring_team_requests: 10 });
assert.equal(demandByRequests.ready, true);
const demandByWaitlist = evaluateGate('relay_demand', { qualified_waitlist: 200 });
assert.equal(demandByWaitlist.ready, true);
assert.equal(evaluateGate('relay_demand', { recurring_team_requests: 9, qualified_waitlist: 199 }).ready, false);

const completeEvidence = {
  activation: { unique_installs: 25, mature_observations: 25, installer_interviews: 10 },
  pack_adoption: { external_runs: 100, verified_artifacts: 50, packs_with_25pct_day7_return: 1 },
  ecosystem: { external_maintainers: 10, certified_packs: 25, packs_with_repeat_users: 5,
    packs_with_100_verified_installs: 3, non_founder_release_maintainers: 1 },
  team_pilot: { design_partner_teams: 3, pilot_days: 30, operators_in_one_team: 5,
    repositories_in_one_team: 10, cross_machine_success_bps: 9900 },
  relay_demand: { recurring_team_requests: 10 },
  reliability_dataset: { opted_in_runs: 100, independent_repositories: 20,
    represented_runtimes: 2, held_out_runs: 20 },
};
assert.equal(evaluatePortfolio(completeEvidence).status, 'ready');
assert.throws(() => evaluatePortfolio({ imaginary: {} }), /Unknown milestone evidence/);
assert.throws(() => evaluateGate('imaginary'), /Unknown external milestone gate/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-milestone-gates-'));
try {
  const file = path.join(root, 'evidence.json');
  fs.writeFileSync(file, JSON.stringify(completeEvidence), 'utf8');
  const script = path.join(__dirname, 'milestone-readiness.js');
  const output = execFileSync(process.execPath, [script, '--evidence', file, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).ready_count, 6);
  const waiting = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8' });
  assert.equal(waiting.status, 2);
  assert.equal(JSON.parse(waiting.stdout).status, 'awaiting_external_evidence');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('external milestone readiness tests passed');

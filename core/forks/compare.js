'use strict';

const { assertValidFork } = require('./contracts');

function comparableBranch(branch, fork) {
  const evidence = branch.evidence_summary;
  const reasons = [];
  if (branch.contract_digest !== fork.contract_digest) reasons.push('contract-mismatch');
  if (!evidence) reasons.push('evidence-missing');
  else {
    if (!evidence.receipt_verified) reasons.push('receipt-unverified');
    if (evidence.present < evidence.required) reasons.push('evidence-incomplete');
    if (!['passed', 'failed'].includes(evidence.status)) reasons.push('outcome-inconclusive');
  }
  if (!branch.receipt_digest) reasons.push('receipt-missing');
  return { comparable: reasons.length === 0, reasons };
}

function normalizedScore(branch) {
  const evidence = branch.evidence_summary;
  if (evidence.status !== 'passed') return 0;
  if (evidence.score !== null) return evidence.score / evidence.score_max;
  return 1;
}

function compareFork(fork) {
  assertValidFork(fork);
  const branches = fork.branches.map((branch) => {
    const eligibility = comparableBranch(branch, fork);
    return {
      branch_id: branch.branch_id,
      runtime: branch.runtime,
      status: branch.status,
      comparable: eligibility.comparable,
      reasons: eligibility.reasons,
      verified_outcome: branch.evidence_summary?.status || 'unknown',
      evidence: branch.evidence_summary,
      diff: branch.diff_summary,
      duration_ms: branch.duration_ms,
      cost: branch.cost,
      score: eligibility.comparable ? normalizedScore(branch) : null,
    };
  });
  const comparable = branches.filter((branch) => branch.comparable);
  let outcome = 'insufficient-evidence';
  let recommendation = null;
  if (comparable.length >= 2) {
    const highest = Math.max(...comparable.map((branch) => branch.score));
    const leaders = comparable.filter((branch) => branch.score === highest);
    if (leaders.length === 1) {
      outcome = 'recommended';
      recommendation = leaders[0].branch_id;
    } else {
      outcome = 'tie';
    }
  }
  return Object.freeze({
    schema_version: 1,
    fork_id: fork.fork_id,
    fork_revision: fork.revision,
    outcome,
    recommendation,
    comparable_count: comparable.length,
    branches,
  });
}

module.exports = Object.freeze({ comparableBranch, compareFork });

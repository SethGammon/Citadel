'use strict';

const GATE_VERSION = 1;

const DEFINITIONS = Object.freeze({
  activation: Object.freeze({
    description: 'Independent installations reach verified use and a mature return window.',
    all: Object.freeze([
      ['unique_installs', 25],
      ['mature_observations', 25],
      ['installer_interviews', 10],
    ]),
  }),
  pack_adoption: Object.freeze({
    description: 'Outcome Packs produce verified external work and repeat use.',
    all: Object.freeze([
      ['external_runs', 100],
      ['verified_artifacts', 50],
      ['packs_with_25pct_day7_return', 1],
    ]),
  }),
  ecosystem: Object.freeze({
    description: 'Independent maintainers and Packs demonstrate ecosystem pull.',
    all: Object.freeze([
      ['external_maintainers', 10],
      ['certified_packs', 25],
      ['packs_with_repeat_users', 5],
      ['packs_with_100_verified_installs', 3],
      ['non_founder_release_maintainers', 1],
    ]),
  }),
  team_pilot: Object.freeze({
    description: 'Real teams sustain local-first Citadel operation.',
    all: Object.freeze([
      ['design_partner_teams', 3],
      ['pilot_days', 30],
      ['operators_in_one_team', 5],
      ['repositories_in_one_team', 10],
      ['cross_machine_success_bps', 9900],
    ]),
  }),
  relay_demand: Object.freeze({
    description: 'Demand is strong enough to justify hosted Relay operations.',
    any: Object.freeze([
      ['recurring_team_requests', 10],
      ['qualified_waitlist', 200],
    ]),
  }),
  reliability_dataset: Object.freeze({
    description: 'Consented evidence is representative enough to evaluate recommendations.',
    all: Object.freeze([
      ['opted_in_runs', 100],
      ['independent_repositories', 20],
      ['represented_runtimes', 2],
      ['held_out_runs', 20],
    ]),
  }),
});

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function evaluateRequirement(evidence, requirement) {
  const [metric, threshold] = requirement;
  const actual = safeCount(evidence[metric]);
  return Object.freeze({ metric, actual, threshold, pass: actual >= threshold });
}

function evaluateGate(name, evidence = {}) {
  const definition = DEFINITIONS[name];
  if (!definition) throw new Error(`Unknown external milestone gate: ${name}`);
  const all = (definition.all || []).map((item) => evaluateRequirement(evidence, item));
  const any = (definition.any || []).map((item) => evaluateRequirement(evidence, item));
  const allPass = all.every((item) => item.pass);
  const anyPass = any.length === 0 || any.some((item) => item.pass);
  const ready = allPass && anyPass;
  return Object.freeze({
    schema_version: GATE_VERSION,
    gate: name,
    description: definition.description,
    status: ready ? 'ready' : 'awaiting_external_evidence',
    ready,
    requirements: Object.freeze([...all, ...any]),
    missing: Object.freeze([...all, ...any].filter((item) => !item.pass)),
    logic: Object.freeze({ all_required: all.length, any_required: any.length }),
  });
}

function evaluatePortfolio(evidence = {}) {
  const unknown = Object.keys(evidence).filter((name) => !DEFINITIONS[name]);
  if (unknown.length > 0) throw new Error(`Unknown milestone evidence: ${unknown.join(', ')}`);
  const gates = Object.keys(DEFINITIONS).map((name) => evaluateGate(name, evidence[name] || {}));
  return Object.freeze({
    schema_version: GATE_VERSION,
    status: gates.every((gate) => gate.ready) ? 'ready' : 'awaiting_external_evidence',
    ready_count: gates.filter((gate) => gate.ready).length,
    gate_count: gates.length,
    gates: Object.freeze(gates),
  });
}

module.exports = Object.freeze({ DEFINITIONS, GATE_VERSION, evaluateGate, evaluatePortfolio });

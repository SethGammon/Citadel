#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const reliability = require('../core/reliability');
const cli = require('./reliability-analyze');

function hex(value, width = 16) {
  return value.toString(16).padStart(width, '0');
}

function record(index, overrides = {}) {
  const heldOut = index >= 80;
  const mode = index % 5 === 0 ? 'parallel' : 'sequential';
  const sequentialPass = index % 10 !== 1;
  const parallelPass = index % 3 !== 0;
  const passed = mode === 'sequential' ? sequentialPass : parallelPass;
  return {
    schema: 1,
    kind: 'reliability_run',
    run_id: `run-${hex(index + 1)}`,
    repo_id: `repo-${hex((index % 20) + 1)}`,
    runtime: index % 2 === 0 ? 'codex' : 'claude-code',
    workload_class: ['verify', 'repair', 'migrate', 'release'][index % 4],
    execution_mode: mode,
    complexity: ['low', 'medium', 'high'][index % 3],
    outcome: passed ? 'passed' : 'failed',
    verified: passed,
    human_interventions: mode === 'sequential' ? 1 : 3,
    duration_ms: mode === 'sequential' ? 1000 : 800,
    estimated_cost_microusd: mode === 'sequential' ? 5000 : 9000,
    resumed: index % 4 === 0,
    held_out: heldOut,
    ...overrides,
  };
}

function sufficientFixture() {
  return Array.from({ length: 100 }, (_, index) => record(index));
}

assert.deepEqual(sufficientFixture(), sufficientFixture(), 'fixture must be deterministic');
const fixture = sufficientFixture();
fixture.forEach((item) => assert.deepEqual(reliability.validateRecord(item), []));

for (const forbidden of ['repo_name', 'prompt', 'source_code', 'path', 'secret', 'token', 'url']) {
  assert.match(reliability.validateRecord({ ...fixture[0], [forbidden]: 'private' }).join('; '), /privacy-safe allowlist/);
}
assert.match(reliability.validateRecord({ ...fixture[0], repo_id: 'repo-my-company' }).join('; '), /opaque hexadecimal/);
assert.match(reliability.validateRecord({ ...fixture[0], run_id: 'run-project-name' }).join('; '), /opaque hexadecimal/);
assert.match(reliability.validateRecord({ ...fixture[0], outcome: 'failed', verified: true }).join('; '), /only for passed/);

for (const insufficient of [
  fixture.slice(0, 99),
  fixture.map((item) => ({ ...item, repo_id: `repo-${hex((Number.parseInt(item.repo_id.slice(5), 16) % 19) + 1)}` })),
  fixture.map((item) => ({ ...item, runtime: 'codex' })),
  fixture.map((item, index) => ({ ...item, held_out: index >= 81 })),
]) {
  const report = reliability.analyze(insufficient);
  assert.equal(report.status, 'unknown');
  assert.equal(report.recommendation, null);
  assert.equal(report.auto_apply, false);
}

const report = reliability.analyze(fixture);
assert.equal(report.status, 'available');
assert.equal(report.sufficiency.passed, true);
assert.equal(report.sufficiency.gates.runs.actual, 100);
assert.equal(report.sufficiency.gates.repositories.actual, 20);
assert.equal(report.sufficiency.gates.runtimes.actual, 2);
assert.equal(report.sufficiency.gates.held_out_runs.actual, 20);
assert.equal(report.recommendation.kind, 'execution_mode');
assert.equal(report.recommendation.value, 'sequential');
assert.equal(report.recommendation.evidence.training_runs, 80);
assert.equal(report.recommendation.evidence.held_out_runs, 20);
assert.equal(report.recommendation.evidence.opaque_repository_count, 20);
assert(report.recommendation.evidence.selected_training.runs > 0);
assert(report.recommendation.evidence.selected_held_out.runs > 0);
assert(['low', 'medium', 'high'].includes(report.recommendation.confidence.level));
assert(Number.isFinite(report.recommendation.confidence.score));
assert.equal(report.auto_apply, false);
assert(!JSON.stringify(report).includes('repo-0000000000000001'), 'report must not expose opaque repository IDs');

const shuffled = [...fixture].reverse();
assert.deepEqual(reliability.analyze(shuffled), report, 'analysis must be order independent');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-reliability-'));
const input = path.join(temp, 'runs.jsonl');
const output = path.join(temp, 'report.json');
fs.writeFileSync(input, `${fixture.map((item) => JSON.stringify(item)).join('\n')}\n`);
const result = cli.run(['--input', input, '--output', output, '--require-sufficient']);
assert.equal(result.status, 0);
assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), report);

const shortInput = path.join(temp, 'short.jsonl');
fs.writeFileSync(shortInput, `${fixture.slice(0, 10).map((item) => JSON.stringify(item)).join('\n')}\n`);
const short = cli.run(['--input', shortInput, '--require-sufficient']);
assert.equal(short.status, 2);
assert.equal(short.report.status, 'unknown');

assert.throws(() => reliability.parseJsonl(`${JSON.stringify(fixture[0])}\n${JSON.stringify(fixture[0])}\n`), /Duplicate/);
assert.throws(() => reliability.parseJsonl('{not-json}\n'), /line 1/);
fs.rmSync(temp, { recursive: true, force: true });

process.stdout.write('Reliability learning tests passed: 100 runs, 20 opaque repositories, 2 runtimes, 20 held-out runs.\n');

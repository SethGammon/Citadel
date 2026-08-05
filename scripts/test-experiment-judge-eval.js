#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const judgeEval = require('./experiment-judge-eval');

const ROOT = path.resolve(__dirname, '..');
const PROMPTS = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments', 'judge-eval', 'prompts.json');
const LABELS = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments', 'judge-eval', 'labels.json');
let passed = 0;

function test(name, action) {
  try {
    action();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeOutput({ arm, plan, corpus, labels, identity, trialCount = 3, decide, statusFor = () => 'observed' }) {
  const gold = new Map(labels.labels.map((entry) => [entry.case_id, entry.gold_verdict]));
  const trials = [];
  for (let trial = 1; trial <= trialCount; trial += 1) {
    for (const entry of corpus.cases) {
      const outputStatus = statusFor(entry, trial);
      const verdict = outputStatus === 'observed' ? decide(entry, gold.get(entry.id), trial) : 'unknown';
      trials.push(judgeEval.sealTrial({
        case_id: entry.id,
        trial,
        output_status: outputStatus,
        verdict,
        started_at: '2026-08-04T12:10:00.000Z',
        completed_at: '2026-08-04T12:10:00.100Z',
        latency_ms: outputStatus === 'missing' ? null : 100,
        cost_usd: outputStatus === 'missing' ? null : 0,
        response_digest: outputStatus === 'missing' ? null : judgeEval.digest({ arm, case_id: entry.id, trial, verdict, outputStatus }),
      }));
    }
  }
  return judgeEval.sealJudgeOutput({
    schema: 1,
    kind: 'citadel_judge_eval_outputs',
    instrument_version: 1,
    arm,
    corpus_id: corpus.corpus_id,
    prompt_bundle_receipt: plan.bundle_receipts[arm],
    source_transcript_digest: judgeEval.digest({ source: 'synthetic-test-only', arm }),
    judge_identity: identity,
    started_at: '2026-08-04T12:10:00.000Z',
    completed_at: '2026-08-04T12:20:00.000Z',
    trial_count: trialCount,
    trials,
  });
}

function setup() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-judge-eval-'));
  const plan = judgeEval.plan({ output, prompts: PROMPTS, labels: LABELS });
  return { output, plan, corpus: readJson(PROMPTS), labels: readJson(LABELS) };
}

const directories = [];
try {
  const base = setup();
  directories.push(base.output);

  test('plan emits eight receipt-bound blinded prompts with labels kept separate', () => {
    assert.equal(base.plan.case_count, 8);
    const control = readJson(path.join(base.output, judgeEval.FILES.controlPrompts));
    const treatment = readJson(path.join(base.output, judgeEval.FILES.treatmentPrompts));
    assert.equal(control.cases.length, 8);
    assert.equal(treatment.cases.length, 8);
    const blinded = JSON.stringify({ plan: base.plan, control, treatment });
    for (const label of base.labels.labels) {
      assert(!blinded.includes(label.private_marker));
      assert(!blinded.includes(label.gold_reason));
    }
    assert(!blinded.includes('gold_verdict'));
  });

  test('report without judge outputs stays instrument-only and externally blocked', () => {
    const result = judgeEval.report({ output: base.output, prompts: PROMPTS, labels: LABELS });
    assert.equal(result.observation_status, 'not_run');
    assert.equal(result.claim_status, 'instrument_only');
    assert.equal(result.promotion_status, 'blocked_external');
    assert.equal(result.metrics.control.false_accept.rate, null);
    assert.equal(judgeEval.verify({ output: base.output, prompts: PROMPTS, labels: LABELS }).instrument_status, 'passed');
  });

  test('seal adapter binds readable reasons and identity into strict one-trial output', () => {
    const transcript = {
      schema: 1,
      kind: 'citadel_judge_eval_simple_transcript',
      judge_identity: {
        provider: 'local', model: 'actual-proxy-v1', model_family: 'proxy-family',
        runtime: 'codex-thread', runtime_version: '2026-08-04',
        calibration_status: 'uncalibrated', capability_class: 'unverified',
      },
      started_at: '2026-08-04T12:01:00.000Z',
      completed_at: '2026-08-04T12:02:00.000Z',
      results: base.corpus.cases.map((entry) => ({ case_id: entry.id, verdict: 'unknown', reason: `Observed reason for ${entry.id}` })),
    };
    const input = path.join(base.output, 'simple-control.json');
    const sealedFile = path.join(base.output, 'sealed-control.json');
    writeJson(input, transcript);
    const sealed = judgeEval.seal({ evidence: base.output, output: sealedFile, prompts: PROMPTS, labels: LABELS, arm: 'control', input });
    assert.equal(sealed.trial_count, 1);
    assert.equal(sealed.trials.length, 8);
    assert(/^sha256:[a-f0-9]{64}$/.test(sealed.source_transcript_digest));
    assert(!JSON.stringify(sealed).includes('Observed reason for'));
    assert(fs.readFileSync(input, 'utf8').includes('Observed reason for'));
  });

  test('proxy ingestion reports confusion, false decisions, pass@1, pass^3, latency, and cost without promotion', () => {
    const identity = {
      provider: 'local', model: 'fixture-proxy-v1', model_family: 'fixture-family',
      runtime: 'node-test-adapter', runtime_version: process.version,
      calibration_status: 'uncalibrated', capability_class: 'unverified',
    };
    const control = makeOutput({
      ...base, arm: 'control', identity,
      decide: () => 'accept',
    });
    const treatment = makeOutput({
      ...base, arm: 'treatment', identity,
      decide: (_entry, gold) => gold,
    });
    const controlFile = path.join(base.output, 'control-output.json');
    const treatmentFile = path.join(base.output, 'treatment-output.json');
    writeJson(controlFile, control);
    writeJson(treatmentFile, treatment);
    const result = judgeEval.ingest({ output: base.output, prompts: PROMPTS, labels: LABELS, control: controlFile, treatment: treatmentFile });
    assert.equal(result.metrics.control.false_accept.rate, 1);
    assert.equal(result.metrics.treatment.false_accept.rate, 0);
    assert.equal(result.metrics.treatment.false_block.rate, 0);
    assert.equal(result.metrics.treatment.pass_at_1, 1);
    assert.equal(result.metrics.treatment.pass_pow_3, 1);
    assert.equal(result.metrics.treatment.latency_ms.mean, 100);
    assert.equal(result.metrics.treatment.cost_usd.total, 0);
    assert.equal(result.claim_status, 'instrument_only');
    assert.equal(result.promotion_status, 'blocked_external');
  });

  test('missing and malformed judge responses are preserved as unknown', () => {
    const isolated = setup();
    directories.push(isolated.output);
    const identity = {
      provider: 'local', model: 'fixture-proxy-v1', model_family: 'fixture-family',
      runtime: 'node-test-adapter', runtime_version: process.version,
      calibration_status: 'uncalibrated', capability_class: 'unverified',
    };
    const control = makeOutput({
      ...isolated, arm: 'control', identity, trialCount: 1,
      decide: (_entry, gold) => gold,
      statusFor: (entry) => entry.id === 'clean-hook-fix' ? 'missing' : 'observed',
    });
    const treatment = makeOutput({
      ...isolated, arm: 'treatment', identity, trialCount: 1,
      decide: (_entry, gold) => gold,
      statusFor: (entry) => entry.id === 'green-wrong-security' ? 'malformed' : 'observed',
    });
    const controlFile = path.join(isolated.output, 'control-output.json');
    const treatmentFile = path.join(isolated.output, 'treatment-output.json');
    writeJson(controlFile, control);
    writeJson(treatmentFile, treatment);
    const result = judgeEval.ingest({ output: isolated.output, prompts: PROMPTS, labels: LABELS, control: controlFile, treatment: treatmentFile });
    assert.equal(result.metrics.control.confusion_matrix.accept.unknown, 1);
    assert.equal(result.metrics.treatment.confusion_matrix.block.unknown, 1);
    assert.equal(result.metrics.control.pass_pow_3, null);
    assert.equal(result.metrics.treatment.pass_pow_3, null);
    assert.equal(result.external_promotion_gates.all_outputs_observed, false);
  });

  test('tampered receipts and aggregate reports fail verification', () => {
    const ingestPath = path.join(base.output, judgeEval.FILES.ingest);
    const originalIngest = fs.readFileSync(ingestPath, 'utf8');
    const changed = JSON.parse(originalIngest);
    changed.treatment.trials[0].verdict = 'block';
    writeJson(ingestPath, changed);
    assert.throws(() => judgeEval.verify({ output: base.output, prompts: PROMPTS, labels: LABELS }), /receipt digest mismatch/);
    fs.writeFileSync(ingestPath, originalIngest, 'utf8');
    const resultsPath = path.join(base.output, judgeEval.FILES.results);
    const originalResults = fs.readFileSync(resultsPath, 'utf8');
    const changedResults = JSON.parse(originalResults);
    changedResults.metrics.treatment.false_accept.rate = 0.5;
    writeJson(resultsPath, changedResults);
    assert.throws(() => judgeEval.verify({ output: base.output, prompts: PROMPTS, labels: LABELS }), /results differ/);
    fs.writeFileSync(resultsPath, originalResults, 'utf8');
  });

  test('strict output schema rejects extra fields and unknown conversion', () => {
    const plan = base.plan;
    const identity = {
      provider: 'local', model: 'fixture-proxy-v1', model_family: 'fixture-family',
      runtime: 'node-test-adapter', runtime_version: process.version,
      calibration_status: 'uncalibrated', capability_class: 'unverified',
    };
    const output = makeOutput({ ...base, arm: 'control', plan, identity, trialCount: 1, decide: (_entry, gold) => gold });
    output.extra = true;
    assert.throws(() => judgeEval.validateJudgeOutput(output, plan, base.corpus, 'control'), /fields changed/);
    delete output.extra;
    output.trials[0] = judgeEval.sealTrial({ ...output.trials[0], output_status: 'missing', verdict: 'accept', response_digest: null, receipt_digest: undefined });
    output.receipt_digest = judgeEval.digest(Object.fromEntries(Object.entries(output).filter(([key]) => key !== 'receipt_digest')));
    assert.throws(() => judgeEval.validateJudgeOutput(output, plan, base.corpus, 'control'), /must remain unknown/);
  });

  test('private gold markers injected into prompts are rejected as label leakage', () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-judge-leak-'));
    directories.push(isolated);
    const promptCopy = path.join(isolated, 'prompts.json');
    const labelCopy = path.join(isolated, 'labels.json');
    const changed = readJson(PROMPTS);
    changed.cases[0].control_evidence.handoff += ` ${base.labels.labels[0].private_marker}`;
    writeJson(promptCopy, changed);
    fs.copyFileSync(LABELS, labelCopy);
    assert.throws(() => judgeEval.plan({ output: path.join(isolated, 'out'), prompts: promptCopy, labels: labelCopy }), /label leak/);
  });
} finally {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
}

if (!process.exitCode) process.stdout.write(`\n${passed}/8 JudgeEval tests passed.\n`);

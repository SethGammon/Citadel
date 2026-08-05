#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CORPUS = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments', 'judge-eval', 'prompts.json');
const DEFAULT_LABELS = path.join(ROOT, 'benchmarks', 'citadel-proof-experiments', 'judge-eval', 'labels.json');
const DEFAULT_OUTPUT = path.join(ROOT, '.planning', 'research', 'citadel-proof-experiments');
const VERSION = 1;
const VERDICTS = Object.freeze(['accept', 'block', 'unknown']);
const OUTPUT_STATUSES = Object.freeze(['observed', 'missing', 'malformed']);
const CALIBRATION_STATUSES = Object.freeze(['human_calibrated', 'uncalibrated']);
const CAPABILITY_CLASSES = Object.freeze(['strong', 'unverified']);
const CATEGORIES = Object.freeze([
  'clean',
  'mechanical_failure',
  'green_wrong_architecture',
  'green_wrong_state',
  'green_wrong_security',
  'incomplete',
  'ambiguous',
]);
const FILES = Object.freeze({
  plan: 'judge-eval-plan.json',
  controlPrompts: 'judge-eval-control-prompts.json',
  treatmentPrompts: 'judge-eval-treatment-prompts.json',
  ingest: 'judge-eval-ingest.json',
  results: 'judge-eval-results.json',
  report: 'judge-eval-report.md',
});

function fail(message) {
  throw new Error(message);
}

function ensure(condition, message) {
  if (!condition) fail(message);
}

function exactKeys(value, keys, label) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepStrictEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields changed`);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256Text(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function digest(value) {
  return sha256Text(JSON.stringify(stable(value)));
}

function fileDigest(file) {
  return sha256Text(fs.readFileSync(file));
}

function validDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function validTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read JSON ${file}: ${error.message}`);
  }
}

function writeIfChanged(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.writeFileSync(file, text, 'utf8');
  return true;
}

function writeJson(file, value) {
  return writeIfChanged(file, `${JSON.stringify(value, null, 2)}\n`);
}

function validatePromptCorpus(corpus) {
  exactKeys(corpus, ['schema', 'kind', 'corpus_id', 'created_at', 'rubric_version', 'shared_rubric', 'cases'], 'prompt corpus');
  ensure(corpus.schema === 1, 'prompt corpus schema must be 1');
  ensure(corpus.kind === 'citadel_judge_eval_prompt_corpus', 'prompt corpus kind is invalid');
  ensure(typeof corpus.corpus_id === 'string' && corpus.corpus_id.length > 5, 'prompt corpus id is required');
  ensure(validTimestamp(corpus.created_at), 'prompt corpus created_at must be an ISO timestamp');
  ensure(typeof corpus.rubric_version === 'string' && corpus.rubric_version.length > 5, 'rubric version is required');
  ensure(Array.isArray(corpus.shared_rubric) && corpus.shared_rubric.length >= 3, 'shared rubric is incomplete');
  corpus.shared_rubric.forEach((entry, index) => ensure(typeof entry === 'string' && entry.length > 10, `rubric ${index} is invalid`));
  ensure(Array.isArray(corpus.cases) && corpus.cases.length >= 8 && corpus.cases.length <= 12, 'prompt corpus must contain 8-12 cases');
  const ids = new Set();
  for (const entry of corpus.cases) {
    exactKeys(entry, ['id', 'category', 'difficulty', 'task', 'control_evidence', 'treatment_evidence'], `prompt case ${entry && entry.id}`);
    ensure(typeof entry.id === 'string' && /^[a-z0-9-]+$/.test(entry.id), 'case id is invalid');
    ensure(!ids.has(entry.id), `duplicate prompt case ${entry.id}`);
    ids.add(entry.id);
    ensure(CATEGORIES.includes(entry.category), `${entry.id}: category is invalid`);
    ensure(['obvious', 'subtle', 'ambiguous'].includes(entry.difficulty), `${entry.id}: difficulty is invalid`);
    ensure(typeof entry.task === 'string' && entry.task.length > 40, `${entry.id}: task is incomplete`);
    exactKeys(entry.control_evidence, ['handoff'], `${entry.id} control evidence`);
    ensure(typeof entry.control_evidence.handoff === 'string' && entry.control_evidence.handoff.length > 30, `${entry.id}: HANDOFF is incomplete`);
    exactKeys(entry.treatment_evidence, ['deterministic_gates', 'diff', 'state_receipts'], `${entry.id} treatment evidence`);
    ensure(Array.isArray(entry.treatment_evidence.deterministic_gates) && entry.treatment_evidence.deterministic_gates.length > 0, `${entry.id}: gates are required`);
    ensure(typeof entry.treatment_evidence.diff === 'string' && entry.treatment_evidence.diff.length > 30, `${entry.id}: diff is required`);
    ensure(Array.isArray(entry.treatment_evidence.state_receipts) && entry.treatment_evidence.state_receipts.length > 0, `${entry.id}: state receipts are required`);
  }
  for (const category of CATEGORIES) ensure(corpus.cases.some((entry) => entry.category === category), `prompt corpus is missing ${category}`);
  ensure(corpus.cases.filter((entry) => entry.category === 'clean').length >= 1, 'prompt corpus needs a clean case');
  return corpus;
}

function labelReviewProjection(labels) {
  return {
    corpus_id: labels.corpus_id,
    labels: labels.labels,
    reviewer_id: labels.provenance.reviewer_id,
    reviewed_at: labels.provenance.reviewed_at,
  };
}

function validateLabels(labels, corpus) {
  exactKeys(labels, ['schema', 'kind', 'corpus_id', 'provenance', 'labels'], 'gold labels');
  ensure(labels.schema === 1, 'gold label schema must be 1');
  ensure(labels.kind === 'citadel_judge_eval_gold_labels', 'gold label kind is invalid');
  ensure(labels.corpus_id === corpus.corpus_id, 'gold labels target a different corpus');
  exactKeys(labels.provenance, ['status', 'reviewer_id', 'reviewed_at', 'review_receipt_digest'], 'label provenance');
  ensure(['seeded_unreviewed', 'human_calibrated'].includes(labels.provenance.status), 'label provenance status is invalid');
  if (labels.provenance.status === 'human_calibrated') {
    ensure(typeof labels.provenance.reviewer_id === 'string' && labels.provenance.reviewer_id.length > 2, 'human calibration requires reviewer_id');
    ensure(validTimestamp(labels.provenance.reviewed_at), 'human calibration requires reviewed_at');
    ensure(labels.provenance.review_receipt_digest === digest(labelReviewProjection(labels)), 'label review receipt digest mismatch');
  } else {
    ensure(labels.provenance.reviewer_id === null, 'seeded labels cannot name a reviewer');
    ensure(labels.provenance.reviewed_at === null, 'seeded labels cannot claim review time');
    ensure(labels.provenance.review_receipt_digest === null, 'seeded labels cannot claim a review receipt');
  }
  ensure(Array.isArray(labels.labels) && labels.labels.length === corpus.cases.length, 'gold labels must cover every prompt exactly once');
  const expected = new Set(corpus.cases.map((entry) => entry.id));
  const seen = new Set();
  for (const label of labels.labels) {
    exactKeys(label, ['case_id', 'gold_verdict', 'gold_reason', 'private_marker'], `gold label ${label && label.case_id}`);
    ensure(expected.has(label.case_id), `gold label has unknown case ${label.case_id}`);
    ensure(!seen.has(label.case_id), `duplicate gold label ${label.case_id}`);
    seen.add(label.case_id);
    ensure(VERDICTS.includes(label.gold_verdict), `${label.case_id}: gold verdict is invalid`);
    ensure(typeof label.gold_reason === 'string' && label.gold_reason.length > 30, `${label.case_id}: gold reason is incomplete`);
    ensure(typeof label.private_marker === 'string' && /^gold-[a-z0-9-]+$/.test(label.private_marker), `${label.case_id}: private marker is invalid`);
  }
  return labels;
}

function assertNoLabelLeak(corpus, labels, extraValues = []) {
  const texts = [JSON.stringify(corpus), ...extraValues.map((entry) => JSON.stringify(entry))];
  for (const text of texts) {
    for (const forbidden of ['gold_verdict', 'gold_reason', 'private_marker']) {
      ensure(!text.includes(`\"${forbidden}\"`), `label leak: ${forbidden} appears in blinded prompts`);
    }
    for (const label of labels.labels) {
      ensure(!text.includes(label.private_marker), `label leak: private marker for ${label.case_id}`);
      ensure(!text.includes(label.gold_reason), `label leak: gold reason for ${label.case_id}`);
    }
  }
}

function promptText(corpus, testCase, arm) {
  const evidence = arm === 'control'
    ? { handoff: testCase.control_evidence.handoff }
    : testCase.treatment_evidence;
  const armInstruction = arm === 'control'
    ? 'Judge only the blinded prose HANDOFF. Do not infer a hidden diff, gate run, or receipt.'
    : 'Judge the available deterministic gate evidence, diff facts, and state receipts before deciding.';
  return [
    `Rubric ${corpus.rubric_version}:`,
    ...corpus.shared_rubric.map((entry) => `- ${entry}`),
    `Arm: ${arm}`,
    armInstruction,
    `Case: ${testCase.id}`,
    `Task: ${testCase.task}`,
    `Evidence:\n${JSON.stringify(evidence, null, 2)}`,
    'Respond as JSON with only: {"verdict":"accept|block|unknown"}.',
  ].join('\n');
}

function bundleProjection(bundle) {
  const copy = { ...bundle };
  delete copy.receipt_digest;
  return copy;
}

function buildPromptBundle(corpus, arm) {
  const bundle = {
    schema: 1,
    kind: 'citadel_judge_eval_blinded_prompts',
    instrument_version: VERSION,
    arm,
    corpus_id: corpus.corpus_id,
    created_at: corpus.created_at,
    rubric_version: corpus.rubric_version,
    cases: corpus.cases.map((entry) => {
      const prompt = promptText(corpus, entry, arm);
      return { case_id: entry.id, prompt, prompt_sha256: sha256Text(prompt) };
    }),
  };
  bundle.receipt_digest = digest(bundleProjection(bundle));
  return bundle;
}

function validatePromptBundle(bundle, corpus, arm) {
  exactKeys(bundle, ['schema', 'kind', 'instrument_version', 'arm', 'corpus_id', 'created_at', 'rubric_version', 'cases', 'receipt_digest'], `${arm} prompt bundle`);
  ensure(bundle.schema === 1 && bundle.instrument_version === VERSION, `${arm} prompt bundle version is invalid`);
  ensure(bundle.kind === 'citadel_judge_eval_blinded_prompts', `${arm} prompt bundle kind is invalid`);
  ensure(bundle.arm === arm, `${arm} prompt bundle arm changed`);
  ensure(bundle.corpus_id === corpus.corpus_id, `${arm} prompt bundle corpus changed`);
  ensure(bundle.created_at === corpus.created_at && bundle.rubric_version === corpus.rubric_version, `${arm} prompt bundle metadata changed`);
  const expected = buildPromptBundle(corpus, arm);
  ensure(JSON.stringify(bundle.cases) === JSON.stringify(expected.cases), `${arm} blinded prompts differ from corpus projection`);
  ensure(bundle.receipt_digest === digest(bundleProjection(bundle)), `${arm} prompt bundle receipt mismatch`);
  return bundle;
}

function planProjection(plan) {
  const copy = { ...plan };
  delete copy.receipt_digest;
  return copy;
}

function buildPlanArtifacts(corpus, promptSourceSha256) {
  const control = buildPromptBundle(corpus, 'control');
  const treatment = buildPromptBundle(corpus, 'treatment');
  const plan = {
    schema: 1,
    kind: 'citadel_judge_eval_plan',
    instrument_version: VERSION,
    created_at: corpus.created_at,
    corpus_id: corpus.corpus_id,
    rubric_version: corpus.rubric_version,
    case_count: corpus.cases.length,
    categories: [...new Set(corpus.cases.map((entry) => entry.category))].sort(),
    prompt_source_sha256: promptSourceSha256,
    prompt_bundles: { control: FILES.controlPrompts, treatment: FILES.treatmentPrompts },
    bundle_receipts: { control: control.receipt_digest, treatment: treatment.receipt_digest },
    output_contract: {
      verdicts: VERDICTS,
      output_statuses: OUTPUT_STATUSES,
      supported_trial_counts: [1, 3],
      missing_or_malformed_rule: 'output_status missing or malformed requires verdict unknown',
    },
    claim_boundary: {
      local_result: 'instrument_only',
      promotion_status: 'blocked_external',
      requires: ['human-calibrated labels', 'two pinned strong model families', 'three trials per case', 'provider receipts', 'all metric gates'],
    },
  };
  plan.receipt_digest = digest(planProjection(plan));
  return { plan, control, treatment };
}

function paths(options = {}) {
  const output = path.resolve(options.output || DEFAULT_OUTPUT);
  return {
    output,
    promptPath: path.resolve(options.prompts || DEFAULT_CORPUS),
    labelPath: path.resolve(options.labels || DEFAULT_LABELS),
    ...Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, path.join(output, name)])),
  };
}

function loadCorpus(options = {}) {
  const target = paths(options);
  const corpus = validatePromptCorpus(readJson(target.promptPath));
  const labels = validateLabels(readJson(target.labelPath), corpus);
  assertNoLabelLeak(corpus, labels);
  return { target, corpus, labels };
}

function plan(options = {}) {
  const { target, corpus, labels } = loadCorpus(options);
  const artifacts = buildPlanArtifacts(corpus, fileDigest(target.promptPath));
  assertNoLabelLeak(corpus, labels, [artifacts.control, artifacts.treatment, artifacts.plan]);
  writeJson(target.controlPrompts, artifacts.control);
  writeJson(target.treatmentPrompts, artifacts.treatment);
  writeJson(target.plan, artifacts.plan);
  return artifacts.plan;
}

function trialProjection(trial) {
  const copy = { ...trial };
  delete copy.receipt_digest;
  return copy;
}

function outputProjection(output) {
  const copy = { ...output };
  delete copy.receipt_digest;
  return copy;
}

function sealTrial(trial) {
  const sealed = { ...trial };
  sealed.receipt_digest = digest(trialProjection(sealed));
  return sealed;
}

function sealJudgeOutput(output) {
  const sealed = { ...output, trials: output.trials.map((trial) => validDigest(trial.receipt_digest) ? trial : sealTrial(trial)) };
  sealed.receipt_digest = digest(outputProjection(sealed));
  return sealed;
}

function validateIdentity(identity, label) {
  exactKeys(identity, ['provider', 'model', 'model_family', 'runtime', 'runtime_version', 'calibration_status', 'capability_class'], `${label} identity`);
  for (const field of ['provider', 'model', 'model_family', 'runtime', 'runtime_version']) {
    ensure(typeof identity[field] === 'string' && identity[field].trim().length > 0, `${label} identity ${field} is required`);
  }
  ensure(CALIBRATION_STATUSES.includes(identity.calibration_status), `${label} calibration status is invalid`);
  ensure(CAPABILITY_CLASSES.includes(identity.capability_class), `${label} capability class is invalid`);
}

function validateTrial(trial, label) {
  exactKeys(trial, ['case_id', 'trial', 'output_status', 'verdict', 'started_at', 'completed_at', 'latency_ms', 'cost_usd', 'response_digest', 'receipt_digest'], label);
  ensure(typeof trial.case_id === 'string', `${label} case_id is required`);
  ensure(Number.isInteger(trial.trial) && trial.trial > 0, `${label} trial number is invalid`);
  ensure(OUTPUT_STATUSES.includes(trial.output_status), `${label} output status is invalid`);
  ensure(VERDICTS.includes(trial.verdict), `${label} verdict is invalid`);
  ensure(validTimestamp(trial.started_at) && validTimestamp(trial.completed_at), `${label} timestamps are invalid`);
  ensure(Date.parse(trial.completed_at) >= Date.parse(trial.started_at), `${label} timestamps are reversed`);
  if (trial.output_status === 'observed') {
    ensure(trial.verdict !== 'unknown' || validDigest(trial.response_digest), `${label} observed unknown needs a response digest`);
    ensure(validDigest(trial.response_digest), `${label} observed output needs response_digest`);
  } else {
    ensure(trial.verdict === 'unknown', `${label} ${trial.output_status} output must remain unknown`);
    ensure(trial.output_status !== 'malformed' || validDigest(trial.response_digest), `${label} malformed output needs response_digest`);
    ensure(trial.output_status !== 'missing' || trial.response_digest === null, `${label} missing output cannot have response_digest`);
  }
  for (const field of ['latency_ms', 'cost_usd']) {
    ensure(trial[field] === null || (typeof trial[field] === 'number' && Number.isFinite(trial[field]) && trial[field] >= 0), `${label} ${field} is invalid`);
  }
  ensure(trial.receipt_digest === digest(trialProjection(trial)), `${label} receipt digest mismatch`);
}

function validateJudgeOutput(output, planArtifact, corpus, arm) {
  exactKeys(output, ['schema', 'kind', 'instrument_version', 'arm', 'corpus_id', 'prompt_bundle_receipt', 'source_transcript_digest', 'judge_identity', 'started_at', 'completed_at', 'trial_count', 'trials', 'receipt_digest'], `${arm} judge output`);
  ensure(output.schema === 1 && output.instrument_version === VERSION, `${arm} output version is invalid`);
  ensure(output.kind === 'citadel_judge_eval_outputs', `${arm} output kind is invalid`);
  ensure(output.arm === arm && output.corpus_id === corpus.corpus_id, `${arm} output target changed`);
  ensure(output.prompt_bundle_receipt === planArtifact.bundle_receipts[arm], `${arm} output is not bound to the planned prompts`);
  ensure(validDigest(output.source_transcript_digest), `${arm} output source transcript digest is invalid`);
  validateIdentity(output.judge_identity, arm);
  ensure(validTimestamp(output.started_at) && validTimestamp(output.completed_at), `${arm} output timestamps are invalid`);
  ensure(Date.parse(output.completed_at) >= Date.parse(output.started_at), `${arm} output timestamps are reversed`);
  ensure([1, 3].includes(output.trial_count), `${arm} trial_count must be 1 or 3`);
  ensure(Array.isArray(output.trials), `${arm} trials must be an array`);
  const expected = new Set();
  for (let trial = 1; trial <= output.trial_count; trial += 1) {
    for (const entry of corpus.cases) expected.add(`${entry.id}:${trial}`);
  }
  ensure(output.trials.length === expected.size, `${arm} output must explicitly cover every case and trial`);
  for (const entry of output.trials) {
    validateTrial(entry, `${arm} ${entry && entry.case_id} trial`);
    const key = `${entry.case_id}:${entry.trial}`;
    ensure(expected.has(key), `${arm} has duplicate or unexpected trial ${key}`);
    expected.delete(key);
  }
  ensure(expected.size === 0, `${arm} output has missing trials`);
  ensure(output.receipt_digest === digest(outputProjection(output)), `${arm} output receipt digest mismatch`);
  return output;
}

function validateSimpleTranscript(transcript, corpus) {
  exactKeys(transcript, ['schema', 'kind', 'judge_identity', 'started_at', 'completed_at', 'results'], 'simple judge transcript');
  ensure(transcript.schema === 1, 'simple transcript schema must be 1');
  ensure(transcript.kind === 'citadel_judge_eval_simple_transcript', 'simple transcript kind is invalid');
  validateIdentity(transcript.judge_identity, 'simple transcript');
  ensure(validTimestamp(transcript.started_at) && validTimestamp(transcript.completed_at), 'simple transcript timestamps are invalid');
  ensure(Date.parse(transcript.completed_at) >= Date.parse(transcript.started_at), 'simple transcript timestamps are reversed');
  ensure(Array.isArray(transcript.results) && transcript.results.length === corpus.cases.length, 'simple transcript must contain one result per case');
  const expected = new Set(corpus.cases.map((entry) => entry.id));
  for (const result of transcript.results) {
    exactKeys(result, ['case_id', 'verdict', 'reason'], `simple result ${result && result.case_id}`);
    ensure(expected.has(result.case_id), `simple transcript has duplicate or unexpected case ${result.case_id}`);
    expected.delete(result.case_id);
    ensure(VERDICTS.includes(result.verdict), `${result.case_id}: simple transcript verdict is invalid`);
    ensure(typeof result.reason === 'string' && result.reason.trim().length > 0, `${result.case_id}: simple transcript reason is required`);
  }
  ensure(expected.size === 0, 'simple transcript is missing cases');
  return transcript;
}

function seal(options = {}) {
  ensure(['control', 'treatment'].includes(options.arm), 'seal requires --arm control or --arm treatment');
  ensure(options.input && options.output, 'seal requires --input FILE and --output FILE');
  const loaded = loadPlanArtifacts({ ...options, output: options.evidence || DEFAULT_OUTPUT });
  const input = path.resolve(options.input);
  const transcript = validateSimpleTranscript(readJson(input), loaded.corpus);
  const trials = transcript.results.map((result) => sealTrial({
    case_id: result.case_id,
    trial: 1,
    output_status: 'observed',
    verdict: result.verdict,
    started_at: transcript.started_at,
    completed_at: transcript.completed_at,
    latency_ms: null,
    cost_usd: null,
    response_digest: digest({ verdict: result.verdict, reason: result.reason }),
  }));
  const output = sealJudgeOutput({
    schema: 1,
    kind: 'citadel_judge_eval_outputs',
    instrument_version: VERSION,
    arm: options.arm,
    corpus_id: loaded.corpus.corpus_id,
    prompt_bundle_receipt: loaded.planArtifact.bundle_receipts[options.arm],
    source_transcript_digest: fileDigest(input),
    judge_identity: transcript.judge_identity,
    started_at: transcript.started_at,
    completed_at: transcript.completed_at,
    trial_count: 1,
    trials,
  });
  validateJudgeOutput(output, loaded.planArtifact, loaded.corpus, options.arm);
  writeJson(path.resolve(options.output), output);
  return output;
}

function ingestProjection(ingestArtifact) {
  const copy = { ...ingestArtifact };
  delete copy.receipt_digest;
  return copy;
}

function buildIngest(planArtifact, control, treatment) {
  const ingestArtifact = {
    schema: 1,
    kind: 'citadel_judge_eval_ingest',
    instrument_version: VERSION,
    created_at: [control.completed_at, treatment.completed_at].sort().at(-1),
    plan_receipt_digest: planArtifact.receipt_digest,
    control,
    treatment,
  };
  ingestArtifact.receipt_digest = digest(ingestProjection(ingestArtifact));
  return ingestArtifact;
}

function validateIngest(ingestArtifact, planArtifact, corpus) {
  exactKeys(ingestArtifact, ['schema', 'kind', 'instrument_version', 'created_at', 'plan_receipt_digest', 'control', 'treatment', 'receipt_digest'], 'judge ingest');
  ensure(ingestArtifact.schema === 1 && ingestArtifact.instrument_version === VERSION, 'judge ingest version is invalid');
  ensure(ingestArtifact.kind === 'citadel_judge_eval_ingest', 'judge ingest kind is invalid');
  ensure(validTimestamp(ingestArtifact.created_at), 'judge ingest timestamp is invalid');
  ensure(ingestArtifact.plan_receipt_digest === planArtifact.receipt_digest, 'judge ingest plan receipt mismatch');
  validateJudgeOutput(ingestArtifact.control, planArtifact, corpus, 'control');
  validateJudgeOutput(ingestArtifact.treatment, planArtifact, corpus, 'treatment');
  ensure(ingestArtifact.receipt_digest === digest(ingestProjection(ingestArtifact)), 'judge ingest receipt digest mismatch');
  return ingestArtifact;
}

function emptyConfusion() {
  return Object.fromEntries(VERDICTS.map((gold) => [gold, Object.fromEntries(VERDICTS.map((predicted) => [predicted, 0]))]));
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function numericSummary(values) {
  const observed = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  const total = observed.reduce((sum, value) => sum + value, 0);
  return {
    observed: observed.length,
    total: observed.length ? total : null,
    mean: observed.length ? total / observed.length : null,
    p50: percentile(observed, 0.5),
    p95: percentile(observed, 0.95),
  };
}

function metricsFor(output, labels) {
  const confusion_matrix = emptyConfusion();
  if (!output) {
    return {
      trial_count: 0,
      evaluated_trials: 0,
      confusion_matrix,
      false_accept: { count: 0, denominator: 0, rate: null },
      false_block: { count: 0, denominator: 0, rate: null },
      unknown_rate: null,
      exact_accuracy: null,
      true_accept_rate: null,
      ambiguous_overreach_rate: null,
      pass_at_1: null,
      pass_pow_3: null,
      latency_ms: numericSummary([]),
      cost_usd: numericSummary([]),
    };
  }
  const gold = new Map(labels.labels.map((entry) => [entry.case_id, entry.gold_verdict]));
  let exact = 0;
  for (const trial of output.trials) {
    const expected = gold.get(trial.case_id);
    confusion_matrix[expected][trial.verdict] += 1;
    if (trial.verdict === expected) exact += 1;
  }
  const blockDenominator = VERDICTS.reduce((sum, verdict) => sum + confusion_matrix.block[verdict], 0);
  const acceptDenominator = VERDICTS.reduce((sum, verdict) => sum + confusion_matrix.accept[verdict], 0);
  const ambiguousDenominator = VERDICTS.reduce((sum, verdict) => sum + confusion_matrix.unknown[verdict], 0);
  const unknown = VERDICTS.reduce((sum, verdict) => sum + confusion_matrix[verdict].unknown, 0);
  const firstTrials = output.trials.filter((entry) => entry.trial === 1);
  const passAt1 = firstTrials.filter((entry) => entry.verdict === gold.get(entry.case_id)).length / firstTrials.length;
  let passPow3 = null;
  if (output.trial_count >= 3) {
    passPow3 = labels.labels.filter((label) => [1, 2, 3].every((trialNumber) => {
      const trial = output.trials.find((entry) => entry.case_id === label.case_id && entry.trial === trialNumber);
      return trial && trial.verdict === label.gold_verdict;
    })).length / labels.labels.length;
  }
  return {
    trial_count: output.trial_count,
    evaluated_trials: output.trials.length,
    confusion_matrix,
    false_accept: { count: confusion_matrix.block.accept, denominator: blockDenominator, rate: ratio(confusion_matrix.block.accept, blockDenominator) },
    false_block: { count: confusion_matrix.accept.block, denominator: acceptDenominator, rate: ratio(confusion_matrix.accept.block, acceptDenominator) },
    unknown_rate: ratio(unknown, output.trials.length),
    exact_accuracy: ratio(exact, output.trials.length),
    true_accept_rate: ratio(confusion_matrix.accept.accept, acceptDenominator),
    ambiguous_overreach_rate: ratio(confusion_matrix.unknown.accept + confusion_matrix.unknown.block, ambiguousDenominator),
    pass_at_1: passAt1,
    pass_pow_3: passPow3,
    latency_ms: numericSummary(output.trials.map((entry) => entry.latency_ms)),
    cost_usd: numericSummary(output.trials.map((entry) => entry.cost_usd)),
  };
}

function pinnedModel(identity) {
  return identity && !/(^|[-_ ])(?:latest|default|auto)(?:$|[-_ ])/i.test(identity.model);
}

function promotionGates(ingestArtifact, labels, metrics) {
  const control = ingestArtifact && ingestArtifact.control;
  const treatment = ingestArtifact && ingestArtifact.treatment;
  const observed = Boolean(control && treatment);
  const falseAcceptImprovement = observed
    && metrics.control.false_accept.rate !== null
    && metrics.treatment.false_accept.rate !== null
    ? metrics.control.false_accept.rate - metrics.treatment.false_accept.rate
    : null;
  const trueAcceptLoss = observed
    && metrics.control.true_accept_rate !== null
    && metrics.treatment.true_accept_rate !== null
    ? metrics.control.true_accept_rate - metrics.treatment.true_accept_rate
    : null;
  return {
    outputs_observed: observed,
    labels_human_calibrated: labels.provenance.status === 'human_calibrated',
    judges_human_calibrated: observed && control.judge_identity.calibration_status === 'human_calibrated' && treatment.judge_identity.calibration_status === 'human_calibrated',
    pinned_strong_models: observed && pinnedModel(control.judge_identity) && pinnedModel(treatment.judge_identity) && control.judge_identity.capability_class === 'strong' && treatment.judge_identity.capability_class === 'strong',
    different_model_families: observed && control.judge_identity.model_family !== treatment.judge_identity.model_family,
    three_trials_per_case: observed && control.trial_count >= 3 && treatment.trial_count >= 3,
    all_outputs_observed: observed && [...control.trials, ...treatment.trials].every((entry) => entry.output_status === 'observed'),
    treatment_false_accept_rate_lte_0_05: observed && metrics.treatment.false_accept.rate !== null && metrics.treatment.false_accept.rate <= 0.05,
    false_accept_improvement_gte_0_20: falseAcceptImprovement !== null && falseAcceptImprovement >= 0.20,
    true_accept_loss_lte_0_10: trueAcceptLoss !== null && trueAcceptLoss <= 0.10,
  };
}

function resultProjection(result) {
  const copy = { ...result };
  delete copy.receipt_digest;
  return copy;
}

function buildResults(planArtifact, corpus, labels, ingestArtifact = null, labelSourceSha256 = digest(labels)) {
  const metrics = {
    control: metricsFor(ingestArtifact && ingestArtifact.control, labels),
    treatment: metricsFor(ingestArtifact && ingestArtifact.treatment, labels),
  };
  const external_promotion_gates = promotionGates(ingestArtifact, labels, metrics);
  const gate_failures = Object.entries(external_promotion_gates).filter(([, passed]) => !passed).map(([gate]) => gate);
  const sameFamily = ingestArtifact && ingestArtifact.control.judge_identity.model_family === ingestArtifact.treatment.judge_identity.model_family;
  const localProxy = ingestArtifact && [ingestArtifact.control, ingestArtifact.treatment].some((entry) => entry.judge_identity.provider.toLowerCase() === 'local');
  const uncalibrated = ingestArtifact && [ingestArtifact.control, ingestArtifact.treatment].some((entry) => entry.judge_identity.calibration_status !== 'human_calibrated');
  const proxy = !ingestArtifact || localProxy || sameFamily || uncalibrated || labels.provenance.status !== 'human_calibrated';
  const eligible = gate_failures.length === 0;
  const result = {
    schema: 1,
    kind: 'citadel_judge_eval_results',
    instrument_version: VERSION,
    reported_at: ingestArtifact ? ingestArtifact.created_at : planArtifact.created_at,
    corpus_id: corpus.corpus_id,
    case_count: corpus.cases.length,
    observation_status: ingestArtifact ? 'observed' : 'not_run',
    claim_status: proxy ? 'instrument_only' : (eligible ? 'external_promotion_eligible' : 'external_evidence_blocked'),
    promotion_status: eligible ? 'eligible_external' : 'blocked_external',
    source_receipts: {
      plan: planArtifact.receipt_digest,
      labels: labelSourceSha256,
      ingest: ingestArtifact ? ingestArtifact.receipt_digest : null,
    },
    judge_identities: ingestArtifact ? { control: ingestArtifact.control.judge_identity, treatment: ingestArtifact.treatment.judge_identity } : null,
    metrics,
    external_promotion_gates,
    gate_failures,
  };
  result.receipt_digest = digest(resultProjection(result));
  return result;
}

function formatRate(value) {
  return value === null ? 'unknown' : `${(value * 100).toFixed(1)}%`;
}

function matrixMarkdown(matrix) {
  return [
    '| gold \\ predicted | accept | block | unknown |',
    '|---|---:|---:|---:|',
    ...VERDICTS.map((gold) => `| ${gold} | ${matrix[gold].accept} | ${matrix[gold].block} | ${matrix[gold].unknown} |`),
  ].join('\n');
}

function reportMarkdown(result) {
  const lines = [
    '# Citadel JudgeEval report',
    '',
    `- Observation status: \`${result.observation_status}\``,
    `- Claim status: \`${result.claim_status}\``,
    `- External promotion: \`${result.promotion_status}\``,
    `- Cases: ${result.case_count}`,
    `- Receipt: \`${result.receipt_digest}\``,
    '',
    'This report verifies an evaluation instrument. It is not a passed Citadel product claim. Missing or malformed judge output remains `unknown`.',
  ];
  for (const arm of ['control', 'treatment']) {
    const metric = result.metrics[arm];
    lines.push('', `## ${arm}`, '', matrixMarkdown(metric.confusion_matrix), '');
    lines.push(`- False-accept: ${metric.false_accept.count}/${metric.false_accept.denominator} (${formatRate(metric.false_accept.rate)})`);
    lines.push(`- False-block: ${metric.false_block.count}/${metric.false_block.denominator} (${formatRate(metric.false_block.rate)})`);
    lines.push(`- Unknown rate: ${formatRate(metric.unknown_rate)}`);
    lines.push(`- pass@1: ${formatRate(metric.pass_at_1)}`);
    lines.push(`- pass^3: ${formatRate(metric.pass_pow_3)}`);
    lines.push(`- Latency ms mean/p50/p95: ${metric.latency_ms.mean ?? 'unknown'} / ${metric.latency_ms.p50 ?? 'unknown'} / ${metric.latency_ms.p95 ?? 'unknown'}`);
    lines.push(`- Cost USD total/mean: ${metric.cost_usd.total ?? 'unknown'} / ${metric.cost_usd.mean ?? 'unknown'}`);
  }
  lines.push('', '## External promotion gates', '');
  for (const [gate, passed] of Object.entries(result.external_promotion_gates)) lines.push(`- [${passed ? 'x' : ' '}] ${gate}`);
  lines.push('', `Remaining gates: ${result.gate_failures.length ? result.gate_failures.join(', ') : 'none; evidence is eligible for external review, not automatically a product claim'}`, '');
  return `${lines.join('\n')}\n`;
}

function loadPlanArtifacts(options = {}) {
  const { target, corpus, labels } = loadCorpus(options);
  const planArtifact = readJson(target.plan);
  const control = readJson(target.controlPrompts);
  const treatment = readJson(target.treatmentPrompts);
  exactKeys(planArtifact, ['schema', 'kind', 'instrument_version', 'created_at', 'corpus_id', 'rubric_version', 'case_count', 'categories', 'prompt_source_sha256', 'prompt_bundles', 'bundle_receipts', 'output_contract', 'claim_boundary', 'receipt_digest'], 'JudgeEval plan');
  ensure(planArtifact.receipt_digest === digest(planProjection(planArtifact)), 'JudgeEval plan receipt mismatch');
  ensure(planArtifact.prompt_source_sha256 === fileDigest(target.promptPath), 'JudgeEval prompt source digest mismatch');
  validatePromptBundle(control, corpus, 'control');
  validatePromptBundle(treatment, corpus, 'treatment');
  ensure(planArtifact.bundle_receipts.control === control.receipt_digest && planArtifact.bundle_receipts.treatment === treatment.receipt_digest, 'JudgeEval plan bundle receipts mismatch');
  const expected = buildPlanArtifacts(corpus, fileDigest(target.promptPath));
  ensure(JSON.stringify(planArtifact) === JSON.stringify(expected.plan), 'JudgeEval plan differs from deterministic projection');
  assertNoLabelLeak(corpus, labels, [planArtifact, control, treatment]);
  return { target, corpus, labels, planArtifact };
}

function writeResults(target, result) {
  writeJson(target.results, result);
  writeIfChanged(target.report, reportMarkdown(result));
}

function ingest(options = {}) {
  ensure(options.control && options.treatment, 'ingest requires --control FILE and --treatment FILE');
  const loaded = loadPlanArtifacts(options);
  const control = validateJudgeOutput(readJson(path.resolve(options.control)), loaded.planArtifact, loaded.corpus, 'control');
  const treatment = validateJudgeOutput(readJson(path.resolve(options.treatment)), loaded.planArtifact, loaded.corpus, 'treatment');
  const ingestArtifact = buildIngest(loaded.planArtifact, control, treatment);
  writeJson(loaded.target.ingest, ingestArtifact);
  const result = buildResults(loaded.planArtifact, loaded.corpus, loaded.labels, ingestArtifact, fileDigest(loaded.target.labelPath));
  writeResults(loaded.target, result);
  return result;
}

function report(options = {}) {
  const loaded = loadPlanArtifacts(options);
  let ingestArtifact = null;
  if (fs.existsSync(loaded.target.ingest)) ingestArtifact = validateIngest(readJson(loaded.target.ingest), loaded.planArtifact, loaded.corpus);
  const result = buildResults(loaded.planArtifact, loaded.corpus, loaded.labels, ingestArtifact, fileDigest(loaded.target.labelPath));
  writeResults(loaded.target, result);
  return result;
}

function verify(options = {}) {
  const loaded = loadPlanArtifacts(options);
  let ingestArtifact = null;
  if (fs.existsSync(loaded.target.ingest)) ingestArtifact = validateIngest(readJson(loaded.target.ingest), loaded.planArtifact, loaded.corpus);
  const expected = buildResults(loaded.planArtifact, loaded.corpus, loaded.labels, ingestArtifact, fileDigest(loaded.target.labelPath));
  const actual = readJson(loaded.target.results);
  ensure(JSON.stringify(actual) === JSON.stringify(expected), 'JudgeEval results differ from receipt-bound evidence');
  ensure(fs.readFileSync(loaded.target.report, 'utf8') === reportMarkdown(expected), 'JudgeEval markdown report differs from results');
  return {
    instrument_status: 'passed',
    cases: loaded.corpus.cases.length,
    observation_status: expected.observation_status,
    claim_status: expected.claim_status,
    promotion_status: expected.promotion_status,
    remaining_external_gates: expected.gate_failures,
    receipt_digest: expected.receipt_digest,
  };
}

function parseArgs(argv) {
  ensure(argv.length > 0, 'Usage: experiment-judge-eval.js <plan|seal|ingest|report|verify> [--output PATH] [--evidence DIR] [--prompts FILE] [--labels FILE] [--arm ARM --input FILE] [--control FILE --treatment FILE]');
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    ensure(/^--(?:output|evidence|prompts|labels|control|treatment|arm|input)$/.test(flag || '') && value, `invalid argument ${flag || '<missing>'}`);
    const key = flag.slice(2);
    ensure(options[key] === undefined, `duplicate argument ${flag}`);
    options[key] = value;
  }
  return { command: argv[0], options };
}

function cli(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  let result;
  if (command === 'plan') result = plan(options);
  else if (command === 'seal') result = seal(options);
  else if (command === 'ingest') result = ingest(options);
  else if (command === 'report') result = report(options);
  else if (command === 'verify') result = verify(options);
  else fail(`unknown command ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    cli();
  } catch (error) {
    process.stderr.write(`JudgeEval failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  FILES,
  VERSION,
  VERDICTS,
  assertNoLabelLeak,
  buildPlanArtifacts,
  buildResults,
  digest,
  ingest,
  labelReviewProjection,
  metricsFor,
  plan,
  report,
  reportMarkdown,
  seal,
  sealJudgeOutput,
  sealTrial,
  validateJudgeOutput,
  validateLabels,
  validatePromptCorpus,
  verify,
});

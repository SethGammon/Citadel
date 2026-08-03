'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { digest } = require('../core/operation-control/contracts');
const { DATASET, validatePool, visibleTask } = require('../core/public-holdout/dataset');
const { buildPredictionEvidence, buildVerdictBundle, signAttempt, verifyAttestation } = require('../core/public-holdout/artifacts');
const { CLAUDE_BIN, MODELS, OLLAMA_ENDPOINT, generateAttempt } = require('../core/public-holdout/runner');
const { validateSelectionRecord } = require('../core/public-holdout/selection');
const { buildPilotAssignment } = require('../core/public-holdout-pilot/design');
const { buildPilotAnalysis, buildPilotFreeze, buildPilotRouteLedger, buildPilotVisible, buildSignedPilotAssignment } = require('../core/public-holdout-pilot/artifacts');
const { PILOT_PLAN_IDS } = require('../core/public-holdout-pilot/router');
const capstone = require('./public-holdout-capstone');

const ROOT = path.resolve(__dirname, '..');
const BENCHMARK = path.join(ROOT, 'benchmarks', 'public-holdout-pilot');
const PARENT = path.join(ROOT, 'benchmarks', 'public-holdout-capstone');
const PARENT_REQUEST_FILE = path.join(PARENT, 'selection-request.json');
const PARENT_SELECTION_FILE = path.join(PARENT, 'selection.json');
const PARENT_POOL_FILE = path.join(PARENT, 'candidate-pool.json');
const PARENT_PREFLIGHT_FILE = path.join(PARENT, 'gold-preflight.json');
const PARENT_ASSIGNMENT_FILE = path.join(PARENT, 'assignment.json');
const FREEZE_FILE = path.join(BENCHMARK, 'freeze.json');
const ASSIGNMENT_FILE = path.join(BENCHMARK, 'assignment.json');
const VISIBLE_FILE = path.join(BENCHMARK, 'visible-tasks.json');
const ROUTE_LEDGER_FILE = path.join(BENCHMARK, 'route-ledger.json');
const ANALYSIS_FILE = path.join(BENCHMARK, 'final-analysis.json');
const KEY_FILE = process.env.CITADEL_HOLDOUT_KEY || path.join('C:\\tmp', 'citadel-public-holdout-ed25519.pem');
const PHASES = Object.freeze(['calibration', 'evaluation']);
const PLANS = Object.freeze(Object.values(PILOT_PLAN_IDS));
const SOURCE_FILES = Object.freeze([
  '.github/workflows/public-holdout-pilot-evaluation.yml',
  'benchmarks/public-holdout-pilot/METHOD.md',
  'core/operation-control/contracts.js',
  'core/operation-control/receipt.js',
  'core/operation-controller/contracts.js',
  'core/operation-controller/controller.js',
  'core/public-holdout/artifacts.js',
  'core/public-holdout/dataset.js',
  'core/public-holdout/retrieval.js',
  'core/public-holdout/runner.js',
  'core/public-holdout/selection.js',
  'core/public-holdout/statistics.js',
  'core/public-holdout-pilot/artifacts.js',
  'core/public-holdout-pilot/design.js',
  'core/public-holdout-pilot/router.js',
  'core/public-holdout-pilot/statistics.js',
  'scripts/public-holdout-capstone.js',
  'scripts/public-holdout-evaluator-summary.js',
  'scripts/public-holdout-matrix.js',
  'scripts/public-holdout-pilot.js',
  'scripts/test-public-holdout-pilot.js',
]);

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function normalizedSource(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n'); }
function sourceDigests() { return Object.fromEntries(SOURCE_FILES.map((relative) => [relative, digest(normalizedSource(relative))])); }
function privateKey() { return fs.readFileSync(KEY_FILE, 'utf8'); }
function publicKey() { return crypto.createPublicKey(privateKey()).export({ type: 'spki', format: 'pem' }); }
function attemptFile(phase, planId, instanceId) { return path.join(BENCHMARK, 'attempts', phase, planId, `${instanceId}.json`); }
function contextFile(instanceId) { return path.join(BENCHMARK, 'contexts', `${instanceId}.json`); }
function predictionFile(phase, planId) { return path.join(BENCHMARK, 'predictions', `${phase}--${planId}.json`); }
function predictionEvidenceFile(phase, planId) { return path.join(BENCHMARK, 'predictions', `${phase}--${planId}.evidence.json`); }
function verdictFile(phase, planId) { return path.join(BENCHMARK, 'verdicts', `${phase}--${planId}.json`); }
function directoryHasJson(directory) { return fs.existsSync(directory) && fs.readdirSync(directory, { recursive: true }).some((entry) => String(entry).endsWith('.json')); }

function parentEvidence() {
  const pool = validatePool(readJson(PARENT_POOL_FILE));
  const request = readJson(PARENT_REQUEST_FILE);
  const selection = validateSelectionRecord(readJson(PARENT_SELECTION_FILE), request, pool);
  const preflight = verifyAttestation(readJson(PARENT_PREFLIGHT_FILE), request.attestation_public_key);
  const assignment = verifyAttestation(readJson(PARENT_ASSIGNMENT_FILE), request.attestation_public_key);
  if (preflight.selection_id !== selection.selection_id || assignment.preflight_id !== preflight.preflight_id) throw new Error('parent evidence chain invalid');
  return { pool, request, selection, preflight, assignment };
}

function freeze() {
  if (fs.existsSync(FREEZE_FILE) || fs.existsSync(ASSIGNMENT_FILE)) throw new Error('pilot freeze already exists');
  const priorAttempts = path.join(BENCHMARK, 'attempts');
  if (fs.existsSync(priorAttempts) && fs.readdirSync(priorAttempts).length) throw new Error('pilot model attempts already exist before freeze');
  capstone.verify();
  const parent = parentEvidence();
  if (parent.assignment.status !== 'setup-unknown') throw new Error('pilot requires the preserved terminal parent assignment');
  const signedFreeze = buildPilotFreeze({ parentRequest: parent.request, parentSelection: parent.selection, parentPreflight: parent.preflight, parentAssignment: parent.assignment, sourceDigests: sourceDigests(), privateKey: privateKey() });
  const assignment = buildSignedPilotAssignment({ freeze: signedFreeze, selection: parent.selection, preflight: parent.preflight, privateKey: privateKey() });
  verifyAttestation(signedFreeze, parent.request.attestation_public_key);
  verifyAttestation(assignment, parent.request.attestation_public_key);
  writeJson(FREEZE_FILE, signedFreeze);
  writeJson(ASSIGNMENT_FILE, assignment);
  return { freeze_id: signedFreeze.freeze_id, assignment_id: assignment.assignment_id, status: assignment.status, calibration: assignment.assignments.calibration.length, evaluation: assignment.assignments.evaluation.length, unique_repositories: assignment.unique_repository_count };
}

async function fetchRow(candidate) {
  const query = new URLSearchParams({ dataset: DATASET.id, config: DATASET.config, split: candidate.split, offset: String(candidate.row_index), length: '1' });
  const response = await fetch(`${DATASET.rows_api}?${query}`, { headers: { 'user-agent': 'citadel-public-holdout-fast-pilot/1' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} hydrating ${candidate.instance_id}`);
  const page = await response.json();
  if (!Array.isArray(page.rows) || page.rows.length !== 1) throw new Error(`source row missing for ${candidate.instance_id}`);
  const task = visibleTask(page.rows[0], candidate.split);
  if (task.instance_id !== candidate.instance_id || task.source_row_digest !== candidate.source_row_digest) throw new Error(`source row drifted for ${candidate.instance_id}`);
  return task;
}

async function hydrate() {
  const parent = parentEvidence();
  const signedFreeze = verifyAttestation(readJson(FREEZE_FILE), parent.request.attestation_public_key);
  const assignment = verifyAttestation(readJson(ASSIGNMENT_FILE), parent.request.attestation_public_key);
  if (assignment.status !== 'ready') throw new Error(`pilot assignment is ${assignment.status}`);
  const byId = new Map(parent.pool.candidates.map((candidate) => [candidate.instance_id, candidate]));
  const ids = [...assignment.assignments.calibration, ...assignment.assignments.evaluation];
  const tasks = [];
  for (const instanceId of ids) {
    const candidate = byId.get(instanceId);
    if (!candidate) throw new Error(`assigned pilot candidate missing: ${instanceId}`);
    tasks.push(await fetchRow(candidate));
    process.stdout.write(`[${tasks.length}/${ids.length}] ${instanceId}\n`);
  }
  const visible = buildPilotVisible({ freeze: signedFreeze, assignment, tasks, privateKey: privateKey() });
  writeJson(VISIBLE_FILE, visible);
  return { artifact_id: visible.artifact_id, tasks: visible.tasks.length };
}

async function doctor() {
  const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`);
  if (!response.ok) throw new Error(`Ollama doctor HTTP ${response.status}`);
  const tags = await response.json();
  const installed = new Map((tags.models || []).map((model) => [model.name, model]));
  const expected = MODELS[PILOT_PLAN_IDS.local];
  const observed = installed.get(expected.requested_model);
  const local = { plan_id: PILOT_PLAN_IDS.local, requested_model: expected.requested_model, expected_digest: expected.model_digest, observed_digest: observed ? `sha256:${observed.digest}` : null, status: observed && `sha256:${observed.digest}` === expected.model_digest ? 'passed' : 'failed' };
  const claude = childProcess.spawnSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
  const cloudExpected = MODELS[PILOT_PLAN_IDS.cloud];
  const cloud = { plan_id: PILOT_PLAN_IDS.cloud, expected_cli_version: cloudExpected.cli_version, observed_cli_version: claude.status === 0 ? String(claude.stdout).trim() : null, status: claude.status === 0 && String(claude.stdout).startsWith(cloudExpected.cli_version) ? 'passed' : 'failed' };
  const gpu = childProcess.spawnSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
  return Object.freeze({ schema: 1, kind: 'citadel_public_holdout_fast_pilot_environment_doctor', status: local.status === 'passed' && cloud.status === 'passed' && gpu.status === 0 ? 'passed' : 'failed', models: [local, cloud], gpu: gpu.status === 0 ? String(gpu.stdout).trim() : null, platform: process.platform, arch: process.arch, cpu_count: os.cpus().length, total_memory_bytes: os.totalmem(), node: process.version });
}

function pilotArtifacts() {
  const parent = parentEvidence();
  const signedFreeze = verifyAttestation(readJson(FREEZE_FILE), parent.request.attestation_public_key);
  const assignment = verifyAttestation(readJson(ASSIGNMENT_FILE), parent.request.attestation_public_key);
  const visible = fs.existsSync(VISIBLE_FILE) ? verifyAttestation(readJson(VISIBLE_FILE), parent.request.attestation_public_key) : null;
  return { parent, freeze: signedFreeze, assignment, visible };
}

function tasksForPhase(phase) {
  if (!PHASES.includes(phase)) throw new Error(`unsupported pilot phase: ${phase}`);
  const { assignment, visible } = pilotArtifacts();
  if (!visible) throw new Error('pilot visible task artifact missing');
  const ids = new Set(assignment.assignments[phase]);
  return visible.tasks.filter((task) => ids.has(task.instance_id));
}

function bindAttempt(attempt, freezeId, assignmentId) {
  const unsigned = { ...attempt, attempt_id: null, pilot_freeze_id: freezeId, pilot_assignment_id: assignmentId };
  return Object.freeze({ ...unsigned, attempt_id: digest(unsigned) });
}

function readAttempts(phase, planId) {
  const { parent, freeze: signedFreeze, assignment } = pilotArtifacts();
  return tasksForPhase(phase).map((task) => {
    const file = attemptFile(phase, planId, task.instance_id);
    if (!fs.existsSync(file)) throw new Error(`pilot attempt missing: ${file}`);
    const attempt = verifyAttestation(readJson(file), parent.request.attestation_public_key);
    if (attempt.pilot_freeze_id !== signedFreeze.freeze_id || attempt.pilot_assignment_id !== assignment.assignment_id) throw new Error(`pilot attempt binding invalid: ${task.instance_id}`);
    return attempt;
  });
}

async function generate(phase, planId) {
  if (!PHASES.includes(phase) || !PLANS.includes(planId)) throw new Error('pilot generate requires a valid phase and plan');
  const health = await doctor();
  if (health.status !== 'passed') throw new Error(`pilot environment doctor failed: ${JSON.stringify(health)}`);
  const { parent, freeze: signedFreeze, assignment } = pilotArtifacts();
  if (phase === 'evaluation') {
    if (!fs.existsSync(ROUTE_LEDGER_FILE)) throw new Error('pilot route ledger must be sealed before evaluation generation');
    const ledger = verifyAttestation(readJson(ROUTE_LEDGER_FILE), parent.request.attestation_public_key);
    if (ledger.freeze_id !== signedFreeze.freeze_id || ledger.assignment_id !== assignment.assignment_id || ledger.routes.length !== assignment.assignments.evaluation.length) throw new Error('pilot route ledger binding invalid');
  }
  const tasks = tasksForPhase(phase);
  let completed = 0;
  for (const task of tasks) {
    const file = attemptFile(phase, planId, task.instance_id);
    if (fs.existsSync(file)) {
      const existing = verifyAttestation(readJson(file), parent.request.attestation_public_key);
      if (existing.pilot_freeze_id !== signedFreeze.freeze_id || existing.pilot_assignment_id !== assignment.assignment_id) throw new Error(`existing pilot attempt binding invalid: ${task.instance_id}`);
    }
    else {
      const frozenContext = fs.existsSync(contextFile(task.instance_id)) ? readJson(contextFile(task.instance_id)) : null;
      const generated = await generateAttempt({ task, planId, retrievalArtifact: frozenContext });
      const attempt = signAttempt(bindAttempt(generated, signedFreeze.freeze_id, assignment.assignment_id), parent.request, privateKey());
      writeJson(file, attempt);
      if (!frozenContext) writeJson(contextFile(task.instance_id), attempt.retrieval);
    }
    completed += 1;
    process.stdout.write(`[${completed}/${tasks.length}] ${phase}/${planId}/${task.instance_id}\n`);
  }
  return { status: 'complete', phase, plan_id: planId, attempts: completed };
}

function buildPredictions(phase, planId) {
  const attempts = readAttempts(phase, planId);
  const predictions = Object.fromEntries(attempts.map((attempt) => [attempt.instance_id, { model_patch: attempt.generated_patch }]));
  const file = predictionFile(phase, planId);
  writeJson(file, predictions);
  const evidence = buildPredictionEvidence({ phase: `pilot-${phase}`, planId, attempts, predictionDigest: digest(predictions), privateKey: privateKey() });
  writeJson(predictionEvidenceFile(phase, planId), evidence);
  return { prediction_file: path.relative(ROOT, file).replace(/\\/g, '/'), evidence_id: evidence.evidence_id, predictions: attempts.length };
}

function findNamedFiles(directory, filename) {
  if (!fs.existsSync(directory)) throw new Error(`pilot evidence directory missing: ${directory}`);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return findNamedFiles(absolute, filename);
    return entry.isFile() && entry.name === filename ? [absolute] : [];
  });
}

function ingestVerdicts(phase, planId, directory) {
  const attempts = readAttempts(phase, planId);
  const expectedIds = new Set(attempts.map((attempt) => attempt.instance_id));
  const summaries = findNamedFiles(path.resolve(directory), 'summary.json').map(readJson).filter((summary) => expectedIds.has(summary.instance_id));
  if (summaries.length !== attempts.length || new Set(summaries.map((summary) => summary.instance_id)).size !== attempts.length) throw new Error(`pilot verdict summary set incomplete for ${phase}/${planId}`);
  const bundle = buildVerdictBundle({ phase: `pilot-${phase}`, planId, attempts, summaries, privateKey: privateKey() });
  writeJson(verdictFile(phase, planId), bundle);
  return { bundle_id: bundle.bundle_id, verdicts: bundle.verdicts.length, passed: bundle.verdicts.filter((verdict) => verdict.verification_status === 'passed').length, failed: bundle.verdicts.filter((verdict) => verdict.verification_status === 'failed').length, unknown: bundle.verdicts.filter((verdict) => verdict.verification_status === 'unknown').length };
}

function routes() {
  const { parent, freeze: signedFreeze, assignment, visible } = pilotArtifacts();
  if (directoryHasJson(path.join(BENCHMARK, 'attempts', 'evaluation'))) throw new Error('cannot seal pilot routes after evaluation attempts exist');
  const attemptSets = PLANS.map((planId) => readAttempts('calibration', planId));
  const verdictBundles = PLANS.map((planId) => verifyAttestation(readJson(verdictFile('calibration', planId)), parent.request.attestation_public_key));
  const ledger = buildPilotRouteLedger({ freeze: signedFreeze, assignment, visibleTasks: visible.tasks, calibrationAttemptSets: attemptSets, calibrationVerdictBundles: verdictBundles, privateKey: privateKey() });
  writeJson(ROUTE_LEDGER_FILE, ledger);
  return { ledger_id: ledger.ledger_id, routes: ledger.routes.length, calibration_records: ledger.calibration_records };
}

function analyze() {
  const { parent, freeze: signedFreeze, assignment, visible } = pilotArtifacts();
  const routeLedger = verifyAttestation(readJson(ROUTE_LEDGER_FILE), parent.request.attestation_public_key);
  const attemptSets = PLANS.map((planId) => readAttempts('evaluation', planId));
  const verdictBundles = PLANS.map((planId) => verifyAttestation(readJson(verdictFile('evaluation', planId)), parent.request.attestation_public_key));
  const analysis = buildPilotAnalysis({ freeze: signedFreeze, assignment, visibleTasks: visible.tasks, routeLedger, evaluationAttemptSets: attemptSets, evaluationVerdictBundles: verdictBundles, privateKey: privateKey() });
  writeJson(ANALYSIS_FILE, analysis);
  return { analysis_id: analysis.analysis_id, primary: analysis.primary };
}

function unsignedArtifact(value, idField) {
  const payload = { ...value };
  delete payload.attestation;
  payload[idField] = null;
  return payload;
}

function verify() {
  const parentStatus = capstone.verify();
  const parent = parentEvidence();
  const signedFreeze = verifyAttestation(readJson(FREEZE_FILE), parent.request.attestation_public_key);
  if (signedFreeze.freeze_id !== digest(unsignedArtifact(signedFreeze, 'freeze_id'))) throw new Error('pilot freeze digest invalid');
  if (JSON.stringify(signedFreeze.source_digests) !== JSON.stringify(sourceDigests())) throw new Error('frozen pilot sources drifted');
  const assignment = verifyAttestation(readJson(ASSIGNMENT_FILE), parent.request.attestation_public_key);
  const expected = buildPilotAssignment({ freezeId: signedFreeze.freeze_id, selection: parent.selection, preflight: parent.preflight });
  const observedAssignment = { ...assignment };
  delete observedAssignment.attestation;
  if (JSON.stringify(observedAssignment) !== JSON.stringify(expected)) throw new Error('pilot assignment drifted');
  for (const file of [VISIBLE_FILE, ROUTE_LEDGER_FILE, ANALYSIS_FILE]) if (fs.existsSync(file)) verifyAttestation(readJson(file), parent.request.attestation_public_key);
  if (fs.existsSync(VISIBLE_FILE)) {
    const visible = readJson(VISIBLE_FILE);
    const assignedIds = [...assignment.assignments.calibration, ...assignment.assignments.evaluation];
    if (visible.freeze_id !== signedFreeze.freeze_id || visible.assignment_id !== assignment.assignment_id || JSON.stringify(visible.tasks.map((task) => task.instance_id)) !== JSON.stringify(assignedIds)) throw new Error('pilot visible task artifact drifted');
  }
  for (const phase of PHASES) for (const planId of PLANS) {
    const evidence = predictionEvidenceFile(phase, planId);
    const verdict = verdictFile(phase, planId);
    if (fs.existsSync(evidence)) verifyAttestation(readJson(evidence), parent.request.attestation_public_key);
    if (fs.existsSync(verdict)) verifyAttestation(readJson(verdict), parent.request.attestation_public_key);
    if (fs.existsSync(path.dirname(attemptFile(phase, planId, 'placeholder')))) readAttempts(phase, planId);
  }
  return { status: 'pilot-passed', parent_status: parentStatus.status, freeze_id: signedFreeze.freeze_id, assignment_id: assignment.assignment_id, assignment_status: assignment.status, visible_tasks: fs.existsSync(VISIBLE_FILE) ? readJson(VISIBLE_FILE).tasks.length : 0, route_ledger: fs.existsSync(ROUTE_LEDGER_FILE), final_analysis: fs.existsSync(ANALYSIS_FILE) };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  let result;
  if (command === 'freeze') result = freeze();
  else if (command === 'hydrate') result = await hydrate();
  else if (command === 'doctor') result = await doctor();
  else if (command === 'generate') result = await generate(args[0], args[1]);
  else if (command === 'predictions') result = buildPredictions(args[0], args[1]);
  else if (command === 'ingest-verdicts') result = ingestVerdicts(args[0], args[1], args[2]);
  else if (command === 'routes') result = routes();
  else if (command === 'analyze') result = analyze();
  else if (command === 'verify') result = verify();
  else throw new Error('usage: public-holdout-pilot.js <freeze|hydrate|doctor|generate PHASE PLAN|predictions PHASE PLAN|ingest-verdicts PHASE PLAN DIR|routes|analyze|verify>');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = Object.freeze({ ANALYSIS_FILE, ASSIGNMENT_FILE, BENCHMARK, FREEZE_FILE, PLANS, ROUTE_LEDGER_FILE, SOURCE_FILES, VISIBLE_FILE, analyze, buildPredictions, doctor, freeze, generate, hydrate, ingestVerdicts, parentEvidence, routes, sourceDigests, verify });

#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const operations = require('../core/operations');

const BASE = Date.parse('2026-07-21T16:00:00.000Z');
const times = Array.from({ length: 96 }, (_, index) =>
  new Date(BASE + index * 1000).toISOString());

function directories(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    root,
    graphJournalDir: path.join(root, 'graph-journal'),
    effectJournalDir: path.join(root, 'effect-journal'),
  };
}

function initialize(bundle, dirs, runId, now = times[0]) {
  const run = operations.createGraphRun(bundle.graph, runId, { now });
  operations.appendGraphRunSnapshot(dirs.graphJournalDir, bundle.graph, run, 'initialized');
  return run;
}

let passed = 0;
function test(name, fn) {
  const dirs = directories('citadel-graph-effects-');
  try {
    fn(dirs);
    passed++;
    process.stdout.write('  PASS ' + name + '\n');
  } finally {
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }
}

test('a Research graph executes through effect checkpoints and emits a passed protocol receipt', (dirs) => {
  const bundle = operations.createResearchFleetBundle(
    ['claims', 'taxonomy', 'fit'], { now: times[0] });
  assert.equal(operations.sha256Digest(bundle.operation), bundle.graph.operation_spec_digest);
  assert.doesNotThrow(() => operations.assertGraphOperationBinding(bundle.graph, bundle.operation));
  let run = initialize(bundle, dirs, 'run-research-effect-proof');
  assert.throws(() => operations.createGraphProtocolProof({
    graph: bundle.graph, run, operation: bundle.operation,
    effectJournalDir: dirs.effectJournalDir, issuedAt: times[1], issuerId: 'issuer-local',
  }), /terminal graph run/);
  let clock = 1;

  while (run.status !== 'passed') {
    const evaluation = operations.evaluateGraph(bundle.graph, run.scheduler_state);
    assert(evaluation.ready_node_ids.length > 0, 'research graph should keep making progress');
    for (const nodeId of evaluation.ready_node_ids) {
      const payloadDigest = operations.sha256Digest({ node_id: nodeId, input: 'redacted' });
      const started = operations.startGraphNodeEffect({
        graph: bundle.graph,
        run,
        graphJournalDir: dirs.graphJournalDir,
        effectJournalDir: dirs.effectJournalDir,
        nodeId,
        payloadDigest,
        now: times[clock++],
      });
      assert.equal(started.status, 'ready');
      assert.equal(started.execution, 'execute');
      run = started.run;
      const completed = operations.completeGraphNodeEffect({
        graph: bundle.graph,
        run,
        graphJournalDir: dirs.graphJournalDir,
        effectJournalDir: dirs.effectJournalDir,
        nodeId,
        payloadDigest,
        evidenceDigest: operations.sha256Digest({ node_id: nodeId, artifact: 'verified' }),
        now: times[clock++],
      });
      assert.equal(completed.status, 'completed');
      run = completed.run;
    }
  }

  const proof = operations.createGraphProtocolProof({
    graph: bundle.graph,
    run,
    operation: bundle.operation,
    effectJournalDir: dirs.effectJournalDir,
    issuedAt: times[clock],
    issuerId: 'issuer-local',
  });
  assert.equal(proof.receipt_envelope.receipt.status, 'passed');
  assert.equal(proof.evidence.length, bundle.graph.nodes.length);
  assert.equal(proof.step_attempts.length, bundle.operation.step_ids.length);
  assert.equal(operations.validateReceiptEnvelope(proof.receipt_envelope).length, 0);
  const raw = JSON.stringify(proof);
  assert(!raw.includes('input'), 'proof should retain digests, not input content');
  assert(!raw.includes('prompt'));
});

test('a completed effect checkpoint reconciles a graph crash without repeating work', (dirs) => {
  const bundle = operations.createResearchFleetBundle(
    ['claims', 'taxonomy', 'fit'], { now: times[0] });
  let run = initialize(bundle, dirs, 'run-crash-reconcile');
  const payloadDigest = operations.sha256Digest({ node: 'scope', payload: 1 });
  run = operations.startGraphNodeEffect({
    graph: bundle.graph,
    run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    now: times[1],
  }).run;
  const evidenceDigest = operations.sha256Digest({ node: 'scope', evidence: 1 });
  assert.throws(() => operations.completeGraphNodeEffect({
    graph: bundle.graph,
    run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    evidenceDigest,
    now: times[2],
    faultAt: 'after_effect_checkpoint',
  }), /Injected fault/);

  const recovery = operations.planGraphExecutionRecovery(
    dirs.graphJournalDir, dirs.effectJournalDir, bundle.graph);
  assert.equal(recovery.status, 'ready');
  assert.deepEqual(recovery.actions.map((action) => action.decision), ['skip']);
  const recoveredRun = operations.readGraphRunJournal(
    dirs.graphJournalDir, bundle.graph).latest_run;
  const reconciled = operations.startGraphNodeEffect({
    graph: bundle.graph,
    run: recoveredRun,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    now: times[3],
  });
  assert.equal(reconciled.execution, 'skipped');
  assert.equal(reconciled.run.scheduler_state.node_statuses.scope, 'passed');
  assert.deepEqual(operations.readJournal(dirs.effectJournalDir).entries.map((entry) => entry.state),
    ['pending', 'completed']);
});

test('nonrepeatable ambiguity blocks until an evidenced retry resolution', (dirs) => {
  const base = operations.createResearchFleetBundle(
    ['claims', 'taxonomy', 'fit'], { now: times[0] });
  const graph = JSON.parse(JSON.stringify(base.graph));
  graph.nodes.find((node) => node.node_id === 'scope').effect_class = 'external-nonrepeatable';
  const bundle = { graph, operation: base.operation };
  let run = initialize(bundle, dirs, 'run-nonrepeatable-proof');
  const payloadDigest = operations.sha256Digest({ node: 'scope', payload: 2 });
  run = operations.startGraphNodeEffect({
    graph,
    run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    now: times[1],
  }).run;

  const pendingCheckpoint = operations.readJournal(dirs.effectJournalDir).entries[0];
  assert.throws(() => operations.appendJournalEntry(dirs.effectJournalDir, {
    run_id: pendingCheckpoint.run_id,
    attempt_id: pendingCheckpoint.attempt_id,
    idempotency_key: pendingCheckpoint.idempotency_key,
    effect_class: pendingCheckpoint.effect_class,
    state: 'pending',
    payload_digest: pendingCheckpoint.payload_digest,
    evidence_digest: null,
  }, { now: times[2] }), /retryable resolution/,
  'the journal itself must reject an unevidenced nonrepeatable retry');

  const blocked = operations.startGraphNodeEffect({
    graph,
    run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    now: times[2],
  });
  assert.equal(blocked.execution, 'blocked');
  assert.equal(blocked.reason_code, 'AMBIGUOUS_NONREPEATABLE_EFFECT');
  assert.equal(operations.planGraphExecutionRecovery(
    dirs.graphJournalDir, dirs.effectJournalDir, graph).status, 'blocked');

  const mismatch = operations.startGraphNodeEffect({
    graph,
    run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest: operations.sha256Digest({ different: true }),
    now: times[2],
  });
  assert.equal(mismatch.reason_code, 'PAYLOAD_DIGEST_MISMATCH');

  const resolved = operations.resolveGraphNodeEffect({
    graph,
    run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    resolution: 'retryable',
    evidenceDigest: operations.sha256Digest({ review: 'effect-not-observed' }),
    now: times[3],
  });
  assert.equal(resolved.execution, 'retry_authorized');
  assert.equal(resolved.run.scheduler_state.node_statuses.scope, 'blocked');

  const retried = operations.startGraphNodeEffect({
    graph,
    run: resolved.run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    now: times[4],
  });
  assert.equal(retried.execution, 'retry');
  const completed = operations.completeGraphNodeEffect({
    graph,
    run: retried.run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    evidenceDigest: operations.sha256Digest({ external_receipt: 'verified' }),
    now: times[5],
  });
  assert.equal(completed.run.scheduler_state.node_statuses.scope, 'passed');
  assert.deepEqual(operations.readJournal(dirs.effectJournalDir).entries.map((entry) => entry.state),
    ['pending', 'retryable', 'pending', 'completed']);
});

test('corrupt effect journals block integrated recovery and operation mismatches fail closed', (dirs) => {
  const bundle = operations.createResearchFleetBundle(
    ['claims', 'taxonomy', 'fit'], { now: times[0] });
  let run = initialize(bundle, dirs, 'run-corrupt-effect-proof');
test('reviewed completion resolves an ambiguous nonrepeatable node without rerunning it', (dirs) => {
  const base = operations.createResearchFleetBundle(
    ['claims', 'taxonomy', 'fit'], { now: times[0] });
  const graph = JSON.parse(JSON.stringify(base.graph));
  graph.nodes.find((node) => node.node_id === 'scope').effect_class = 'external-nonrepeatable';
  let run = initialize({ graph }, dirs, 'run-reviewed-completion');
  const payloadDigest = operations.sha256Digest({ node: 'scope', payload: 4 });
  run = operations.startGraphNodeEffect({
    graph, run, graphJournalDir: dirs.graphJournalDir, effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope', payloadDigest, now: times[1],
  }).run;
  const resolved = operations.resolveGraphNodeEffect({
    graph, run, graphJournalDir: dirs.graphJournalDir, effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope', payloadDigest, resolution: 'completed',
    evidenceDigest: operations.sha256Digest({ review: 'effect-confirmed' }), now: times[2],
  });
  assert.equal(resolved.execution, 'recorded');
  assert.equal(resolved.run.scheduler_state.node_statuses.scope, 'passed');
  assert.deepEqual(operations.readJournal(dirs.effectJournalDir).entries.map((entry) => entry.state),
    ['pending', 'completed']);
});

  const payloadDigest = operations.sha256Digest({ node: 'scope', payload: 3 });
  run = operations.startGraphNodeEffect({
    graph: bundle.graph,
    run,
    graphJournalDir: dirs.graphJournalDir,
    effectJournalDir: dirs.effectJournalDir,
    nodeId: 'scope',
    payloadDigest,
    now: times[1],
  }).run;
  const file = path.join(dirs.effectJournalDir, '00000001.json');
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  entry.payload_digest = operations.sha256Digest({ tampered: true });
  fs.writeFileSync(file, JSON.stringify(entry));
  const recovery = operations.planGraphExecutionRecovery(
    dirs.graphJournalDir, dirs.effectJournalDir, bundle.graph);
  assert.equal(recovery.status, 'blocked');
  assert.equal(recovery.reason_code, 'EFFECT_JOURNAL_CORRUPT');

  const wrongOperation = { ...bundle.operation, title: 'Changed binding' };
  assert.throws(() => operations.assertGraphOperationBinding(bundle.graph, wrongOperation),
    /operation digest/);
});

test('the guarded CLI completes a local Research graph trial and writes its proof bundle', (dirs) => {
  const graphRunner = path.join(__dirname, 'operation-graph-runner.js');
  const effectRunner = path.join(__dirname, 'operation-graph-effects.js');
  const invoke = (script, args) => JSON.parse(require('child_process').execFileSync(
    process.execPath, [script, ...args], { cwd: dirs.root, encoding: 'utf8' }));
  const graphPath = '.planning/research/cli-proof/operation-graph.json';
  const operationPath = '.planning/research/cli-proof/operation-spec.json';
  const graphJournal = '.planning/research/cli-proof/graph-journal';
  const effectJournal = '.planning/research/cli-proof/effect-journal';
  const receiptPath = '.planning/research/cli-proof/protocol-proof.json';
  invoke(graphRunner, [
    'research-init', '--project-root', dirs.root, '--graph', graphPath, '--operation', operationPath,
    '--journal', graphJournal, '--run-id', 'run-cli-effect-proof',
    '--angles', 'claims,taxonomy,fit', '--now', times[0],
  ]);
  const graph = JSON.parse(fs.readFileSync(path.join(dirs.root, graphPath), 'utf8'));
  let clock = 1;
  while (true) {
    const run = operations.readGraphRunJournal(path.join(dirs.root, graphJournal), graph).latest_run;
    if (run.status === 'passed') break;
    const ready = operations.evaluateGraph(graph, run.scheduler_state).ready_node_ids;
    assert(ready.length > 0);
    for (const nodeId of ready) {
      const payload = operations.sha256Digest({ cli_node: nodeId, payload: clock });
      const evidence = operations.sha256Digest({ cli_node: nodeId, evidence: clock });
      const common = [
        '--project-root', dirs.root, '--graph', graphPath, '--journal', graphJournal,
        '--effects', effectJournal, '--node', nodeId, '--payload-digest', payload,
      ];
      assert.equal(invoke(effectRunner, ['start', ...common, '--now', times[clock++]]).status, 'ready');
      assert.equal(invoke(effectRunner, [
        'complete', ...common, '--evidence-digest', evidence, '--now', times[clock++],
      ]).status, 'completed');
    }
  }
  const status = invoke(effectRunner, [
    'status', '--project-root', dirs.root, '--graph', graphPath, '--journal', graphJournal,
    '--effects', effectJournal,
  ]);
  assert.equal(status.status, 'complete');
  const receipt = invoke(effectRunner, [
    'receipt', '--project-root', dirs.root, '--graph', graphPath, '--journal', graphJournal,
    '--effects', effectJournal, '--operation', operationPath, '--receipt', receiptPath,
    '--issuer', 'issuer-local', '--now', times[clock],
  ]);
  assert.equal(receipt.receipt_status, 'passed');
  const proof = JSON.parse(fs.readFileSync(path.join(dirs.root, receiptPath), 'utf8'));
  assert.equal(proof.receipt_envelope.receipt.status, 'passed');
  assert.equal(proof.evidence.length, graph.nodes.length);
});

process.stdout.write('Operation Graph effect tests: ' + passed + ' passed.\n');

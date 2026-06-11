#!/usr/bin/env node

'use strict';

// End-to-end test for scripts/telemetry-otlp-export.js.
//
// Spins up a local http server as a fake OTLP collector, builds a temp
// .planning/telemetry with synthetic records of each type, then verifies:
// payload shape and values, incremental state (second run exports nothing),
// dry-run not advancing state, non-2xx exit 1 with retry delivering the same
// records exactly once, truncation recovery, and --reset.

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const EXPORTER = path.join(__dirname, 'telemetry-otlp-export.js');

const TS_COST_1 = '2026-06-01T10:00:00.000Z';
const TS_COST_2 = '2026-06-01T11:00:00.000Z';
const TS_COST_3 = '2026-06-01T12:00:00.000Z';
const TS_TIMING_1 = '2026-06-01T10:05:00.000Z';
const TS_TIMING_2 = '2026-06-01T10:07:00.000Z';
const TS_RUN_1 = '2026-06-01T10:10:00.000Z';
const TS_RUN_2 = '2026-06-01T10:12:00.000Z';

function jsonl(records) {
  return records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n') + '\n';
}

function toNano(timestamp) {
  return (BigInt(Date.parse(timestamp)) * 1000000n).toString();
}

function runExporter(tmpRoot, extraArgs) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const child = spawn(process.execPath, [EXPORTER, '--project-root', tmpRoot, ...extraArgs], {
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function allMetrics(payload) {
  const metrics = [];
  for (const rm of payload.resourceMetrics || []) {
    for (const sm of rm.scopeMetrics || []) {
      for (const metric of sm.metrics || []) metrics.push(metric);
    }
  }
  return metrics;
}

function pointsOf(payload, name) {
  const metric = allMetrics(payload).find((m) => m.name === name);
  if (!metric) return [];
  if (metric.gauge) return metric.gauge.dataPoints || [];
  if (metric.sum) return metric.sum.dataPoints || [];
  return [];
}

function attrValue(point, key) {
  const found = (point.attributes || []).find((attribute) => attribute.key === key);
  return found ? found.value.stringValue : undefined;
}

function readState(tmpRoot) {
  const stateFile = path.join(tmpRoot, '.planning', 'telemetry', 'otlp-export-state.json');
  if (!fs.existsSync(stateFile)) return null;
  return fs.readFileSync(stateFile, 'utf8');
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-otlp-test-'));
  const telemetryDir = path.join(tmpRoot, '.planning', 'telemetry');
  fs.mkdirSync(telemetryDir, { recursive: true });

  const costsFile = path.join(telemetryDir, 'session-costs.jsonl');
  const timingFile = path.join(telemetryDir, 'hook-timing.jsonl');
  const runsFile = path.join(telemetryDir, 'agent-runs.jsonl');

  fs.writeFileSync(costsFile, jsonl([
    {
      schema: 2, timestamp: TS_COST_1, campaign_slug: 'm4', session_id: 'sess-1',
      agent_count: 1, duration_minutes: 10, estimated_cost: 2.5, override_cost: null,
      real_cost: 1.25, input_tokens: 1000, output_tokens: 2000,
      cache_creation_input_tokens: 300, cache_read_input_tokens: 4000,
      messages: 12, subagent_count: 0,
    },
    {
      schema: 2, timestamp: TS_COST_2, campaign_slug: null, session_id: 'sess-2',
      agent_count: 0, duration_minutes: 5, estimated_cost: 0.8, override_cost: null,
    },
  ]));

  fs.writeFileSync(timingFile, jsonl([
    { schema: 1, hook: 'post-edit', event: 'timing', duration_ms: 42, timestamp: TS_TIMING_1 },
    { schema: 1, hook: 'circuit-breaker', event: 'counter', metric: 'count', timestamp: '2026-06-01T10:06:00.000Z' },
    'this line is not json {{{',
    { schema: 1, hook: 'quality-gate', event: 'timing', duration_ms: 7.5, timestamp: TS_TIMING_2 },
  ]));

  fs.writeFileSync(runsFile, jsonl([
    {
      schema: 1, timestamp: TS_RUN_1, event: 'agent-complete', agent: 'builder',
      session: 'sess-1', duration_ms: 120000, status: 'success', campaign_slug: 'm4',
    },
    {
      schema: 1, timestamp: TS_RUN_2, event: 'agent-fail', agent: 'reviewer',
      session: 'sess-1', duration_ms: 60000, status: 'failed', campaign_slug: 'm4',
    },
  ]));

  const received = [];
  let failures = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const entry = {
        method: req.method,
        url: req.url,
        contentType: req.headers['content-type'],
        body,
        status: 200,
      };
      if (failures > 0) {
        failures--;
        entry.status = 500;
        received.push(entry);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('injected failure');
        return;
      }
      received.push(entry);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;

  try {
    // Test 1: dry run before any state exists. Prints payload, no POST, no state.
    const dry1 = await runExporter(tmpRoot, ['--dry-run']);
    assert.strictEqual(dry1.code, 0, `dry run exit code: ${dry1.stderr}`);
    const dryPayload = JSON.parse(dry1.stdout);
    assert.ok(Array.isArray(dryPayload.resourceMetrics), 'dry run payload has resourceMetrics');
    const dryNames = allMetrics(dryPayload).map((m) => m.name).sort();
    assert.deepStrictEqual(dryNames, [
      'citadel.agent.runs',
      'citadel.hook.duration.ms',
      'citadel.session.cost.usd',
      'citadel.session.tokens',
    ], 'dry run metric names');
    assert.strictEqual(readState(tmpRoot), null, 'dry run must not create state');
    assert.strictEqual(received.length, 0, 'dry run must not POST');
    console.log('PASS dry run prints payload without POSTing or writing state');

    // Test 2: first real export.
    const run1 = await runExporter(tmpRoot, ['--endpoint', endpoint]);
    assert.strictEqual(run1.code, 0, `first export exit code: ${run1.stderr}`);
    assert.strictEqual(received.length, 1, 'collector received one request');
    assert.strictEqual(received[0].method, 'POST');
    assert.strictEqual(received[0].url, '/v1/metrics', 'path /v1/metrics appended to bare endpoint');
    assert.ok(received[0].contentType.includes('application/json'), 'Content-Type application/json');

    const payload1 = JSON.parse(received[0].body);
    const resourceAttrs = payload1.resourceMetrics[0].resource.attributes;
    assert.ok(resourceAttrs.some((a) => a.key === 'service.name' && a.value.stringValue === 'citadel'),
      'resource has service.name=citadel');
    assert.ok(resourceAttrs.some((a) => a.key === 'citadel.project'), 'resource has project attribute');

    const costPoints = pointsOf(payload1, 'citadel.session.cost.usd');
    assert.strictEqual(costPoints.length, 2, 'two cost data points');
    const realPoint = costPoints.find((p) => p.asDouble === 1.25);
    assert.ok(realPoint, 'real_cost 1.25 exported');
    assert.strictEqual(attrValue(realPoint, 'session.id'), 'sess-1');
    assert.strictEqual(attrValue(realPoint, 'cost.source'), 'real');
    assert.strictEqual(attrValue(realPoint, 'campaign.slug'), 'm4');
    assert.strictEqual(realPoint.timeUnixNano, toNano(TS_COST_1), 'cost timestamp from JSONL record');
    const estPoint = costPoints.find((p) => p.asDouble === 0.8);
    assert.ok(estPoint, 'estimated_cost 0.8 exported');
    assert.strictEqual(attrValue(estPoint, 'cost.source'), 'estimated');

    const tokenPoints = pointsOf(payload1, 'citadel.session.tokens');
    assert.strictEqual(tokenPoints.length, 4, 'four token data points (record 2 has no token fields)');
    const tokensByType = {};
    for (const point of tokenPoints) tokensByType[attrValue(point, 'token.type')] = point.asInt;
    assert.deepStrictEqual(tokensByType, {
      input: '1000', output: '2000', cache_creation: '300', cache_read: '4000',
    }, 'token values by type');

    const durationPoints = pointsOf(payload1, 'citadel.hook.duration.ms');
    assert.strictEqual(durationPoints.length, 2, 'two timing points (counter event has no mapping)');
    assert.deepStrictEqual(durationPoints.map((p) => p.asDouble).sort((a, b) => a - b), [7.5, 42]);
    assert.deepStrictEqual(durationPoints.map((p) => attrValue(p, 'hook.name')).sort(),
      ['post-edit', 'quality-gate']);
    assert.strictEqual(
      durationPoints.find((p) => p.asDouble === 42).timeUnixNano, toNano(TS_TIMING_1),
      'timing timestamp from JSONL record');

    const runPoints = pointsOf(payload1, 'citadel.agent.runs');
    assert.strictEqual(runPoints.length, 2, 'two agent run points');
    assert.ok(runPoints.every((p) => p.asInt === '1'), 'agent runs counted as 1 each');
    assert.deepStrictEqual(runPoints.map((p) => attrValue(p, 'run.status')).sort(),
      ['failed', 'success']);

    assert.ok(/1 malformed/.test(run1.stdout), `malformed line counted in summary: ${run1.stdout}`);
    assert.ok(readState(tmpRoot) !== null, 'state file written after success');
    console.log('PASS first export delivers expected metrics, values, timestamps, malformed count');

    // Test 3: second run exports zero new data points.
    const run2 = await runExporter(tmpRoot, ['--endpoint', endpoint]);
    assert.strictEqual(run2.code, 0, `second export exit code: ${run2.stderr}`);
    assert.strictEqual(received.length, 1, 'no new POST on second run');
    assert.ok(/No new data points/.test(run2.stdout), `second run reports nothing new: ${run2.stdout}`);
    console.log('PASS second run exports zero new data points');

    // Test 4: dry run with a pending record does not advance state.
    fs.appendFileSync(costsFile, JSON.stringify({
      schema: 2, timestamp: TS_COST_3, campaign_slug: 'm4', session_id: 'sess-3',
      agent_count: 0, duration_minutes: 2, estimated_cost: 0.9, override_cost: null, real_cost: 0.5,
    }) + '\n');
    const stateBeforeDry = readState(tmpRoot);
    const dry2 = await runExporter(tmpRoot, ['--dry-run']);
    assert.strictEqual(dry2.code, 0, `dry run 2 exit code: ${dry2.stderr}`);
    const dry2Payload = JSON.parse(dry2.stdout);
    const dry2Costs = pointsOf(dry2Payload, 'citadel.session.cost.usd');
    assert.strictEqual(dry2Costs.length, 1, 'dry run sees exactly the one pending record');
    assert.strictEqual(dry2Costs[0].asDouble, 0.5);
    assert.strictEqual(readState(tmpRoot), stateBeforeDry, 'dry run must not advance state');
    assert.strictEqual(received.length, 1, 'dry run must not POST');
    console.log('PASS dry run does not advance state');

    // Test 5: non-2xx exits 1 without advancing state, retry delivers once.
    failures = 1;
    const failRun = await runExporter(tmpRoot, ['--endpoint', endpoint]);
    assert.strictEqual(failRun.code, 1, 'non-2xx response exits 1');
    assert.ok(/HTTP 500/.test(failRun.stderr), `error printed: ${failRun.stderr}`);
    assert.strictEqual(received.length, 2, 'failed request reached collector');
    assert.strictEqual(received[1].status, 500);
    assert.strictEqual(readState(tmpRoot), stateBeforeDry, 'state not advanced on failure');

    const retryRun = await runExporter(tmpRoot, ['--endpoint', endpoint]);
    assert.strictEqual(retryRun.code, 0, `retry exit code: ${retryRun.stderr}`);
    assert.strictEqual(received.length, 3, 'retry POSTed again');
    assert.strictEqual(received[2].status, 200);
    const retryPayload = JSON.parse(received[2].body);
    const retryCosts = pointsOf(retryPayload, 'citadel.session.cost.usd');
    assert.strictEqual(retryCosts.length, 1, 'retry exports exactly the pending record');
    assert.strictEqual(retryCosts[0].asDouble, 0.5);
    assert.strictEqual(attrValue(retryCosts[0], 'session.id'), 'sess-3');

    // Exactly-once across all accepted (2xx) requests.
    const acceptedCostValues = [];
    const acceptedDurations = [];
    let acceptedRunPoints = 0;
    for (const entry of received) {
      if (entry.status !== 200) continue;
      const payload = JSON.parse(entry.body);
      for (const point of pointsOf(payload, 'citadel.session.cost.usd')) acceptedCostValues.push(point.asDouble);
      for (const point of pointsOf(payload, 'citadel.hook.duration.ms')) acceptedDurations.push(point.asDouble);
      acceptedRunPoints += pointsOf(payload, 'citadel.agent.runs').length;
    }
    assert.deepStrictEqual(acceptedCostValues.sort((a, b) => a - b), [0.5, 0.8, 1.25],
      'each cost record accepted exactly once overall');
    assert.deepStrictEqual(acceptedDurations.sort((a, b) => a - b), [7.5, 42],
      'each timing record accepted exactly once overall');
    assert.strictEqual(acceptedRunPoints, 2, 'each agent run accepted exactly once overall');
    console.log('PASS 500 exits 1 without advancing state, retry delivers exactly once');

    // Test 6: truncated file resets the offset instead of crashing.
    fs.writeFileSync(timingFile, jsonl([
      { schema: 1, hook: 'protect-files', event: 'timing', duration_ms: 99, timestamp: '2026-06-01T13:00:00.000Z' },
    ]));
    const truncRun = await runExporter(tmpRoot, ['--endpoint', endpoint]);
    assert.strictEqual(truncRun.code, 0, `truncation run exit code: ${truncRun.stderr}`);
    assert.strictEqual(received.length, 4, 'truncation run POSTed');
    const truncPayload = JSON.parse(received[3].body);
    const truncDurations = pointsOf(truncPayload, 'citadel.hook.duration.ms');
    assert.strictEqual(truncDurations.length, 1, 'one timing point after truncation reset');
    assert.strictEqual(truncDurations[0].asDouble, 99);
    assert.strictEqual(pointsOf(truncPayload, 'citadel.session.cost.usd').length, 0,
      'no duplicate cost points after truncation reset');
    console.log('PASS truncated file resets offset and re-exports cleanly');

    // Test 7: --reset clears offsets so a dry run sees everything again.
    const resetRun = await runExporter(tmpRoot, ['--reset']);
    assert.strictEqual(resetRun.code, 0, `reset exit code: ${resetRun.stderr}`);
    const resetState = JSON.parse(readState(tmpRoot));
    assert.deepStrictEqual(resetState.offsets, {}, 'reset clears offsets');
    const dry3 = await runExporter(tmpRoot, ['--dry-run']);
    assert.strictEqual(dry3.code, 0);
    const dry3Payload = JSON.parse(dry3.stdout);
    assert.strictEqual(pointsOf(dry3Payload, 'citadel.session.cost.usd').length, 3,
      'after reset all cost records are pending again');
    assert.strictEqual(received.length, 4, 'reset and dry run never POST');
    console.log('PASS --reset clears state offsets');

    console.log('\nAll telemetry OTLP exporter tests passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL', error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});

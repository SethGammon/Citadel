#!/usr/bin/env node

'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { recordAppArtifact, readAppArtifacts } = require('../core/codex/native-integrations');
const { logAgentRunEvent, resolveTelemetryPaths } = require('../core/telemetry/log');
const {
  hashRecord,
  verifyJsonlFile,
  verifyProjectTelemetry,
  verifyRecord,
} = require('../core/telemetry/integrity');

function withTempProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-integrity-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

assert.equal(
  hashRecord({ b: 2, a: 1 }),
  hashRecord({ a: 1, b: 2 }),
  'hashRecord should be key-order independent'
);

withTempProject((projectRoot) => {
  const result = logAgentRunEvent({
    event: 'agent-complete',
    agent: 'fleet',
    session: 'session-1',
    run_id: 'run-1',
    task_id: 'task-2',
    parent_id: 'task-1',
    source_event_id: 'evt-source',
    duration: 100,
    status: 'success',
  }, {
    projectRoot,
    timestamp: '2026-06-04T12:00:00.000Z',
    hmacKey: 'secret',
    hmacKeyId: 'test-key',
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.entry.run_id, 'run-1');
  assert.equal(result.entry.agent_id, 'agent_fleet');
  assert.equal(result.entry.task_id, 'task-2');
  assert.equal(result.entry.parent_id, 'task-1');
  assert.equal(result.entry.source_event_id, 'evt-source');
  assert(result.entry.event_id.startsWith('evt_'));
  assert.equal(result.entry._hash.length, 64);
  assert.equal(result.entry._signature_alg, 'hmac-sha256');
  assert.equal(verifyRecord(result.entry, { hmacKey: 'secret' }).status, 'verified-signed');

  const paths = resolveTelemetryPaths(projectRoot);
  const fileReport = verifyJsonlFile(paths.agentRuns, { hmacKey: 'secret' });
  assert.equal(fileReport.verified, 1);
  assert.equal(fileReport.signed, 1);
  assert.equal(fileReport.tampered.length, 0);

  const artifact = recordAppArtifact({
    projectRoot,
    workflow: 'qa',
    kind: 'screenshot',
    path: '.planning/screenshots/flow.png',
    status: 'pass',
    run_id: 'run-1',
    agent_id: 'agent_fleet',
    task_id: 'task-2',
    source_event_id: result.entry.event_id,
    hmacKey: 'secret',
  });
  assert(artifact.artifact_id.startsWith('art_'));
  assert.equal(artifact.run_id, 'run-1');
  assert.equal(artifact.task_id, 'task-2');
  assert.equal(artifact.source_event_id, result.entry.event_id);
  assert.equal(readAppArtifacts(projectRoot).length, 1);

  const projectReport = verifyProjectTelemetry(projectRoot, { hmacKey: 'secret' });
  assert.equal(projectReport.totals.total, 2);
  assert.equal(projectReport.totals.verified, 2);
  assert.equal(projectReport.totals.signed, 2);

  const cliJson = execFileSync(process.execPath, [
    path.join(__dirname, 'verify-telemetry-integrity.js'),
    '--project-root',
    projectRoot,
    '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, CITADEL_TELEMETRY_HMAC_KEY: 'secret' },
  });
  assert.equal(JSON.parse(cliJson).pass, true, 'CLI verifier should pass untampered signed records');

  const entries = readJsonl(paths.agentRuns);
  entries[0].status = 'failed';
  fs.writeFileSync(paths.agentRuns, `${JSON.stringify(entries[0])}\n`, 'utf8');
  const tampered = verifyJsonlFile(paths.agentRuns, { hmacKey: 'secret' });
  assert.equal(tampered.tampered.length, 1, 'modified record should fail hash verification');

  let failed = false;
  try {
    execFileSync(process.execPath, [
      path.join(__dirname, 'verify-telemetry-integrity.js'),
      '--project-root',
      projectRoot,
      '--file',
      paths.agentRuns,
      '--json',
    ], {
      encoding: 'utf8',
      env: { ...process.env, CITADEL_TELEMETRY_HMAC_KEY: 'secret' },
    });
  } catch (error) {
    failed = true;
    const report = JSON.parse(error.stdout);
    assert.equal(report.pass, false);
    assert.equal(report.totals.tampered, 1);
  }
  assert.equal(failed, true, 'CLI verifier should fail on tampered records');
});

withTempProject((projectRoot) => {
  const filePath = path.join(projectRoot, '.planning', 'telemetry', 'agent-runs.jsonl');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    timestamp: '2026-06-04T12:00:00.000Z',
    event: 'agent-start',
    agent: 'legacy',
  })}\n`, 'utf8');

  const report = verifyProjectTelemetry(projectRoot);
  assert.equal(report.totals.legacy, 1);
  assert.equal(report.totals.tampered, 0);

  const cli = execFileSync(process.execPath, [
    path.join(__dirname, 'verify-telemetry-integrity.js'),
    '--project-root',
    projectRoot,
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(JSON.parse(cli).pass, true, 'legacy records should be allowed by default');
});

console.log('telemetry integrity tests passed');

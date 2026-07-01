#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENTS_SOURCE = path.join(PROJECT_ROOT, 'examples', 'berman-agents-md-only', 'AGENTS.md');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-agents-md-only-'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function extractStewardScript(agentsMd) {
  const match = agentsMd.match(/<!-- BEGIN_STEWARD_SCRIPT -->\s*```js\n([\s\S]*?)\n```\s*<!-- END_STEWARD_SCRIPT -->/);
  assert(match, 'AGENTS.md must contain a BEGIN_STEWARD_SCRIPT JavaScript block');
  return match[1];
}

function bootstrapFromAgentsMd(projectRoot) {
  const agentsMd = fs.readFileSync(AGENTS_SOURCE, 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), agentsMd, 'utf8');

  const initialFiles = fs.readdirSync(projectRoot);
  assert.deepEqual(initialFiles, ['AGENTS.md'], 'fresh project should start with only AGENTS.md');

  const script = extractStewardScript(agentsMd);
  const stewardPath = path.join(projectRoot, '.agent-steward', 'deploy-steward.cjs');
  fs.mkdirSync(path.dirname(stewardPath), { recursive: true });
  fs.writeFileSync(stewardPath, script, 'utf8');
  return stewardPath;
}

function writeReady(projectRoot, number) {
  writeJson(path.join(projectRoot, '.agent-steward', 'ready', `pr-${number}.json`), {
    id: `pr-${number}`,
    pr: `https://github.com/acme/app/pull/${number}`,
    branch: `agent/${number}`,
    head: `pr-${number}-v0`,
    ready: true,
    verification: 'npm test',
    createdAt: `2026-06-20T00:00:${String(number).padStart(2, '0')}.000Z`,
  });
}

function seedFixture(projectRoot, count) {
  const prs = {};
  for (let number = 1; number <= count; number += 1) {
    prs[`pr-${number}`] = {
      url: `https://github.com/acme/app/pull/${number}`,
      branch: `agent/${number}`,
      baseVersion: 0,
      head: `pr-${number}-v0`,
      merged: false,
      pendingChecks: 0,
    };
  }
  writeJson(path.join(projectRoot, '.agent-steward', 'fixture-prs.json'), {
    mainVersion: 0,
    prs,
    merges: [],
    deploys: [],
    updates: [],
  });
}

function runSteward(projectRoot, stewardPath, cycle) {
  const result = childProcess.spawnSync(process.execPath, [
    stewardPath,
    '--root',
    projectRoot,
    '--provider',
    'fixture',
    '--scan',
    '--run',
    '--deploy',
    'fixture-deploy',
    '--cycle',
    String(cycle),
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

function main() {
  const projectRoot = tempProject();
  const stewardPath = bootstrapFromAgentsMd(projectRoot);
  const totalAgents = 15;
  const firstReadyAgents = 3;
  seedFixture(projectRoot, totalAgents);

  for (let number = 1; number <= firstReadyAgents; number += 1) {
    writeReady(projectRoot, number);
  }

  let finishedAt = null;
  for (let cycle = 1; cycle <= 100; cycle += 1) {
    if (cycle === 3) {
      for (let number = firstReadyAgents + 1; number <= totalAgents; number += 1) {
        writeReady(projectRoot, number);
      }
    }
    const result = runSteward(projectRoot, stewardPath, cycle);
    if (result.queue.length === totalAgents && result.queue.every((item) => item.status === 'landed')) {
      finishedAt = cycle;
      break;
    }
  }

  assert(finishedAt !== null, 'standalone AGENTS.md steward did not land all PRs');

  const fixture = readJson(path.join(projectRoot, '.agent-steward', 'fixture-prs.json'));
  const queue = readJson(path.join(projectRoot, '.agent-steward', 'queue.json'));
  const events = fs.readFileSync(path.join(projectRoot, '.agent-steward', 'events.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const mergesByCycle = new Map();
  for (const merge of fixture.merges) {
    const count = mergesByCycle.get(merge.cycle) || 0;
    mergesByCycle.set(merge.cycle, count + 1);
  }

  assert.equal(queue.length, totalAgents);
  assert.equal(queue.filter((item) => item.status === 'landed').length, totalAgents);
  assert.equal(fixture.merges.length, totalAgents);
  assert.equal(fixture.deploys.length, totalAgents);
  assert.equal(Math.max(...mergesByCycle.values()), 1, 'more than one PR merged in a cycle');
  assert(fixture.updates.length >= totalAgents - 1, 'expected stale PR updates as main advanced');
  assert(fixture.updates.some((entry) => entry.id === 'pr-2'), 'expected early ready PR #2 to become stale');
  assert(fixture.updates.some((entry) => entry.id === 'pr-15'), 'expected late PR #15 to update before landing');
  assert(events.some((event) => event.type === 'waiting-for-mergeability'), 'expected transient GitHub UNKNOWN mergeability waits');
  assert(events.some((event) => event.type === 'updated-branch'), 'expected updated-branch events');
  assert(events.some((event) => event.type === 'waiting-for-checks'), 'expected waiting-for-checks events');
  assert.deepEqual(
    fixture.merges.map((entry) => entry.id),
    Array.from({ length: totalAgents }, (_value, index) => `pr-${index + 1}`)
  );

  console.log('agents-md-only steward acceptance passed');
  console.log(`  project: ${projectRoot}`);
  console.log(`  finished cycles: ${finishedAt}`);
  console.log(`  merges: ${fixture.merges.length}`);
  console.log(`  deploys: ${fixture.deploys.length}`);
  console.log(`  branch updates: ${fixture.updates.length}`);
}

main();

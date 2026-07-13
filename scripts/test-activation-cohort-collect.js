#!/usr/bin/env node

'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cohort = require('../core/telemetry/activation-cohort');
const {
  API_ENDPOINT, collect, extractFencedJson, fetchDiscussionComments, parseApiPayload, parseComments,
} = require('../core/telemetry/activation-discussion');
const { parseArgs } = require('./activation-cohort-collect');

const ROOT = path.resolve(__dirname, '..');
const INITIAL = path.join(__dirname, 'fixtures', 'activation-discussion', 'initial-pages.json');
const AFTER_DELETION = path.join(__dirname, 'fixtures', 'activation-discussion', 'after-deletion.json');
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

function withTemp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-activation-discussion-'));
  return Promise.resolve().then(() => fn(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function fixtureComments(file = INITIAL) {
  return parseApiPayload(fs.readFileSync(file, 'utf8'));
}

function validSubmission() {
  return {
    schema: 1,
    kind: 'activation_cohort_submission',
    submission_id: 'activation-dddddddddddddddddddddddddddddddd',
    consent_aggregate: true,
    observation_day: 0,
    citadel_version: '1.1.0',
    journey: {
      event_count: 1,
      install_attempted: true,
      install_completed: false,
      setup_completed: false,
      route_completed: false,
      verified_handoff: false,
      resume_completed: false,
      return_session: false,
      install_failed: true,
      route_failed: false,
    },
  };
}

async function run() {
  await test('only json-tagged fenced blocks qualify for parsing', () => {
    const payload = JSON.stringify(validSubmission());
    const blocks = extractFencedJson([
      payload,
      `\`\`\`javascript\n${payload}\n\`\`\``,
      `\`\`\`json\n${payload}\n\`\`\``,
    ].join('\n'));
    assert.deepEqual(blocks, [payload]);
  });

  await test('an unqualified comment cannot become a cohort record', () => {
    const payload = JSON.stringify(validSubmission());
    const parsed = parseComments([{
      html_url: 'https://github.com/SethGammon/Citadel/discussions/182#discussioncomment-900',
      updated_at: '2026-07-13T00:00:00.000Z',
      body: `I used Citadel. ${payload}`,
    }], { now: new Date('2026-07-13T00:00:00.000Z') });
    assert.equal(parsed.envelopes.length, 0);
    assert.equal(parsed.stats.comments_without_fenced_json, 1);
  });

  await test('fixture mode performs no network or gh execution', () => withTemp(async (root) => {
    let calls = 0;
    const result = await collect({ root, fixture: INITIAL, dryRun: true,
      now: new Date('2026-07-20T00:00:00.000Z'), execFile: () => { calls += 1; throw new Error('network called'); } });
    assert.equal(calls, 0);
    assert.equal(result.source, 'fixture');
    assert.equal(result.reconciliation.records, 2);
    assert.equal(result.reconciliation.written, false);
    assert.equal(fs.existsSync(path.join(root, '.planning')), false);
  }));

  await test('paginated fixtures upsert duplicate opaque IDs by latest observation', () => {
    const parsed = parseComments(fixtureComments(), { now: new Date('2026-07-20T00:00:00.000Z') });
    assert.equal(parsed.envelopes.length, 2);
    const first = parsed.envelopes.find((item) => item.submission.submission_id.includes('aaaa'));
    assert.equal(first.submission.observation_day, 7);
    assert(first.evidence_url.endsWith('discussioncomment-104'));
    assert.equal(parsed.stats.invalid_json, 1);
    assert.equal(parsed.stats.invalid_submission, 1);
    assert.equal(parsed.stats.deleted_or_empty, 1);
  });

  await test('collector validates through the exact existing submission schema', () => {
    const submission = validSubmission();
    submission.extra = true;
    const parsed = parseComments([{
      html_url: 'https://github.com/SethGammon/Citadel/discussions/182#discussioncomment-901',
      updated_at: '2026-07-13T00:00:00.000Z',
      body: `\`\`\`json\n${JSON.stringify(submission)}\n\`\`\``,
    }], { now: new Date('2026-07-13T00:00:00.000Z') });
    assert.equal(parsed.envelopes.length, 0);
    assert.equal(parsed.stats.invalid_submission, 1);
  });

  await test('live collection uses read-only paginated gh api via execFile', async () => {
    let observed;
    const comments = await fetchDiscussionComments({ execFile: (file, args, options, callback) => {
      observed = { file, args, options };
      callback(null, fs.readFileSync(INITIAL, 'utf8'), '');
    } });
    assert.equal(comments.length, 7);
    assert.equal(observed.file, 'gh');
    assert.deepEqual(observed.args.slice(0, 4), ['api', API_ENDPOINT, '--paginate', '--slurp']);
    assert(observed.args.includes(API_ENDPOINT));
    assert(!observed.args.includes('--method'));
    assert(!observed.args.some((arg) => /POST|PATCH|DELETE/i.test(arg)));
    assert.equal(Object.prototype.hasOwnProperty.call(observed.options, 'env'), false);
  });

  await test('source URLs remain local and are absent from aggregate reports', () => withTemp(async (root) => {
    const result = await collect({ root, fixture: INITIAL, now: new Date('2026-07-20T00:00:00.000Z') });
    const files = cohort.sharePaths(root);
    const envelopes = cohort.parseJsonl(fs.readFileSync(files.cohort, 'utf8'));
    assert(envelopes.every((item) => item.evidence_url.includes('#discussioncomment-')));
    const publicReport = fs.readFileSync(files.report, 'utf8');
    assert(!publicReport.includes('discussioncomment-'));
    assert(!JSON.stringify(result.reconciliation.report).includes('evidence_url'));
  }));

  await test('edits replace current observations and deleted comments are removed', () => withTemp(async (root) => {
    await collect({ root, fixture: INITIAL, now: new Date('2026-07-20T00:00:00.000Z') });
    const second = await collect({ root, fixture: AFTER_DELETION, now: new Date('2026-07-21T00:00:00.000Z') });
    assert.equal(second.reconciliation.records, 1);
    assert.equal(second.reconciliation.removed_sources, 1);
    const stored = cohort.parseJsonl(fs.readFileSync(cohort.sharePaths(root).cohort, 'utf8'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].submission.observation_day, 8);
  }));

  await test('rate limits fail closed without modifying cohort state', () => withTemp(async (root) => {
    await collect({ root, fixture: INITIAL, now: new Date('2026-07-20T00:00:00.000Z') });
    const file = cohort.sharePaths(root).cohort;
    const before = fs.readFileSync(file, 'utf8');
    const error = new Error('gh: API rate limit exceeded');
    error.stderr = 'HTTP 403: API rate limit exceeded';
    await assert.rejects(() => collect({ root, execFile: (command, args, options, callback) => callback(error, '', error.stderr) }),
      (failure) => failure.code === 'rate_limited');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }));

  await test('invalid GitHub response JSON fails without producing records', async () => {
    await assert.rejects(() => fetchDiscussionComments({ execFile: (command, args, options, callback) => callback(null, '{bad', '') }),
      /response is invalid JSON/);
  });

  await test('CLI arguments expose only local fixture, root, dry-run, and JSON controls', () => {
    const parsed = parseArgs(['--fixture', INITIAL, '--root', ROOT, '--dry-run', '--json']);
    assert.equal(parsed.fixture, INITIAL);
    assert.equal(parsed.root, ROOT);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.json, true);
    assert.throws(() => parseArgs(['--method', 'POST']), /Unknown argument/);
  });

  if (process.exitCode) process.exit(process.exitCode);
  process.stdout.write(`Activation Discussion collector: ${passed} passed\n`);
}

run().catch((error) => {
  process.stderr.write(`Activation Discussion collector test harness failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});

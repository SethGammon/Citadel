#!/usr/bin/env node

/**
 * test-secrets-lens.js - Regression tests for the quality-gate secrets lens
 *
 * The secrets lens (hooks_src/quality-gate.js, lens id "secrets") sweeps
 * session-changed source files at Stop for credential shapes:
 *   - AWS access key ids (AKIA + 16 uppercase alphanumerics)
 *   - GitHub tokens (ghp_ classic, github_pat_ fine-grained)
 *   - Private key blocks (BEGIN ... PRIVATE KEY)
 *   - Slack tokens (xoxb- / xoxp- with realistic tails)
 *   - Generic secret-named keys assigned high-entropy literals (Shannon >= 3.5)
 *
 * False-positive lessons encoded as tests:
 *   - Identifiers like task_created must never match (the sk- substring trap)
 *   - Placeholder values (${VAR}, <angle-brackets>, REDACTED, example) are skipped
 *   - .md documentation describing token formats never blocks
 *   - Low-entropy and prose assignments are not flagged
 *   - Violation messages never echo the matched value
 *
 * All fixture secrets are assembled from string fragments at runtime so this
 * test file itself never contains a contiguous credential-shaped literal.
 *
 * Run manually: node scripts/test-secrets-lens.js
 *
 * Exit codes:
 *   0 = all tests pass
 *   1 = one or more tests failed
 */

'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const QUALITY_GATE_HOOK = path.join(PLUGIN_ROOT, 'hooks_src', 'quality-gate.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err.message || String(err);
    failures.push({ name, msg });
    console.log(`  ✗ ${name}\n    ${msg}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ── Fixture secrets (synthesized at runtime, never present in this source) ──
// A seeded generator produces every credential-shaped value so this file
// contains no secret-shaped or high-entropy literals for scanners to match.

function synth(seed, length, charset) {
  let state = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) >>> 0;
    out += charset[state % charset.length];
  }
  return out;
}

const UPPER_NUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DIGITS = '0123456789';

const awsId = ['AKI', 'A'].join('') + synth(11, 16, UPPER_NUM);
const ghpVal = ['ghp', '_'].join('') + synth(22, 36, ALNUM);
const patVal = ['github', '_pat_'].join('') + synth(33, 22, ALNUM) + '_' + synth(44, 59, ALNUM);
const pemKind = ['PRIVATE', 'KEY'].join(' ');
const pemHeader = '-----BEGIN RSA ' + pemKind + '-----';
const pemFooter = '-----END RSA ' + pemKind + '-----';
const slackVal = ['xox', 'b-'].join('') + synth(55, 12, DIGITS) + '-' + synth(66, 12, DIGITS) + '-' + synth(77, 24, ALNUM);
const entropyVal = synth(88, 24, ALNUM); // high Shannon entropy at runtime only
const awsDocSample = ['AKI', 'A'].join('') + ['IOSFODNN7', 'EXAMPLE'].join(''); // canonical AWS docs key

// ── Temp project harness ──

function makeProject(files) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-secrets-'));
  const git = (args) => execFileSync('git', args, {
    cwd: proj,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  git(['init', '-q']);
  git(['config', 'user.email', 'citadel-test@local']);
  git(['config', 'user.name', 'Citadel Test']);
  git(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(proj, '.gitkeep'), '');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'baseline']);
  // Fixtures written after the baseline commit and staged, so the gate's
  // `git diff --name-only HEAD` sees them as session-changed files.
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(proj, name), content);
  }
  git(['add', '-A']);
  return proj;
}

function runGate(proj) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj };
  delete env.CITADEL_UI; // force plain additionalContext output
  return spawnSync(process.execPath, [QUALITY_GATE_HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop' }),
    encoding: 'utf8',
    cwd: proj,
    env,
  });
}

function cleanup(proj) {
  try { fs.rmSync(proj, { recursive: true, force: true }); } catch { /* best effort */ }
}

function main() {
  console.log('\nCitadel Secrets Lens Test Suite\n' + '='.repeat(40));

  // ── Positive project: one fixture file per pattern class ──

  const positiveProj = makeProject({
    'aws-config.js': `const cloudId = "${awsId}";\nmodule.exports = { cloudId };\n`,
    'gh-classic.js': `const ghAuth = "${ghpVal}";\nmodule.exports = { ghAuth };\n`,
    'gh-fine.js': `const ghFine = "${patVal}";\nmodule.exports = { ghFine };\n`,
    'pem-material.py': `KEY_MATERIAL = """${pemHeader}\nMIIEowIBAAKCAQEA\n${pemFooter}"""\n`,
    'slack-notify.js': `const hookAuth = "${slackVal}";\nmodule.exports = { hookAuth };\n`,
    'entropy-config.ts': `export const apiToken = "${entropyVal}";\n`,
  });

  const posResult = runGate(positiveProj);
  cleanup(positiveProj);
  const posOut = posResult.stdout || '';

  console.log('\n▶ Detection (positive fixtures)');

  test('gate exits 0 (advisory, never blocking)', () => {
    assert(posResult.status === 0, `Expected exit 0, got ${posResult.status}: ${posResult.stderr}`);
  });

  test('violations flow through additionalContext (advisory convention)', () => {
    assert(posOut.includes('additionalContext'), 'Expected additionalContext payload on stdout');
  });

  test('detects AWS access key id', () => {
    assert(posOut.includes('aws-access-key-id'), 'Expected aws-access-key-id class in output');
    assert(posOut.includes('aws-config.js'), 'Expected aws-config.js named in output');
  });

  test('detects classic GitHub token (ghp_)', () => {
    assert(posOut.includes('gh-classic.js') && posOut.includes('github-token'),
      'Expected github-token class for gh-classic.js');
  });

  test('detects fine-grained GitHub token (github_pat_)', () => {
    assert(posOut.includes('gh-fine.js'), 'Expected gh-fine.js named in output');
    assert(posOut.includes('fine-grained'), 'Expected fine-grained label in output');
  });

  test('detects private key block', () => {
    assert(posOut.includes('private-key-block'), 'Expected private-key-block class in output');
    assert(posOut.includes('pem-material.py'), 'Expected pem-material.py named in output');
  });

  test('detects Slack token', () => {
    assert(posOut.includes('slack-token'), 'Expected slack-token class in output');
    assert(posOut.includes('slack-notify.js'), 'Expected slack-notify.js named in output');
  });

  test('detects high-entropy literal assigned to secret-like key', () => {
    assert(posOut.includes('high-entropy-assignment'), 'Expected high-entropy-assignment class in output');
    assert(posOut.includes('entropy-config.ts'), 'Expected entropy-config.ts named in output');
  });

  test('never echoes matched secret values in messages', () => {
    for (const secret of [awsId, ghpVal, patVal, slackVal, entropyVal]) {
      assert(!posOut.includes(secret), 'Output must not contain the matched secret value');
    }
    assert(!posOut.includes('MIIEowIBAAKCAQEA'), 'Output must not contain key material');
  });

  // ── Negative project: hard-won false-positive set ──

  const negativeProj = makeProject({
    'events.js': [
      "EVENTS.emit('task_created', payload);",
      "EVENTS.emit('task_completed', payload);",
      "const risk_assessment = 'pending_manual_review_queue';",
      "const desk_check_status = 'awaiting_reviewer_signoff';",
      'const shortVal = "ghp_abc123"; // wrong length, not a real token shape',
      '',
    ].join('\n'),
    'placeholders.js': [
      ['const api', 'Key = "${SOME_VAR_FROM_ENV}";'].join(''),
      ['const pass', 'word = "<your-key-here>";'].join(''),
      ['const client', 'Secret = "REDACTED_REDACTED_RED";'].join(''),
      ['const auth', 'Token = "example_credential_value_123";'].join(''),
      `const awsDocSample = "${awsDocSample}";`,
      '',
    ].join('\n'),
    'lowentropy.js': [
      ['const pass', 'word = "', 'a'.repeat(20), '";'].join(''),
      ['const token', 'Description = "this value is loaded by the operator at deploy time";'].join(''),
      '',
    ].join('\n'),
    'docs.md': [
      '# Token Formats',
      '',
      'AWS access key ids look like ' + awsId + ' and must be rotated.',
      'Classic GitHub tokens look like ' + ghpVal + ' in audit logs.',
      '',
    ].join('\n'),
  });

  const negResult = runGate(negativeProj);
  cleanup(negativeProj);
  const negOut = negResult.stdout || '';

  console.log('\n▶ False positives (negative fixtures)');

  test('gate exits 0 on negative project', () => {
    assert(negResult.status === 0, `Expected exit 0, got ${negResult.status}: ${negResult.stderr}`);
  });

  test('sk- substring trap: task_created and friends do not match', () => {
    assert(!negOut.includes('events.js'), `events.js must not be flagged, got: ${negOut}`);
  });

  test('placeholder values (${VAR}, <your-key-here>, REDACTED, example) are skipped', () => {
    assert(!negOut.includes('placeholders.js'), `placeholders.js must not be flagged, got: ${negOut}`);
  });

  test('low-entropy and prose assignments are not flagged', () => {
    assert(!negOut.includes('lowentropy.js'), `lowentropy.js must not be flagged, got: ${negOut}`);
  });

  test('.md documentation mentioning token formats does not trigger secrets lens', () => {
    assert(!negOut.includes('docs.md: [secrets]'), `docs.md must not get secrets violations, got: ${negOut}`);
  });

  test('no secrets-lens violations at all on the negative set', () => {
    assert(!negOut.includes('[secrets]'), `Expected zero [secrets] violations, got: ${negOut}`);
  });

  // ── Summary ──

  console.log('\n' + '='.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const { name, msg } of failures) {
      console.log(`  - ${name}:`);
      console.log(`    ${msg}`);
    }
    console.log('\nSecrets lens tests failed! Do not ship until these are fixed.\n');
    process.exit(1);
  }

  console.log('All secrets lens tests pass.\n');
  process.exit(0);
}

main();

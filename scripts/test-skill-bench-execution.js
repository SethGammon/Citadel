#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Exercise the real CLI in a disposable miniature plugin. The runtime adapter
// invokes Node as a deterministic fake CLI, so no model or account is contacted.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-bench-contract-'));
const script = path.join(fixture, 'scripts', 'skill-bench.js');
let passed = 0;
function put(relative, contents) {
  const file = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
function scenario(extra = '') {
  put('skills/example/__benchmarks__/case.md', [
    '---', 'name: case', 'skill: example', 'input: Return done.',
    'state: clean', 'assert-contains: [done]', extra, '---', '',
  ].filter(Boolean).join('\n') + '\n');
}
function invoke(args = [], env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: fixture, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CODEX_CLI_PATH: '', CITADEL_CODEX_BIN: '',
      CITADEL_CODEX_SERVICE_TIER: '', ...env },
  });
  assert.ifError(result.error);
  return result;
}
function rows(result) { return JSON.parse(result.stdout); }
function test(name, fn) {
  fn(); passed++;
  process.stdout.write(`PASS ${name}\n`);
}
const executeArgs = ['--execute', '--runtime', 'codex-exec', '--codex-bin', process.execPath, '--json'];

try {
  put('scripts/skill-bench.js', fs.readFileSync(path.join(__dirname, 'skill-bench.js')));
  put('core/codex/native-integrations.js', "module.exports = { buildCodexExecArgs: () => ['-e', 'process.stdout.write(\"done\")'] };\n");
  put('core/config/bundle-catalog.js', 'module.exports = { bundleForSkill: () => null };\n');
  put('scripts/codex-compat.js', 'process.exit(0);\n');
  put('skills/example/SKILL.md', '# Disposable benchmark fixture\n');
  scenario();

  test('static validation is explicit, JSON-readable, and does not execute', () => {
    const result = invoke(['--json']);
    assert.strictEqual(result.status, 0, result.stderr);
    const [row] = rows(result);
    assert.strictEqual(row.mode, 'static-only');
    assert.strictEqual(row.requestedMode, 'static');
    assert.strictEqual(row.executionAttempted, false);
  });
  test('requested missing runtime cannot silently become static success', () => {
    const result = invoke(['--execute', '--runtime', 'codex-exec', '--codex-bin', path.join(fixture, 'missing-cli'), '--json']);
    assert.strictEqual(result.status, 1);
    const [row] = rows(result);
    assert.strictEqual(row.passed, false);
    assert.strictEqual(row.executionAttempted, false);
    assert.strictEqual(row.requestedMode, 'execute');
    assert.match(row.executionError, /CLI unavailable/);
  });
  test('unknown runtime refuses before execution', () => {
    const result = invoke(['--execute', '--runtime', 'typo']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Unsupported runtime/);
  });
  test('hook verification requires live execution', () => {
    const result = invoke(['--verify-hooks']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /requires --execute/);
  });
  test('a real successful fake runtime is recorded separately from assertions', () => {
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 0, result.stderr);
    const [row] = rows(result);
    assert.strictEqual(row.executionAttempted, true);
    assert.strictEqual(row.executionSucceeded, true);
    assert.strictEqual(row.passed, true);
  });
  test('skipped-only execution cannot pass and skipped row never says passed', () => {
    scenario('skip-execute: true\nskip-reason: requires-agent-spawn');
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 1);
    const [row] = rows(result);
    assert.strictEqual(row.skipped, true);
    assert.strictEqual(row.passed, false);
    assert.strictEqual(row.executionAttempted, false);
    scenario();
  });
  test('invalid execution scenario cannot pass with zero assertions', () => {
    put('skills/example/__benchmarks__/case.md', '---\nname: case\nskill: example\ninput: Return done.\nstate: clean\n---\n');
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 1);
    const [row] = rows(result);
    assert.strictEqual(row.executionAttempted, false);
    assert.match(row.executionError, /Invalid scenario/);
    scenario();
  });
  test('runtime success does not override an assertion failure', () => {
    scenario('assert-contains: [absent-answer]');
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 1);
    const [row] = rows(result);
    assert.strictEqual(row.executionSucceeded, true);
    assert.strictEqual(row.passed, false);
    scenario();
  });
  test('empty assertion strings are rejected rather than matching every output', () => {
    scenario('assert-contains:\n  - ""');
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 1);
    assert.strictEqual(rows(result)[0].executionAttempted, false);
    assert.match(rows(result)[0].executionError, /nonblank strings/);
    scenario();
  });
  test('an empty-list input cannot become an executed prompt', () => {
    scenario('input:');
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 1);
    assert.strictEqual(rows(result)[0].executionAttempted, false);
    assert.match(rows(result)[0].executionError, /input must be/);
    scenario();
  });
  test('inherited object properties are not named project states', () => {
    scenario('state: toString');
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 1);
    assert.match(rows(result)[0].executionError, /unknown state/);
    scenario();
  });
  test('invalid file paths cannot pass by returning false from existsSync', () => {
    for (const invalid of ['bad\u0000path', '../outside', 'C:\\outside', 'NUL', 'path/']) {
      scenario(`assert-contains: []\nassert-files-absent:\n  - "${invalid}"`);
      const result = invoke(executeArgs);
      assert.strictEqual(result.status, 1, invalid);
      assert.strictEqual(rows(result)[0].executionAttempted, false);
      assert.match(rows(result)[0].executionError, /safe relative file paths/);
    }
    scenario();
  });
  test('a valid file-absence assertion is meaningful without text assertions', () => {
    scenario('assert-contains: []\nassert-files-absent: [uncreated.txt]');
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(rows(result)[0].passed, true);
    scenario();
  });
  test('result writes cannot overwrite another run in the same second', () => {
    const bench = require(script);
    const first = bench.writeResults([{ id: 'first' }]);
    const second = bench.writeResults([{ id: 'second' }]);
    assert.ok(first && second);
    assert.notStrictEqual(first, second);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(first, 'utf8')), { id: 'first' });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(second, 'utf8')), { id: 'second' });
  });
  test('malformed discovered scenarios cannot disappear from a passing denominator', () => {
    put('skills/example/__benchmarks__/broken.md', '# No frontmatter\n');
    const result = invoke(['--json']);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /could not be parsed/);
    assert.deepStrictEqual(rows(result), []);
    fs.unlinkSync(path.join(fixture, 'skills/example/__benchmarks__/broken.md'));
  });
  test('missing preserved execution evidence refuses success', () => {
    const results = path.join(fixture, '.planning', 'benchmark-results');
    const saved = path.join(fixture, '.planning', 'saved-results');
    fs.renameSync(results, saved);
    fs.writeFileSync(results, 'a file prevents the result directory');
    const result = invoke(executeArgs);
    assert.strictEqual(result.status, 1);
    assert.strictEqual(rows(result)[0].executionSucceeded, true);
    assert.match(result.stderr, /Could not preserve benchmark results/);
  });
  test('regex assertions accept hyphenation without accepting missing meaning or empty patterns', () => {
    const bench = require('./skill-bench');
    const specimen = { input: 'Describe bytes', state: 'clean', timeout: 1000, assertContains: [], assertNotContains: [], assertMatches: ['line[- ]endings?'] };
    assert.deepEqual(bench.validateScenario(specimen), []);
    assert(bench.runAssertions(specimen, 'Pin line-ending conversion').every(row => row.passed));
    assert(bench.runAssertions(specimen, 'Pin line endings').every(row => row.passed));
    assert(bench.runAssertions(specimen, 'Pin bytes').some(row => !row.passed));
    for (const pattern of ['', '.*', '[']) assert(bench.validateScenario({ ...specimen, assertMatches: [pattern] }).length);
  });
  test('native hook proof binds successful paired events to candidate and thread', () => {
    const { verifyHooks } = require('./skill-bench-native');
    const hookPath = path.join(fixture, '.codex/hooks.json');
    const options = { threadId: 'thread', turnId: 'turn', hookPath };
    const events = ['userPromptSubmit', 'stop'].flatMap((eventName, index) => ['started', 'completed'].map(status => ({
      method: `hook/${status}`, params: { threadId: 'thread', turnId: 'turn', run: {
        id: String(index), eventName, sourcePath: hookPath, status: status === 'started' ? 'running' : 'completed', entries: [],
      } },
    })));
    assert(verifyHooks(events, options).passed);
    assert(!verifyHooks([], options).passed);
    assert(!verifyHooks(events.slice(1), options).passed);
    for (const change of [
      event => { event.params.threadId = 'other'; },
      event => { event.params.turnId = 'other'; },
      event => { event.params.run.sourcePath = path.join(fixture, 'installed/hooks.json'); },
      event => { event.params.run.status = 'failed'; },
      event => { event.params.run.entries = [{ kind: 'error', text: 'failure' }]; },
    ]) {
      const changed = JSON.parse(JSON.stringify(events)); change(changed[1]);
      assert(!verifyHooks(changed, options).passed);
    }
  });
  test('native planning turns require exact candidate echo and refuse every observed action', () => {
    const { verifyTurn } = require('./skill-bench-native');
    const options = { threadId: 'thread', turnId: 'turn', prompt: 'exact candidate bytes' };
    const event = { method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed', items: [
      { id: 'input', type: 'userMessage', content: [{ type: 'text', text: options.prompt }] },
      { id: 'output', type: 'agentMessage', text: 'done' },
    ] } } };
    assert(verifyTurn([event], options).passed);
    assert(!verifyTurn([event], { ...options, threadId: 'other' }).passed);
    assert(!verifyTurn([event], { ...options, turnId: 'other' }).passed);
    assert(!verifyTurn([event], { ...options, prompt: 'different candidate' }).passed);
    for (const type of ['commandExecution', 'fileChange', 'mcpToolCall', 'collabAgentToolCall', 'unknown']) {
      const action = { method: 'item/started', params: { threadId: 'thread', turnId: 'turn', item: { id: 'action', type } } };
      assert(!verifyTurn([action, event], options).passed);
      const copy = JSON.parse(JSON.stringify(event)); copy.params.turn.items.push(action.params.item);
      assert(!verifyTurn([copy], options).passed);
    }
  });
  test('native shutdown is bounded even with a broken pipe and never-closing process', () => {
    const code = `const assert=require('assert'); const {boundedShutdown}=require(${JSON.stringify(path.join(__dirname, 'skill-bench-native.js'))});
      const stream={end(){throw Error('EPIPE')},destroy(){}}; let killed=false;
      const child={stdin:stream,stdout:stream,stderr:stream,kill(){killed=true},unref(){}};
      (async()=>{ const start=Date.now(); const result=await boundedShutdown(child,new Promise(()=>{}),10,10);
        assert(result.forced && !result.closed && killed); assert(Date.now()-start<2000);
        const clean=await boundedShutdown(child,Promise.resolve({code:0,signal:null}),10,10);
        assert(clean.closed && !clean.forced); })().catch(error=>{console.error(error);process.exitCode=1});`;
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  });
  process.stdout.write(`${passed} skill benchmark execution tests passed.\n`);
  process.exitCode = 0;
} catch (error) {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
} finally {
  // This exact mkdtemp directory is owned by this process and contains no user work.
  const resolved = fs.realpathSync(fixture);
  assert.strictEqual(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('citadel-bench-contract-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
process.exit(process.exitCode);

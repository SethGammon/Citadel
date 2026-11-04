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

  test('semantic scenario checks accept meaning but reject missing behavior and raw failures', () => {
    const bench = require('./skill-bench');
    const cases = [["create-skill","repeated-pattern","typecheck\nQ1: What do you repeat?","typecheck is available."],["dashboard","vague-status-phrase","Citadel Dashboard\nCAMPAIGNS\nHook errors: 0","Citadel Dashboard\nCAMPAIGNS\nTypeError: failed"],["design","extract-from-codebase","Colors #2563eb\nTypography\nSpacing\nMissing component patterns are undefined.","extract"],["experiment","no-metric","How to measure faster? Give a command that prints one number for a baseline.","metric"],["marshal","vague-direction","The task is undefined. What should I work on?","The task is undefined."],["do","no-planning-dir","Routing the login bug to /systematic-debugging; please provide source.","The login bug needs a source path."]];
    for (const [skill, name, accept, reject] of cases) {
      const spec = bench.parseScenario(path.join(__dirname, '..', 'skills', skill, '__benchmarks__', name + '.md'));
      assert.deepStrictEqual(bench.validateScenario(spec), [], skill + '/' + name);
      const textSpec = { ...spec, assertFilesAbsent: [], assertFilesUnchanged: [] };
      assert(bench.runAssertions(textSpec, accept, fixture).every(row => row.passed), skill + ' rejected valid meaning');
      assert(bench.runAssertions(textSpec, reject, fixture).some(row => !row.passed), skill + ' accepted missing meaning');
    }
  });
  test('evolve status fixture supplies prior cycles and detects history mutation', () => {
    const bench = require('./skill-bench');
    const project = bench.setupProjectState('with-evolve-history');
    try {
      const spec = bench.parseScenario(path.join(__dirname, '..', 'skills', 'evolve', '__benchmarks__', 'happy-path-status.md'));
      const state = path.join(project, '.planning', 'evolve', 'skill-md', 'director-state.json');
      const saved = JSON.parse(fs.readFileSync(state, 'utf8'));
      assert.equal(saved.cycle, 2);
      assert.equal(saved.cumulativeSpend, 4.5);
      assert.deepStrictEqual(saved.velocityHistory, [0.5, 0.25]);
      const snapshots = bench.captureFileSnapshots(project, spec.assertFilesUnchanged);
      assert(bench.runAssertions(spec, 'Belief model, velocity, spend.', project, snapshots).every(row => row.passed));
      fs.writeFileSync(state, JSON.stringify({ ...saved, cycle: 3 }));
      assert(bench.runAssertions(spec, 'Belief model, velocity, spend.', project, snapshots).some(row => !row.passed));
    } finally {
      const physical = fs.realpathSync(project);
      assert.equal(path.dirname(physical), fs.realpathSync(os.tmpdir()));
      assert(path.basename(physical).startsWith('citadel-bench-'));
      fs.rmSync(physical, { recursive: true, force: true });
    }
  });
  test('ablation cannot score a failed CLI as passed using its partial output', () => {
    const vm = require('vm');
    const filename = path.join(__dirname, 'noop-ablate.js');
    const project = path.join(fixture, 'ablation-project');
    let execution = { error: 'executor failed', output: 'done', timedOut: false };
    let assertionCalls = 0;
    const snapshots = { captured: true };
    const fakeRequire = request => request === './skill-bench' ? {
      discoverScenarios: () => [],
      setupProjectState: () => { fs.mkdirSync(project); return project; },
      executeClaudeScenario: () => execution,
      captureFileSnapshots: () => snapshots,
      runAssertions: (_scenario, _output, actualProject, actualSnapshots) => {
        assertionCalls++;
        assert.strictEqual(actualProject, project);
        assert.strictEqual(actualSnapshots, snapshots);
        return [{ passed: true }];
      },
      findClaudeCLI: () => 'unused',
    } : require(request);
    const loaded = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      require: fakeRequire, module: loaded, __dirname, process, console,
    }, { filename });
    let outcome = loaded.exports.runScenario({ state: 'clean' }, 'unused');
    assert.strictEqual(outcome.pass, null);
    assert.strictEqual(assertionCalls, 0);
    execution = { error: null, output: 'done', timedOut: true };
    outcome = loaded.exports.runScenario({ state: 'clean' }, 'unused');
    assert.strictEqual(outcome.pass, null);
    assert.strictEqual(assertionCalls, 0);
    execution = { error: null, output: 'done', timedOut: false };
    assert.strictEqual(loaded.exports.runScenario({ state: 'clean' }, 'unused').pass, true);
    assert.strictEqual(assertionCalls, 1);
  });
  test('live Claude checks retain normal permissions and exclude account scheduling tools', () => {
    const { claudeScenarioArgs } = require('./skill-bench');
    const args = claudeScenarioArgs({ skill: 'schedule', input: '/schedule list' });
    assert.strictEqual(args[args.indexOf('--permission-mode') + 1], 'default');
    assert.strictEqual(args[args.indexOf('--permission-prompts') + 1], 'none');
    assert(args.includes('--strict-mcp-config'));
    assert.strictEqual(args[args.indexOf('--disallowedTools') + 1], 'RemoteTrigger,CronCreate,CronDelete');
    assert.strictEqual(args.at(-1), '/citadel:schedule list');
    assert(!args.some(arg => /skip-permissions|bypassPermissions/.test(arg)));
  });
  test('file preservation cannot pass on missing, changed, linked, or outside files', () => {
    const bench = require('./skill-bench');
    const project = path.join(fixture, 'preservation');
    fs.mkdirSync(project);
    const file = path.join(project, 'authored.txt');
    fs.writeFileSync(file, 'authored');
    const spec = { input: 'Preserve file', state: 'clean', timeout: 1000, assertContains: [], assertNotContains: [], assertFilesUnchanged: ['authored.txt'] };
    assert.deepStrictEqual(bench.validateScenario(spec), []);
    const before = bench.captureFileSnapshots(project, spec.assertFilesUnchanged);
    assert(bench.runAssertions(spec, 'done', project, before).every(row => row.passed));
    fs.writeFileSync(file, 'changed');
    assert(bench.runAssertions(spec, 'unchanged', project, before).some(row => !row.passed));
    fs.unlinkSync(file);
    assert(bench.runAssertions(spec, 'unchanged', project, before).some(row => !row.passed));
    assert(bench.runAssertions(spec, 'unchanged', project, bench.captureFileSnapshots(project, spec.assertFilesUnchanged)).some(row => !row.passed));
    const outside = path.join(fixture, 'outside.txt');
    fs.writeFileSync(outside, 'authored');
    fs.linkSync(outside, file);
    assert.strictEqual(bench.captureFileSnapshots(project, ['authored.txt'])['authored.txt'], null);
    for (const bad of ['../outside.txt', '/outside.txt', 'C:\\outside.txt']) {
      assert(bench.validateScenario({ ...spec, assertFilesUnchanged: [bad] }).length);
    }
  });
  test('identical bytes under a replaced fixture root cannot prove preservation', () => {
    const bench = require('./skill-bench');
    const project = path.join(fixture, 'root-binding');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'authored.txt'), 'authored');
    const spec = { assertContains: [], assertNotContains: [], assertFilesUnchanged: ['authored.txt'] };
    const before = bench.captureFileSnapshots(project, spec.assertFilesUnchanged);
    fs.renameSync(project, project + '-original');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'authored.txt'), 'authored');
    assert(bench.runAssertions(spec, 'unchanged', project, before).some(row => !row.passed));
  });
  test('score-only fixture supplies an approved rubric and inspectable target', () => {
    const bench = require('./skill-bench');
    const project = bench.setupProjectState('with-scoring-rubric');
    try {
      const rubric = fs.readFileSync(path.join(project, '.planning', 'rubrics', 'citadel.md'), 'utf8');
      assert(rubric.includes('Status: approved'));
      assert.strictEqual((rubric.match(/^### Axis:/gm) || []).length, 2);
      assert(fs.existsSync(path.join(project, 'src', 'sum.js')));
    } finally {
      assert.strictEqual(path.dirname(project), path.resolve(os.tmpdir()));
      assert(path.basename(project).startsWith('citadel-bench-'));
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
  test('Claude execution selects this plugin instead of a colliding native short command', () => {
    const { scopedClaudeInput } = require('./skill-bench');
    assert.strictEqual(scopedClaudeInput({ skill: 'loop', input: '/loop run "npm run lint"' }), '/citadel:loop run "npm run lint"');
    assert.strictEqual(scopedClaudeInput({ skill: 'loop', input: '/loop' }), '/citadel:loop');
    for (const input of ['/citadel:loop run x', '/other:loop x', '/loop-other', 'what is happening?']) {
      assert.strictEqual(scopedClaudeInput({ skill: 'loop', input }), input);
    }
  });
  test('local daemon fixture survives initialization without promoting novice fixtures', () => {
    const bench = require('./skill-bench');
    const configAt = project => JSON.parse(fs.readFileSync(path.join(project, '.claude', 'harness.json'), 'utf8'));
    const novice = bench.setupProjectState('with-campaign');
    const approved = bench.setupProjectState('with-approved-local-daemon');
    try {
      assert.strictEqual(configAt(novice).trust?.sessionsCompleted || 0, 0);
      const init = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks_src', 'init-project.js')], {
        cwd: approved, input: '{}', encoding: 'utf8', timeout: 30000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: approved, CLAUDE_PLUGIN_DATA: path.join(approved, '.claude') },
      });
      assert.ifError(init.error);
      assert.strictEqual(init.status, 0, init.stderr);
      assert.strictEqual(configAt(approved).trust.sessionsCompleted, 20);
      assert.strictEqual(configAt(approved).trust.campaignsCompleted, 2);
      assert.strictEqual(fs.existsSync(path.join(approved, '.planning', 'daemon.json')), false);
      assert.strictEqual(configAt(novice).trust?.sessionsCompleted || 0, 0);
    } finally {
      for (const project of [novice, approved]) {
        assert.strictEqual(path.dirname(project), path.resolve(os.tmpdir()));
        assert(path.basename(project).startsWith('citadel-bench-'));
        fs.rmSync(project, { recursive: true, force: true });
      }
    }
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
  test('fatal IPC and cleanup uncertainty cannot be overwritten by earlier success', () => {
    const { finalizeResult } = require('./skill-bench-native');
    const clean = { closed: true, forced: false, exit: { code: 0, signal: null } };
    assert(finalizeResult({ passed: true }, clean, null).passed);
    for (const earlier of [{ passed: true, preflightOnly: true }, { passed: true, scenario: 'case' }]) {
      const result = finalizeResult(earlier, clean, new Error('fatal IPC during drain'));
      assert.equal(result.passed, false); assert.match(result.error, /fatal IPC during drain/);
      assert(!finalizeResult(earlier, { ...clean, forced: true }, null).passed);
      assert(!finalizeResult(earlier, { ...clean, closed: false }, null).passed);
      assert(!finalizeResult(earlier, { ...clean, exit: { code: 1 } }, null).passed);
    }
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

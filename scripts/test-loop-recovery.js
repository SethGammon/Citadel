#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createLoopContract } = require('../core/loops/contract');
const registry = require('../core/loops/registry');
const { inspectRecovery, recoveryPlan, assertRecoveryBinding } = require('../core/loops/recovery');
const { superviseLoop } = require('../core/loops/supervisor');

const cli = path.resolve(__dirname, 'loops.js');
const supervisor = path.resolve(__dirname, '../core/loops/supervisor.js');
const registryModule = path.resolve(__dirname, '../core/loops/registry.js');
const node = `"${process.execPath}"`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let tests = 0;

async function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-loop-recovery-'));
  try {
    const retain = await fn(root);
    if (retain) console.log(`Audit fixture retained at ${root}`);
    else fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    tests++; console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}; evidence retained at ${root}`);
    throw error;
  }
}

function script(root, name, source) {
  const file = path.join(root, `${name}.js`);
  fs.writeFileSync(file, source);
  return `${node} "${file}"`;
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--project-root', root], { encoding: 'utf8', timeout: 15000 });
}

function recoverArgs(source, extra = []) {
  return ['recover', source.id, '--verify-only', '--expected-revision', String(source.revision), ...extra];
}

async function eligible(root, options = {}) {
  const contract = registry.registerLoop(root, createLoopContract({
    id: 'source', type: 'foreground-loop', command: script(root, 'action', "require('fs').appendFileSync('actions.txt','action\\n')"),
    verifierCommand: script(root, 'verify', "require('fs').appendFileSync('checks.txt','check\\n')"),
    maxAttempts: 3, commandTimeoutMs: 5000, ...options,
  }));
  const controller = new AbortController();
  controller.abort();
  await superviseLoop(root, contract.id, { signal: controller.signal });
  const source = registry.readLoop(root, contract.id);
  assert.equal(inspectRecovery(source).decision, 'verification-followup-available');
  return source;
}

function bytes(root, id) { return fs.readFileSync(registry.loopPath(root, id), 'utf8'); }
function exists(root, file) { return fs.existsSync(path.join(root, file)); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }

async function waitFor(predicate, description, timeout = 6000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function childProcess(file, args = []) {
  const child = spawn(process.execPath, [file, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  return { child, completion };
}

function killOwned(pid, tree = true) {
  if (!alive(pid)) return;
  if (process.platform === 'win32') {
    const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
      ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 && alive(pid)) throw new Error(`Owned fixture cleanup failed for ${pid}: ${result.stderr}`);
  } else {
    try { process.kill(tree ? -pid : pid, 'SIGKILL'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

async function main() {
  await test('eligible preview is read-only, exact and explicit about arbitrary shell effects', async (root) => {
    const source = await eligible(root);
    const before = bytes(root, source.id);
    const result = run(root, recoverArgs(source, ['--json']));
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.writes, false);
    assert.equal(plan.child.verifier.command, source.verifier.command);
    assert.equal(plan.child.trigger.command, null);
    assert(plan.recoverySummary.authorization.includes('does not imply read-only'));
    assert.equal(registry.listLoops(root).length, 1);
    assert.equal(bytes(root, source.id), before);
    assert(!exists(root, 'actions.txt')); assert(!exists(root, 'checks.txt'));
    const json = JSON.parse(run(root, ['inspect', source.id, '--json']).stdout);
    const text = run(root, ['inspect', source.id]).stdout;
    for (const value of [json.recoverySummary.reason, json.recoverySummary.decision,
      json.recoverySummary.lastRun.runId, `Revision: ${source.revision}`, 'action=not-started']) assert(text.includes(value), value);
  });

  for (const exitCode of [0, 1]) {
    await test(`authorized check exit ${exitCode} has durable linkage, one invocation and unchanged source`, async (root) => {
      const verify = script(root, 'check-receipt', `
        const fs = require('fs'); const registry = require(${JSON.stringify(registryModule)});
        const child = registry.listLoops(process.cwd()).find(loop => loop.recoveryOf);
        if (!child || !child.recoveryExecution || child.runs.length !== 1
          || child.runs[0].phase !== 'verifier' || child.runs[0].completedAt !== null) process.exit(9);
        fs.appendFileSync('checks.txt', 'check\\n'); process.exit(${exitCode});
      `);
      const source = await eligible(root, { verifierCommand: verify });
      const before = bytes(root, source.id);
      const result = run(root, recoverArgs(source, ['--write', '--json']));
      assert.equal(result.status, exitCode, result.stderr);
      const child = JSON.parse(result.stdout);
      assert.equal(child.status, exitCode === 0 ? 'verifier-passed' : 'verifier-failed');
      assert.equal(child.runs.length, 1); assert.equal(child.runs[0].actionResult, undefined);
      assert.equal(child.recoveryOf.sourceLoopId, source.id);
      assert.equal(child.recoveryOf.sourceRevision, source.revision);
      assert.equal(child.recoveryOf.sourceRunId, source.runs[0].runId);
      assert.match(child.recoveryOf.verifierDigest, /^[a-f0-9]{64}$/);
      assert.equal(child.budget.maxAttempts, 1); assert.equal(child.budget.commandTimeoutMs, 5000);
      assert.equal(fs.readFileSync(path.join(root, 'checks.txt'), 'utf8'), 'check\n');
      assert(!exists(root, 'actions.txt')); assert.equal(bytes(root, source.id), before);
      const duplicate = run(root, recoverArgs(source, ['--write']));
      assert.equal(duplicate.status, 1); assert.match(duplicate.stderr, /LOOP_ALREADY_EXISTS/);
      assert.equal(fs.readFileSync(path.join(root, 'checks.txt'), 'utf8'), 'check\n');
    });
  }

  await test('strict flags and forbidden source states cause no writes or effects', async (root) => {
    const source = await eligible(root);
    const before = bytes(root, source.id);
    const invalid = [
      ['--action', 'x'], ['--verify', 'x'], ['--command', 'x'], ['--max-attempts', '2'],
      ['--command-timeout-ms', '99'], ['--max-duration-ms', '99'], ['--run'], ['--unknown'],
      ['--write', '--write'], ['--verify-only'], ['--json', '--json'], ['--verify-only=true'],
      ['--expected-revision', '1'], ['extra'], ['--expected-revision=2'],
    ];
    for (const extra of invalid) {
      const result = run(root, recoverArgs(source, [...extra, '--write']));
      assert.equal(result.status, 1, JSON.stringify(extra));
    }
    for (const args of [
      ['recover', source.id, '--write'], ['recover', source.id, '--verify-only', '--expected-revision'],
      ['recover', source.id, '--verify-only', '--expected-revision', '-1'],
      ['recover', source.id, '--verify-only', '--expected-revision', '1.2'],
    ]) assert.equal(run(root, args).status, 1);
    const states = ['running', 'planned', 'waiting', 'paused', 'needs-human-review', 'stopped', 'timeout', 'attempt-limit', 'budget-exhausted', 'done', 'verifier-passed'];
    for (const status of states) {
      const changed = { ...source, status };
      assert.notEqual(inspectRecovery(changed).decision, 'verification-followup-available');
      assert.throws(() => recoveryPlan(changed, source.revision), /inspection-only/);
    }
    for (const changed of [
      { ...source, verifier: { command: null } },
      { ...source, budget: { ...source.budget, maxAttempts: 1 } },
      { ...source, budget: { ...source.budget, maxSpend: 10 } },
      { ...source, startedAt: new Date(Date.now() - 1000).toISOString(), budget: { ...source.budget, maxDurationMs: 10 } },
      { ...source, runs: [{ ...source.runs[0], completedAt: null }] },
      { ...source, runs: [{ ...source.runs[0], actionResult: { ...source.runs[0].actionResult, quiescence: null } }] },
      { ...source, runs: [{ ...source.runs[0], actionResult: { ...source.runs[0].actionResult, cleanupError: 'tree cleanup failed' } }] },
      { ...source, runs: [{ ...source.runs[0], actionResult: { ...source.runs[0].actionResult,
        quiescence: { kind: 'process-tree-terminated', observedAt: new Date().toISOString() } } }] },
    ]) assert.throws(() => recoveryPlan(changed, source.revision), /inspection-only/);
    assert.equal(bytes(root, source.id), before); assert.equal(registry.listLoops(root).length, 1);
    assert(!exists(root, 'actions.txt')); assert(!exists(root, 'checks.txt'));
  });

  await test('stale preview and source change after child admission fail before dispatch', async (root) => {
    const source = await eligible(root);
    registry.updateLoop(root, source.id, { notes: ['concurrent change'] });
    const stale = run(root, recoverArgs(source, ['--write']));
    assert.equal(stale.status, 1); assert.match(stale.stderr, /LOOP_REVISION_CONFLICT/);
    const fresh = registry.readLoop(root, source.id);
    const child = registry.registerRecovery(root, source.id, fresh.revision);
    registry.updateLoop(root, source.id, { notes: ['another change'] });
    await assert.rejects(superviseLoop(root, child.id, { executeCommand: async () => assert.fail('stale source executed') }), /revision conflict/);
    assert.equal(registry.readLoop(root, child.id).recoveryExecution, null);
    assert(!exists(root, 'checks.txt'));
  });

  await test('source lock is never stolen and post-claim source change prevents dispatch', async (root) => {
    const source = await eligible(root);
    const lock = `${registry.loopPath(root, source.id)}.lock`;
    const owner = JSON.stringify({ pid: process.pid, token: require('crypto').randomUUID() });
    fs.writeFileSync(lock, owner);
    assert.throws(() => registry.registerRecovery(root, source.id, source.revision, { lockTimeoutMs: 0 }),
      (error) => error.code === 'LOOP_LOCK_TIMEOUT');
    assert.equal(fs.readFileSync(lock, 'utf8'), owner);
    fs.unlinkSync(lock);
    const child = registry.registerRecovery(root, source.id, source.revision);
    registry.claimRecoveryExecution(root, child);
    // A consumed claim remains single-use even if a caller changes other fields.
    registry.updateLoop(root, source.id, { notes: ['changed after claim, before effect'] });
    await assert.rejects(superviseLoop(root, child.id, { executeCommand: async () => assert.fail('Changed source executed') }), /revision conflict/);
    assert(!exists(root, 'checks.txt'));
  });

  await test('serialized receipt contradictions and nullable or widened child budgets fail closed', async (root) => {
    const source = await eligible(root, { commandTimeoutMs: 50 });
    const plan = recoveryPlan(source, source.revision);
    for (const timeout of [null, undefined, 0, -1, 1.5, 51, Infinity, '50']) {
      const child = { ...plan.child, budget: { ...plan.child.budget, commandTimeoutMs: timeout, maxDurationMs: timeout } };
      assert.throws(() => assertRecoveryBinding(source, child), /no longer matches/);
    }
    for (const patch of [{ exitCode: 0 }, { signal: 'SIGTERM' }, { stdout: 'effect happened' },
      { stderr: 'effect failed' }, { error: 'spawn failure' }, { pid: 1234 }, { childPid: 1234 }, { processId: 1234 }]) {
      const changed = { ...source, runs: [{ ...source.runs[0], actionResult: { ...source.runs[0].actionResult, ...patch } }] };
      assert.equal(inspectRecovery(changed).reason, 'quiescence-unproven');
      assert.throws(() => recoveryPlan(changed, source.revision), /inspection-only/);
    }
    const timed = { ...source, startedAt: new Date(Date.now() - 2000).toISOString(),
      budget: { ...source.budget, commandTimeoutMs: 5000, maxDurationMs: 5000 } };
    const bounded = recoveryPlan(timed, source.revision).child;
    assert(bounded.budget.commandTimeoutMs <= 3000);
    assert.throws(() => assertRecoveryBinding(timed, { ...bounded, budget: { ...bounded.budget, commandTimeoutMs: 5000, maxDurationMs: 5000 } }), /no longer matches/);
  });

  await test('deadline-limited child is admitted using one timestamp and receives live remaining timeout', async (root) => {
    const source = await eligible(root);
    const startedAt = new Date(Date.now() - 2000).toISOString();
    const timed = registry.updateLoop(root, source.id, { startedAt,
      budget: { ...source.budget, commandTimeoutMs: 10000, maxDurationMs: 5000 } });
    const snapshotTime = Date.now();
    const plan = recoveryPlan(timed, timed.revision, { now: snapshotTime });
    assert.equal(Date.parse(plan.child.createdAt), snapshotTime);
    assert.equal(plan.child.budget.commandTimeoutMs, Date.parse(startedAt) + 5000 - snapshotTime);
    assertRecoveryBinding(timed, plan.child);
    const child = registry.registerRecovery(root, source.id, timed.revision);
    const result = await superviseLoop(root, child.id, { executeCommand: async (command, options) => {
      assert.equal(command, timed.verifier.command);
      assert(options.timeoutMs > 0 && options.timeoutMs <= 3000);
      return { outcome: 'passed', exitCode: 0 };
    } });
    assert.equal(result.status, 'verifier-passed');
  });

  await test('stored active, stopped, review, expired and uncertain sources refuse CLI writes', async (root) => {
    const source = await eligible(root);
    const variants = [
      ...['running', 'planned', 'paused', 'needs-human-review', 'stopped', 'timeout', 'attempt-limit', 'budget-exhausted'].map(status => ({ ...source, status })),
      { ...source, verifier: { command: null } },
      { ...source, budget: { ...source.budget, maxAttempts: 1 } },
      { ...source, startedAt: new Date(Date.now() - 1000).toISOString(), budget: { ...source.budget, maxDurationMs: 10 } },
      { ...source, runs: [{ ...source.runs[0], completedAt: null }] },
      { ...source, runs: [{ ...source.runs[0], actionResult: { ...source.runs[0].actionResult, quiescence: null } }] },
    ];
    for (let i = 0; i < variants.length; i++) {
      const id = `refused-${i}`;
      const stored = registry.registerLoop(root, { ...variants[i], id, statePath: `.planning/loops/${id}.json` });
      const before = bytes(root, id); const count = registry.listLoops(root).length;
      const result = run(root, recoverArgs(stored, ['--write']));
      assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /LOOP_RECOVERY_REFUSED/);
      assert.equal(bytes(root, id), before); assert.equal(registry.listLoops(root).length, count);
    }
    assert(!exists(root, 'actions.txt')); assert(!exists(root, 'checks.txt'));
  });

  await test('simultaneous CLI admissions execute one child only', async (root) => {
    const source = await eligible(root);
    const before = bytes(root, source.id);
    const args = [...recoverArgs(source, ['--write', '--json']), '--project-root', root];
    const a = childProcess(cli, args); const b = childProcess(cli, args);
    const results = await Promise.all([a.completion, b.completion]);
    assert.deepEqual(results.map((r) => r.code).sort(), [0, 1], JSON.stringify(results));
    assert(results.some((r) => r.stderr.includes('LOOP_ALREADY_EXISTS')));
    assert.equal(registry.listLoops(root).length, 2);
    assert.equal(fs.readFileSync(path.join(root, 'checks.txt'), 'utf8'), 'check\n');
    assert.equal(bytes(root, source.id), before);
  });

  await test('crash after registration or claim is inspectable and retry never starts another check', async (root) => {
    const source = await eligible(root);
    const registrar = path.join(root, 'register-and-crash.js');
    fs.writeFileSync(registrar, `require(${JSON.stringify(registryModule)}).registerRecovery(${JSON.stringify(root)}, 'source', ${source.revision}); process.exit(7);`);
    assert.equal(spawnSync(process.execPath, [registrar]).status, 7);
    assert.equal(run(root, recoverArgs(source, ['--write'])).status, 1);
    const child = registry.listLoops(root).find((loop) => loop.recoveryOf);
    const claimed = registry.claimRecoveryExecution(root, child);
    assert(claimed.recoveryExecution);
    await assert.rejects(superviseLoop(root, child.id, { executeCommand: async () => assert.fail('Consumed check executed') }), /already claimed/);
    assert.equal(registry.listLoops(root).length, 2); assert(!exists(root, 'checks.txt'));
    assert.throws(() => registry.updateLoop(root, child.id, { recoveryExecution: null }), /cannot change/);
    assert.throws(() => registry.stopLoop(root, source.id, 'stopped', 'late stop'), /Terminal loop/);
  });

  await test('NPM script and generated-project delegate route the source recovery CLI', async (root) => {
    const source = await eligible(root);
    const packageRoot = path.resolve(__dirname, '..');
    const packageJson = require('../package.json');
    assert.equal(packageJson.scripts.loops, 'node scripts/loops.js');
    const delegateList = require('../hooks_src/delegate-scripts.json');
    assert(JSON.stringify(delegateList).includes('loops.js'));
    // Invoke the same npm script in a fixture project: no package/network setup.
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { loops: `node "${cli}"` } }));
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const npmResult = spawnSync(npm, ['run', 'loops', '--', ...recoverArgs(source)],
      { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', timeout: 15000 });
    assert.equal(npmResult.status, 0, npmResult.stderr);
    assert(npmResult.stdout.includes('Verification follow-up plan:'));
    const init = fs.readFileSync(path.join(packageRoot, 'hooks_src/init-project.js'), 'utf8');
    const start = init.indexOf('function generateDelegate(');
    const end = init.indexOf('\n}', start) + 2;
    const generate = require('vm').runInNewContext(`(${init.slice(start, end)})`);
    const delegateDir = path.join(root, '.citadel', 'scripts');
    fs.mkdirSync(delegateDir, { recursive: true });
    fs.writeFileSync(path.join(root, '.citadel/plugin-root.txt'), packageRoot);
    const delegate = path.join(delegateDir, 'loops.js');
    fs.writeFileSync(delegate, generate('loops.js'));
    const delegated = spawnSync(process.execPath, [delegate, ...recoverArgs(source, ['--write', '--json'])],
      { cwd: root, encoding: 'utf8', timeout: 15000 });
    assert.equal(delegated.status, 0, delegated.stderr);
    assert.equal(JSON.parse(delegated.stdout).status, 'verifier-passed');
    assert.equal(fs.readFileSync(path.join(root, 'checks.txt'), 'utf8'), 'check\n');
  });

  for (const phase of ['action', 'verifier']) {
    await test(`real killed runner during ${phase} retains unknown effects and live child inspection is read-only`, async (root) => {
      const command = script(root, 'effect', `
        const fs = require('fs'); fs.writeFileSync('owned.json', JSON.stringify({pid:process.pid, parent:process.ppid}));
        fs.writeFileSync('effect.txt', 'effect happened'); setTimeout(() => {}, 10000);
      `);
      const source = registry.registerLoop(root, createLoopContract({ id: 'source', type: 'foreground-loop',
        command: phase === 'action' ? command : null, verifierCommand: phase === 'verifier' ? command : `${node} --version`, maxAttempts: 3 }));
      const runner = path.join(root, 'runner.js');
      fs.writeFileSync(runner, `require(${JSON.stringify(supervisor)}).superviseLoop(${JSON.stringify(root)}, 'source').catch(e => {console.error(e); process.exitCode=1});`);
      const active = childProcess(runner);
      let owned;
      try {
        await waitFor(() => exists(root, 'effect.txt'), 'effect marker');
        owned = JSON.parse(fs.readFileSync(path.join(root, 'owned.json')));
        killOwned(active.child.pid, false);
        await active.completion;
        assert(alive(owned.pid), 'Fixture must leave its command live for the inspection test');
        const pending = registry.readLoop(root, source.id);
        assert.equal(pending.runs[0].phase, phase); assert.equal(pending.runs[0].completedAt, null);
        const before = bytes(root, source.id);
        const inspection = JSON.parse(run(root, ['inspect', source.id, '--json']).stdout);
        assert.equal(inspection.recoverySummary[`${phase}Observation`], 'unknown');
        assert.equal(inspection.recoverySummary.decision, 'inspection-required');
        assert.equal(run(root, recoverArgs(pending)).status, 1);
        assert.equal(run(root, recoverArgs(pending, ['--write'])).status, 1);
        assert.equal(bytes(root, source.id), before); assert.equal(registry.listLoops(root).length, 1);
        assert.equal(fs.readFileSync(path.join(root, 'effect.txt'), 'utf8'), 'effect happened');
        // Existing supervisor re-entry can terminalize the pending receipt. It
        // still cannot prove the live command stopped or replay either phase.
        const terminal = await superviseLoop(root, source.id, { executeCommand: async () => assert.fail('Unknown command replayed') });
        assert.equal(terminal.status, 'interrupted');
        assert.equal(inspectRecovery(terminal).reason, 'quiescence-unproven');
        const terminalBefore = bytes(root, source.id);
        assert.equal(run(root, recoverArgs(terminal, ['--write'])).status, 1);
        assert.equal(bytes(root, source.id), terminalBefore);
      } finally {
        if (owned) killOwned(owned.parent);
        // Killing the runner can orphan its shell's Node child. Terminate the
        // separately recorded fixture PID too; a missing parent is not cleanup.
        if (owned && alive(owned.pid)) killOwned(owned.pid, process.platform === 'win32');
        if (alive(active.child.pid)) killOwned(active.child.pid);
        await active.completion;
      }
      if (owned) await waitFor(() => !alive(owned.pid) && !alive(owned.parent), 'owned fixture command exit');
      // Keep interrupted receipts and the real effect marker for audit. Windows
      // can retain a directory handle after the exact owned PIDs have exited.
      return true;
    });
  }

  for (const mode of ['timeout', 'stop']) {
    await test(`recovery ${mode} interrupts owned descendants, retains evidence and spares unrelated process`, async (root) => {
      // Use a bounded unrelated Node process with a separate, known ownership.
      const unrelatedFile = path.join(root, 'unrelated.js');
      fs.writeFileSync(unrelatedFile, 'setTimeout(() => {}, 15000)');
      const sentinel = childProcess(unrelatedFile);
      fs.writeFileSync(path.join(root, 'descendant.js'), "require('fs').writeFileSync('descendant.pid',String(process.pid)); setTimeout(() => require('fs').writeFileSync('late.txt','late'), 2500)");
      const verify = script(root, 'waiting-verifier', `
        require('fs').writeFileSync('verifier.pid',String(process.pid));
        require('child_process').spawn(process.execPath, ['descendant.js'], {stdio:'inherit',windowsHide:true});
        console.log('verification-started'); setTimeout(() => {},10000);
      `);
      const source = await eligible(root, { verifierCommand: verify, commandTimeoutMs: mode === 'timeout' ? 1000 : 5000 });
      const before = bytes(root, source.id);
      const invocation = childProcess(cli, [...recoverArgs(source, ['--write', '--json']), '--project-root', root]);
      try {
        await waitFor(() => exists(root, 'descendant.pid'), 'owned descendant');
        const child = registry.listLoops(root).find((loop) => loop.recoveryOf);
        if (mode === 'stop') registry.stopLoop(root, child.id, 'stopped', 'explicit follow-up stop');
        const result = await invocation.completion;
        assert.equal(result.code, 1, result.stderr);
        const stopped = JSON.parse(result.stdout);
        assert.equal(stopped.status, mode === 'timeout' ? 'timeout' : 'stopped');
        assert.equal(stopped.verified, false);
        assert(stopped.runs[0].completedAt); assert.equal(stopped.runs[0].verifierResult.exitCode, null);
        const cleanupError = stopped.runs[0].verifierResult.cleanupError;
        assert(Object.hasOwn(stopped.runs[0].verifierResult, 'cleanupError'));
        // Windows can report a child already exited while taskkill walks the
        // tree. Keep that uncertainty visible and independently check all
        // recorded fixture PIDs below; do not relabel it successful cleanup.
        if (cleanupError) assert(result.stderr.includes(cleanupError));
        assert.equal(stopped.runs[0].verifierResult.quiescence, null);
        assert(stopped.runs[0].verifierResult.stdout.includes('verification-started'));
        for (const filename of ['verifier.pid', 'descendant.pid']) {
          const pid = Number(fs.readFileSync(path.join(root, filename), 'utf8'));
          await waitFor(() => !alive(pid), `owned process ${pid} termination`);
        }
        assert(alive(sentinel.child.pid));
        await delay(1800); assert(!exists(root, 'late.txt'));
        assert.equal(bytes(root, source.id), before); assert(!exists(root, 'actions.txt'));
      } finally {
        if (alive(invocation.child.pid)) killOwned(invocation.child.pid);
        for (const filename of ['verifier.pid', 'descendant.pid']) {
          if (exists(root, filename)) {
            const pid = Number(fs.readFileSync(path.join(root, filename), 'utf8'));
            if (alive(pid)) killOwned(pid, process.platform === 'win32');
          }
        }
        sentinel.child.kill(); await sentinel.completion; await invocation.completion;
      }
    });
  }
  console.log(`loop recovery tests passed (${tests}, ${process.platform})`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

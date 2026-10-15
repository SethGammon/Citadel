#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLoopContract, validateLoopContract, MAX_TIMER_MS } = require('../core/loops/contract');
const { readLoop, registerLoop, stopLoop, updateLoop } = require('../core/loops/registry');
const { runCommand, superviseLoop } = require('../core/loops/supervisor');

const runner = path.resolve(__dirname, 'loop-runner.js');
const node = `"${process.execPath}"`;
const success = () => ({ exitCode: 0, outcome: 'passed' });
const failure = () => ({ exitCode: 1, outcome: 'failed' });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let tests = 0;

async function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citadel-loop-supervisor-'));
  try { await fn(root); tests++; console.log(`PASS ${name}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function plan(root, options = {}) {
  return registerLoop(root, createLoopContract({ id: 'test-loop', type: 'foreground-loop',
    verifierCommand: `${node} --version`, maxAttempts: 3, ...options }));
}

function script(root, name, source) {
  const file = path.join(root, `${name}.js`);
  fs.writeFileSync(file, source);
  return `${node} "${file}"`;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function main() {
  await test('finite integer limits and invalid CLI values do not write', (root) => {
    for (const value of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert(!validateLoopContract(createLoopContract({ maxAttempts: value })).pass);
      assert(!validateLoopContract(createLoopContract({ retry: { maxAttempts: value } })).pass);
    }
    for (const field of ['maxDurationMs', 'commandTimeoutMs']) {
      for (const value of [0, -1, 1.5, Infinity, NaN, MAX_TIMER_MS + 1, '50']) {
        assert(!validateLoopContract(createLoopContract({ [field]: value })).pass);
      }
    }
    for (const [flag, value] of [['--max-attempts', '1.5'], ['--max-attempts', '0'],
      ['--command-timeout-ms', 'Infinity'], ['--max-duration-ms', '-1']]) {
      const result = spawnSync(process.execPath, [runner, '--verify', `${node} --version`,
        flag, value, '--write', '--project-root', root], { encoding: 'utf8' });
      assert.equal(result.status, 1, result.stderr);
    }
    assert(!fs.existsSync(path.join(root, '.planning')));
  });

  await test('CLI dry run performs no command and writes no state', (root) => {
    const command = script(root, 'effect', "require('fs').writeFileSync('effect.txt', 'ran')");
    const result = spawnSync(process.execPath, [runner, '--action', command, '--verify', command,
      '--project-root', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes('Loop planned:'));
    assert(!fs.existsSync(path.join(root, 'effect.txt')));
    assert(!fs.existsSync(path.join(root, '.planning')));
  });

  await test('verifier-only execution and receipts before effects', async (root) => {
    const contract = plan(root);
    let calls = 0;
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
      calls++;
      const saved = readLoop(root, contract.id);
      assert.equal(saved.runs.length, 1);
      assert.equal(saved.runs[0].completedAt, null);
      assert.equal(saved.runs[0].phase, 'verifier');
      return success();
    } });
    assert.equal(calls, 1);
    assert.equal(result.status, 'verifier-passed');
    assert.equal(result.runs[0].command, null);
    assert(result.runs[0].completedAt);
  });

  await test('action failure does not execute verifier', async (root) => {
    const contract = plan(root, { command: 'action' });
    const commands = [];
    const result = await superviseLoop(root, contract.id, { executeCommand: async (command) => {
      commands.push(command); return failure();
    } });
    assert.deepEqual(commands, ['action']);
    assert.equal(result.status, 'action-failed');
    assert.equal(result.runs[0].outcome, 'action-failed');
  });

  await test('failed verifier then passed verifier keeps both attempt outcomes', async (root) => {
    const contract = plan(root, { command: 'action', verifierCommand: 'verify' });
    const commands = [];
    let verifications = 0;
    const result = await superviseLoop(root, contract.id, { executeCommand: async (command) => {
      commands.push(command);
      return command === 'verify' && ++verifications === 1 ? failure() : success();
    } });
    assert.deepEqual(commands, ['action', 'verify', 'action', 'verify']);
    assert.deepEqual(result.runs.map((run) => run.outcome), ['verifier-failed', 'verifier-passed']);
    assert.equal(result.status, 'verifier-passed');
  });

  await test('attempt limit retains failed verification evidence', async (root) => {
    const contract = plan(root, { maxAttempts: 2 });
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => failure() });
    assert.equal(result.status, 'attempt-limit');
    assert.equal(result.runs.length, 2);
    assert(result.runs.every((run) => run.outcome === 'verifier-failed'));
  });

  await test('declared verifier-failed stop condition prevents retries', async (root) => {
    const contract = plan(root, { stopConditions: ['verifier-passed', 'verifier-failed'] });
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => failure() });
    assert.equal(result.status, 'verifier-failed');
    assert.equal(result.runs.length, 1);
    assert.equal(result.verified, false);
  });

  for (const status of ['stopped', 'paused', 'needs-human-review']) {
    await test(`${status} prevents first action`, async (root) => {
      const contract = plan(root, { command: 'action' });
      stopLoop(root, contract.id, status, 'operator decision');
      const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
        assert.fail('Stopped loop executed a command');
      } });
      assert.equal(result.status, status);
      assert.equal(result.runs.length, 0);
    });
  }

  await test('stop after action prevents verifier and preserves operator reason', async (root) => {
    const contract = plan(root, { command: 'action' });
    let calls = 0;
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
      calls++;
      stopLoop(root, contract.id, 'stopped', 'operator stop');
      return { ...success(), stdout: 'effect-confirmed', stderr: 'action diagnostic', cleanupError: 'cleanup diagnostic' };
    } });
    assert.equal(calls, 1);
    assert.equal(result.status, 'stopped');
    const saved = readLoop(root, contract.id);
    assert.equal(saved.stopReason, 'operator stop');
    assert.equal(saved.runs[0].status, 'interrupted');
    assert(saved.runs[0].completedAt);
    assert.equal(saved.runs[0].actionResult.stdout, 'effect-confirmed');
    assert.equal(saved.runs[0].actionResult.stderr, 'action diagnostic');
    assert.equal(saved.runs[0].actionResult.cleanupError, 'cleanup diagnostic');
  });

  for (const status of ['paused', 'needs-human-review', 'stopped']) {
    await test(`${status} preserves verifier observations and unrelated receipt data`, async (root) => {
      const contract = plan(root);
      let operatorState;
      const unrelated = { runId: 'other-run', attempt: 2, status: 'running', completedAt: null };
      const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
        const current = readLoop(root, contract.id);
        updateLoop(root, contract.id, { notes: ['operator note'],
          runs: [...current.runs.map((run) => ({ ...run, operatorNote: 'retain me' })), unrelated] });
        operatorState = stopLoop(root, contract.id, status, 'operator decision');
        return { ...success(), stdout: 'verification-observed', cleanupError: 'cleanup diagnostic' };
      } });
      const saved = readLoop(root, contract.id);
      assert.equal(result.verified, false);
      assert.equal(saved.status, status);
      assert.equal(saved.stoppedAt, operatorState.stoppedAt);
      assert.equal(saved.stopReason, operatorState.stopReason);
      assert.deepEqual(saved.notes, ['operator note']);
      assert.deepEqual(saved.runs[1], unrelated);
      assert.equal(saved.runs[0].operatorNote, 'retain me');
      assert.equal(saved.runs[0].status, 'interrupted');
      assert(saved.runs[0].completedAt);
      assert.equal(saved.runs[0].verifierResult.stdout, 'verification-observed');
      assert.equal(saved.runs[0].verifierResult.cleanupError, 'cleanup diagnostic');
    });
  }

  await test('stop after failed verifier prevents the next attempt', async (root) => {
    const contract = plan(root);
    let calls = 0;
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
      calls++;
      stopLoop(root, contract.id, 'stopped', 'no retry');
      return failure();
    } });
    assert.equal(calls, 1);
    assert.equal(result.status, 'stopped');
    assert.equal(result.runs.length, 1);
  });

  await test('external success status cannot substitute for this run verification', async (root) => {
    const contract = plan(root, { command: 'action' });
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
      stopLoop(root, contract.id, 'verifier-passed', 'external status');
      return success();
    } });
    assert.equal(result.verified, false);
    assert.equal(result.runs[0].verifierResult, undefined);
    const reread = await superviseLoop(root, contract.id);
    assert.equal(reread.verified, false);
  });

  await test('concurrent revision edit interrupts and retains the other writer data', async (root) => {
    const contract = plan(root, { command: 'action' });
    let calls = 0;
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
      calls++;
      updateLoop(root, contract.id, { notes: ['concurrent operator note'] });
      return success();
    } });
    assert.equal(calls, 1);
    assert.equal(result.status, 'interrupted');
    assert.equal(result.verified, false);
    assert.deepEqual(result.notes, ['concurrent operator note']);
    assert.equal(result.runs[0].outcome, 'interrupted');
  });

  await test('elapsed deadline prevents first action', async (root) => {
    const contract = plan(root, { command: 'action', maxDurationMs: 10 });
    updateLoop(root, contract.id, { startedAt: new Date(Date.now() - 100).toISOString() });
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
      assert.fail('Expired loop executed');
    } });
    assert.equal(result.status, 'timeout');
    assert.equal(result.runs.length, 0);
  });

  await test('deadline after action prevents verifier', async (root) => {
    const contract = plan(root, { command: 'action', maxDurationMs: 20 });
    let time = Date.now();
    let calls = 0;
    const result = await superviseLoop(root, contract.id, { now: () => time,
      executeCommand: async () => { calls++; time += 20; return success(); } });
    assert.equal(calls, 1);
    assert.equal(result.status, 'timeout');
  });

  await test('late or timed-out zero exit never authorizes success', async (root) => {
    const contract = plan(root, { maxDurationMs: 10 });
    let time = Date.now();
    const result = await superviseLoop(root, contract.id, { now: () => time,
      executeCommand: async () => { time += 10; return success(); } });
    assert.equal(result.status, 'timeout');
    const second = plan(root, { id: 'second' });
    const timedOut = await superviseLoop(root, second.id, {
      executeCommand: async () => ({ exitCode: 0, outcome: 'timeout' }),
    });
    assert.equal(timedOut.status, 'timeout');
    assert.equal(timedOut.runs[0].outcome, 'timeout');
  });

  await test('incomplete attempt is interrupted instead of replayed', async (root) => {
    const contract = plan(root);
    updateLoop(root, contract.id, { status: 'running', runs: [
      { attempt: 1, status: 'running', phase: 'action', completedAt: null },
    ] });
    const result = await superviseLoop(root, contract.id, { executeCommand: async () => {
      assert.fail('Incomplete action was replayed');
    } });
    assert.equal(result.status, 'interrupted');
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].outcome, 'interrupted');
    assert(result.runs[0].completedAt);
  });

  await test('executor failure leaves an interrupted receipt', async (root) => {
    const contract = plan(root);
    await assert.rejects(superviseLoop(root, contract.id, { executeCommand: async () => {
      throw new Error('executor unavailable');
    } }), /executor unavailable/);
    assert.equal(readLoop(root, contract.id).status, 'interrupted');
    assert.equal(readLoop(root, contract.id).runs[0].outcome, 'interrupted');
  });

  await test('real verifier-only CLI still succeeds with --run', (root) => {
    const result = spawnSync(process.execPath, [runner, '--verify', `${node} --version`, '--run',
      '--max-attempts', '1', '--command-timeout-ms', '5000', '--project-root', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes('Status: verifier-passed'));
  });

  await test('real abort stops command and records interrupted attempt', async (root) => {
    const action = script(root, 'wait', "setTimeout(() => require('fs').writeFileSync('late.txt', 'ran'), 1500)");
    const contract = plan(root, { command: action });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200);
    try {
      const result = await superviseLoop(root, contract.id, { signal: controller.signal });
      assert.equal(result.status, 'interrupted');
      assert.equal(result.runs[0].outcome, 'interrupted');
      assert.equal(result.runs[0].verifierResult, undefined);
    } finally { clearTimeout(timer); }
    assert(!fs.existsSync(path.join(root, 'late.txt')));
  });

  await test('real timed-out verifier cannot become a successful loop', async (root) => {
    const verify = script(root, 'late-success', 'setTimeout(() => process.exit(0), 3000)');
    const contract = plan(root, { verifierCommand: verify, commandTimeoutMs: 200 });
    const result = await superviseLoop(root, contract.id);
    assert.equal(result.status, 'timeout');
    assert.equal(result.verified, false);
    assert.equal(result.runs[0].verifierResult.outcome, 'timeout');
    assert.equal(result.runs[0].verifierResult.exitCode, null);
  });

  await test('external stop interrupts a running foreground command', async (root) => {
    const action = script(root, 'wait', 'setTimeout(() => {}, 10000)');
    const contract = plan(root, { command: action });
    const timer = setTimeout(() => stopLoop(root, contract.id, 'stopped', 'live stop'), 200);
    const start = Date.now();
    try {
      const result = await superviseLoop(root, contract.id);
      assert.equal(result.status, 'stopped');
      assert.equal(result.stopReason, 'live stop');
      const saved = readLoop(root, contract.id);
      assert(saved.runs[0].completedAt);
      assert.equal(saved.runs[0].actionResult.outcome, 'interrupted');
      assert(Date.now() - start < 5000);
    } finally { clearTimeout(timer); }
  });

  for (const phase of ['action', 'verifier']) {
    await test(`separate-process stop after ${phase} effect retains durable command result`, async (root) => {
      const effectFile = path.join(root, 'effect.txt');
      const command = script(root, 'effect',
        `console.log('observed-effect'); require('fs').writeFileSync(${JSON.stringify(effectFile)}, 'effect-performed'); setTimeout(() => {}, 10000);`);
      const contract = plan(root, { command: phase === 'action' ? command : null,
        verifierCommand: phase === 'verifier' ? command : `${node} --version`, commandTimeoutMs: 5000 });
      const registryFile = path.resolve(__dirname, '../core/loops/registry.js');
      const stopReceipt = path.join(root, 'stop-receipt.json');
      const stopperFile = path.join(root, 'stopper.js');
      fs.writeFileSync(stopperFile, `
        const fs = require('fs');
        const registry = require(${JSON.stringify(registryFile)});
        const timer = setInterval(() => {
          if (!fs.existsSync(${JSON.stringify(effectFile)})) return;
          clearInterval(timer);
          const stopped = registry.stopLoop(${JSON.stringify(root)}, ${JSON.stringify(contract.id)}, 'stopped', 'independent-process-stop');
          fs.writeFileSync(${JSON.stringify(stopReceipt)}, JSON.stringify(stopped));
          process.exit(0);
        }, 10);
        setTimeout(() => process.exit(2), 9000);
      `);
      const stopper = spawn(process.execPath, [stopperFile], { windowsHide: true, stdio: 'ignore' });
      const stopped = new Promise((resolve) => {
        stopper.once('error', (error) => resolve({ error }));
        stopper.once('close', (code) => resolve({ code }));
      });
      try {
        const result = await superviseLoop(root, contract.id);
        const stopperResult = await stopped;
        assert.equal(stopperResult.code, 0, stopperResult.error?.message);
        const operatorState = JSON.parse(fs.readFileSync(stopReceipt, 'utf8'));
        const saved = readLoop(root, contract.id);
        assert.equal(fs.readFileSync(effectFile, 'utf8'), 'effect-performed');
        assert.equal(result.verified, false);
        assert.equal(saved.status, 'stopped');
        assert.equal(saved.stoppedAt, operatorState.stoppedAt);
        assert.equal(saved.stopReason, 'independent-process-stop');
        assert.equal(saved.runs.length, 1);
        assert(saved.runs[0].completedAt);
        assert.equal(saved.runs[0].outcome, 'interrupted');
        assert(saved.runs[0][`${phase}Result`].stdout.includes('observed-effect'));
        assert.equal(saved.runs[0][`${phase}Result`].outcome, 'interrupted');
        assert(Object.hasOwn(saved.runs[0][`${phase}Result`], 'cleanupError'));
        if (phase === 'action') assert.equal(saved.runs[0].verifierResult, undefined);
      } finally {
        if (stopper.exitCode === null) stopper.kill();
        await stopped;
      }
    });
  }

  await test('real timeout kills owned shell descendants and spares unrelated process', async (root) => {
    const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { windowsHide: true });
    const childFile = path.join(root, 'child.js');
    fs.writeFileSync(childFile, "require('fs').writeFileSync('child.pid', String(process.pid)); setTimeout(() => require('fs').writeFileSync('escaped.txt', 'ran'), 1800)");
    const command = script(root, 'parent', "const fs = require('fs'); fs.writeFileSync('parent.pid', String(process.pid)); require('child_process').spawn(process.execPath, ['child.js'], {stdio:'inherit', windowsHide:true}); setTimeout(() => {}, 10000)");
    try {
      const start = Date.now();
      const result = await runCommand(command, { cwd: root, timeoutMs: 700 });
      assert.equal(result.outcome, 'timeout');
      assert.equal(result.exitCode, null);
      assert(Date.now() - start < 5000);
      assert(alive(unrelated.pid), 'Unrelated process was killed');
      for (const name of ['parent.pid', 'child.pid']) {
        assert(fs.existsSync(path.join(root, name)), `${name} was not created before timeout`);
        const pid = Number(fs.readFileSync(path.join(root, name), 'utf8'));
        for (let n = 0; n < 20 && alive(pid); n++) await delay(25);
        assert(!alive(pid), `Owned process ${pid} survived timeout`);
      }
      await delay(1300);
      assert(!fs.existsSync(path.join(root, 'escaped.txt')));
    } finally {
      const exited = new Promise((resolve) => unrelated.once('close', resolve));
      unrelated.kill();
      await exited;
    }
  });
  console.log(`loop supervisor tests passed (${tests}, ${process.platform})`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

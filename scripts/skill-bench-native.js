#!/usr/bin/env node
'use strict';

// Candidate-bound Codex release verification. One scenario per invocation;
// native hook trust is a precondition, never written or bypassed here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const bench = require('./skill-bench');
const { buildAppServerApprovalResponse } = require('../core/codex/native-integrations');
const ROOT = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = file => hash(fs.readFileSync(file));
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
  && (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const normalized = value => value.replace(/\r\n/g, '\n').trim();
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${ROOT.replace(/\\/g, '/')}`, '-C', ROOT, ...args], { encoding: 'utf8' }).trim();
const put = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

function prepare() {
  if (git('status', '--porcelain')) throw new Error('Commit candidate changes before preparing the native fixture');
  const project = bench.setupProjectState('clean');
  const run = (script, args = []) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: project, encoding: 'utf8', stdio: 'pipe', timeout: 60000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, CITADEL_RUNTIME: 'codex' },
  });
  run('codex-compat.js', [project]);
  const bundle = require('../core/config/bundle-catalog').bundleForSkill('experiment');
  run('citadel-config.js', ['enable', bundle, '--project-root', project, '--runtime', 'codex', '--allow-degraded-runtime', '--apply', '--json']);
  run('install-hooks-codex.js', [project, '--json']);
  const skillPath = path.join(project, '.agents', 'skills', 'experiment', 'SKILL.md');
  const hookPath = path.join(project, '.codex', 'hooks.json');
  const manifest = { version: 1, project, sourceRoot: ROOT, sourceHead: git('rev-parse', 'HEAD'),
    skillPath, skillHash: digest(skillPath), hookPath, hookHash: digest(hookPath) };
  if (manifest.skillHash !== digest(path.join(ROOT, 'skills', 'experiment', 'SKILL.md'))) throw new Error('Projected skill differs from candidate');
  put(path.join(project, 'native-bench.json'), manifest);
  return manifest;
}

function validateFixture(project) {
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'native-bench.json'), 'utf8'));
  if (!samePath(manifest.project, project) || !samePath(manifest.sourceRoot, ROOT)
    || !samePath(manifest.skillPath, path.join(project, '.agents/skills/experiment/SKILL.md'))
    || !samePath(manifest.hookPath, path.join(project, '.codex/hooks.json'))
    || manifest.sourceHead !== git('rev-parse', 'HEAD') || git('status', '--porcelain')
    || manifest.skillHash !== digest(manifest.skillPath)
    || manifest.skillHash !== digest(path.join(ROOT, 'skills/experiment/SKILL.md'))
    || manifest.hookHash !== digest(manifest.hookPath)) throw new Error('Prepared candidate identity changed');
  return manifest;
}

function verifyHooks(messages, { threadId, turnId, hookPath }) {
  const selected = messages.filter(message => /^hook\/(started|completed)$/.test(message.method)
    && message.params?.threadId === threadId && samePath(message.params?.run?.sourcePath, hookPath));
  const failures = [];
  const completed = [];
  for (const message of selected.filter(item => item.method === 'hook/completed')) {
    const run = message.params.run;
    const start = selected.find(item => item.method === 'hook/started' && item.params.run.id === run.id
      && item.params.run.eventName === run.eventName && item.params.turnId === message.params.turnId);
    if (!start || run.status !== 'completed' || run.entries?.some(entry => entry.kind === 'error')
      || (message.params.turnId != null && message.params.turnId !== turnId)) failures.push(`Invalid native hook receipt ${run.id}`);
    else completed.push(run);
  }
  for (const event of ['userPromptSubmit', 'stop']) {
    if (!completed.some(run => run.eventName === event)) failures.push(`Missing successful candidate ${event} hook pair`);
  }
  for (const message of selected.filter(item => item.method === 'hook/started')) {
    if (!selected.some(item => item.method === 'hook/completed' && item.params.run.id === message.params.run.id)) failures.push(`Unfinished candidate hook ${message.params.run.id}`);
  }
  return { passed: failures.length === 0, failures, completed: completed.map(run => ({ id: run.id, event: run.eventName })) };
}

async function execute({ project, binary, output, scenarioName, checkOnly = false }) {
  const manifest = validateFixture(project);
  fs.mkdirSync(output, { recursive: false }); // never overwrite a prior attempt
  put(path.join(output, 'candidate.json'), manifest);
  const selected = bench.discoverScenarios().filter(item => item.skill === 'experiment' && item.name === scenarioName);
  if (!checkOnly && (selected.length !== 1 || bench.validateScenario(selected[0]).length)) throw new Error('Select one valid experiment scenario');
  const args = ['-c', 'service_tier="default"', '-c', 'model_reasoning_effort="ultra"'];
  if (process.platform === 'win32') args.push('-c', 'windows.sandbox="elevated"');
  args.push('app-server', '--listen', 'stdio://');
  put(path.join(output, 'invocation.json'), { binary, args, project });
  const child = spawn(binary, args, { cwd: project, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, CITADEL_RUNTIME: 'codex', CLAUDE_PROJECT_DIR: project } });
  const events = [];
  let sequence = 0, buffer = '', threadId, turnId, turn, finished = false;
  const pending = new Map();
  const telemetry = () => Object.fromEntries(['hook-timing.jsonl', 'hook-errors.log'].map(name => {
    const file = path.join(project, '.planning/telemetry', name);
    return [name, fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).length : 0];
  }));
  const append = (name, value) => fs.appendFileSync(path.join(output, name), JSON.stringify(value) + '\n');
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  function request(method, params) {
    const id = ++sequence;
    append('requests.jsonl', { id, method, params });
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  }
  const completed = new Promise((resolve, reject) => {
    child.once('error', error => {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear(); reject(error);
    });
    child.once('close', () => {
      const error = new Error('Native server exited before completion');
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      if (!finished) reject(error);
    });
    child.stderr.on('data', value => fs.appendFileSync(path.join(output, 'stderr.log'), value));
    child.stdout.on('data', value => {
      buffer += value.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines.filter(Boolean)) {
        try {
          const message = JSON.parse(line); events.push(message); append('events.jsonl', message);
          if (message.id != null && !message.method && pending.has(message.id)) {
            const waiter = pending.get(message.id); pending.delete(message.id);
            if (message.error) waiter.reject(new Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
          } else if (message.method && message.id != null) {
            const response = buildAppServerApprovalResponse(message, { decision: 'decline' });
            if (!response) { reject(new Error(`Unhandled native request: ${message.method}`)); continue; }
            append('requests.jsonl', response); child.stdin.write(JSON.stringify(response) + '\n');
          }
          if (message.method === 'turn/completed') { turn = message.params.turn; resolve(); }
        } catch (error) { reject(error); }
      }
    });
  });
  completed.catch(() => {});
  const timeout = setTimeout(() => child.kill(), checkOnly ? 30000 : 300000);
  let result;
  try {
    await request('initialize', { clientInfo: { name: 'citadel-native-bench', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const discovery = await request('hooks/list', { cwds: [project] });
    put(path.join(output, 'hooks.json'), discovery);
    const candidate = (discovery.data || []).flatMap(item => item.hooks || []).filter(hook => samePath(hook.sourcePath, manifest.hookPath));
    if ((discovery.data || []).some(item => item.errors?.length) || !candidate.length
      || candidate.some(hook => !hook.enabled || !['trusted', 'managed'].includes(hook.trustStatus))) {
      throw new Error('Candidate hooks require native runtime review/approval; no model turn was started');
    }
    if (checkOnly) { result = { passed: true, preflightOnly: true, candidateHooks: candidate.length }; }
    else {
      const telemetryBefore = telemetry();
      const started = await request('thread/start', { cwd: project, model: 'gpt-6-astra', sandbox: 'workspace-write', approvalPolicy: 'on-request' });
      threadId = started.thread.id;
      const prompt = `First read ${manifest.skillPath} in full with one read-only command. This single skill read is authorized; then answer the scenario without other commands or mutations.\n\n${selected[0].input}`;
      const response = await request('turn/start', { threadId, effort: 'ultra', input: [
        { type: 'skill', name: 'experiment', path: manifest.skillPath }, { type: 'text', text: prompt },
      ] });
      turnId = response.turn.id;
      await completed;
      // Stop hooks may complete just after the turn notification.
      await new Promise(resolve => setTimeout(resolve, 1500));
      const items = events.filter(item => item.method === 'item/completed' && item.params?.threadId === threadId && item.params?.turnId === turnId).map(item => item.params.item);
      const skillRead = items.some(item => item.type === 'commandExecution' && item.exitCode === 0
        && normalized(item.aggregatedOutput || '').includes(normalized(fs.readFileSync(manifest.skillPath, 'utf8'))));
      const finalText = items.filter(item => item.type === 'agentMessage').map(item => item.text || '').join('\n');
      fs.writeFileSync(path.join(output, 'response.md'), finalText, { flag: 'wx' });
      const assertions = bench.runAssertions(selected[0], finalText, project);
      const hooks = verifyHooks(events, { threadId, turnId, hookPath: manifest.hookPath });
      const telemetryAfter = telemetry();
      const telemetryPassed = telemetryAfter['hook-timing.jsonl'] > telemetryBefore['hook-timing.jsonl']
        && telemetryAfter['hook-errors.log'] === telemetryBefore['hook-errors.log'];
      validateFixture(project);
      result = { passed: turn?.status === 'completed' && skillRead && hooks.passed && telemetryPassed && assertions.every(item => item.passed),
        scenario: scenarioName, threadId, turnId, status: turn?.status, skillRead, hooks, assertions,
        telemetry: { passed: telemetryPassed, before: telemetryBefore, after: telemetryAfter } };
    }
  } catch (error) { result = { passed: false, error: error.message, threadId, turnId }; }
  finally {
    finished = true; clearTimeout(timeout); child.stdin.end(); child.kill();
    result.serverExit = await exited;
    put(path.join(output, 'result.json'), result);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1];
  if (args.includes('--prepare')) { console.log(JSON.stringify(prepare(), null, 2)); return; }
  for (const flag of ['--project', '--codex-bin', '--out']) if (!args.includes(flag) || !value(flag) || value(flag).startsWith('--')) throw new Error(`Missing ${flag}`);
  const result = await execute({ project: path.resolve(value('--project')), binary: value('--codex-bin'), output: path.resolve(value('--out')),
    scenarioName: value('--scenario'), checkOnly: args.includes('--preflight') });
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.passed ? 0 : 1;
}
module.exports = { verifyHooks, samePath };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
